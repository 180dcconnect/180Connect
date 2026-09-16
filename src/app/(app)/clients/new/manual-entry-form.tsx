"use client";

import Link from "next/link";
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { ArrowRight, Check, Loader2, TriangleAlert } from "lucide-react";
import { OriginButton } from "@/components/ui/origin-button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Checkbox } from "@/components/animate-ui/components/radix/checkbox";
import {
  REGISTER_OPTIONS,
  normaliseRegistrationNumber,
  registerIdForName,
  type RegisterId,
} from "@/lib/registration-number";
import { discardImportDraft, type UrlImportState } from "./import-actions";
import { saveManualEntry, type ManualEntryState } from "./actions";
import {
  checkRegistrationField,
  checkWebsiteField,
  type RegistrationCheck,
  type WebsiteCheck,
} from "./field-check-actions";
import { DisclosureSection } from "./disclosure-section";
import { UkTownField } from "./uk-town-field";
import { AnimatedTick } from "./animated-tick";
import { CountryField } from "./country-field";
import { SECTOR_TAXONOMY } from "@/lib/scoring/score-by-sector";

export type ManualEntryDraft = {
  id: string;
  legal_name: string | null;
  mission_statement: string | null;
  organisation_type:
    | "charity"
    | "cio"
    | "cic"
    | "social_enterprise"
    | "ngo"
    | "company"
    | "both"
    | "other"
    | null;
  address_line_1: string | null;
  city: string | null;
  postcode: string | null;
  country_code: string | null;
  website: string | null;
  contact_email: string | null;
  /** The address the submitter confirmed is a shared inbox, lower-cased (20261003130000). */
  contact_email_role_confirmed_for?: string | null;
  registry_name: string | null;
  registry_number: string | null;
  reason_for_manual_entry: string | null;
  updated_at: string;
  /** F037: null for an entry the CAM typed from scratch. */
  source_url: string | null;
  imported_field_paths: string[];
  import_notes: string[];
  /** Sector, reach and size (20261002090000) — optional, null until given. */
  sector: string | null;
  geographic_reach: "local" | "regional" | "national" | "international" | null;
  latest_income: number | null;
  accounts_year_end: string | null;
  staff_count: number | null;
  volunteer_count: number | null;
};

const initialState: ManualEntryState = { kind: "idle", message: "" };
const initialImportState: UrlImportState = { kind: "idle", message: "" };

/**
 * Form field name to MANUAL_ENTRY_RECORDS column.
 *
 * The two differ because the form speaks the language of the action layer and
 * imported_field_paths stores column names — the durable side of the pair. Keeping
 * one map beats renaming either: the stored provenance stays readable in SQL, and the
 * form keeps the names its own server action already parses.
 */
const FIELD_COLUMNS: Readonly<Record<string, string>> = {
  legalName: "legal_name",
  missionStatement: "mission_statement",
  organisationType: "organisation_type",
  addressLine1: "address_line_1",
  city: "city",
  postcode: "postcode",
  countryCode: "country_code",
  website: "website",
  contactEmail: "contact_email",
  registryName: "registry_name",
  registryNumber: "registry_number",
};

const TYPE_LABELS: Readonly<Record<string, string>> = {
  charity: "Charity",
  cio: "CIO",
  cic: "CIC",
  social_enterprise: "Social enterprise",
  ngo: "NGO",
  company: "Company",
  both: "Charity and company",
  other: "Other organisation",
};

/**
 * The form in five questions, each a collapsible row.
 *
 * ── Why sections ──
 *
 * Eleven fields in one column read as one long chore, and — worse once a
 * register or a website has filled most of them — gave no way to see at a
 * glance what was already done. Each row carries a one-line summary and a dot,
 * so a prefilled form reads as "four done, one to check" before anyone scrolls,
 * and a blank one opens only the first question.
 *
 * ── Why some fields are no longer free text ──
 *
 * What this form collects becomes a client record next to thousands that came
 * from the registers, and those carry one spelling per register, per place and
 * per number. So the fields a register or a list can answer are checked against
 * one: the register is a choice, its number is checked for shape and then
 * against the file we hold, a UK town comes from the UK list, and a UK postcode
 * has to be one. Outside the UK the address stays free text — the lists do not
 * cover it.
 */
type SectionId = "organisation" | "address" | "contact" | "registration" | "size" | "reason";

const SECTION_FIELDS: Readonly<Record<SectionId, readonly string[]>> = {
  organisation: ["legalName", "organisationType", "missionStatement"],
  address: ["addressLine1", "city", "postcode", "countryCode"],
  contact: ["website", "contactEmail"],
  registration: ["registryName", "registryNumber"],
  // Optional as a whole: nothing here is required, so the row is never "incomplete"
  // for being empty and never opens itself. Its dot is worked out where it renders.
  size: [],
  reason: ["reason"],
};

const SECTION_ORDER: readonly SectionId[] = ["organisation", "address", "contact", "registration", "size", "reason"];

/** The reason's own floor, mirrored from the field's `minLength`. */
const REASON_MIN = 10;

const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** How long after the last keystroke a server check runs. */
const CHECK_DELAY_MS = 700;

/** F037 AC8: says, on the field itself, that this value is not the CAM's own. */
function ImportedBadge() {
  return (
    <span className="ml-2 rounded-full bg-lead-wash px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-lead">
      Imported
    </span>
  );
}

function FieldLabel({
  htmlFor,
  children,
  imported,
}: {
  htmlFor: string;
  children: ReactNode;
  imported?: boolean;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-[13px] font-semibold text-dim"
    >
      {children}
      {imported && <ImportedBadge />}
    </label>
  );
}

/** The line under a field: what a check found, in its state's colour. */
function FieldNote({ tone, children }: { tone: "go" | "hold" | "stop" | "dim"; children: ReactNode }) {
  const colour = { go: "text-go", hold: "text-hold", stop: "text-stop", dim: "text-dim" }[tone];
  return (
    <p className={`mt-1.5 flex items-start gap-1.5 text-[12.5px] leading-[1.5] ${colour}`} role="status">
      {tone === "go" && <Check aria-hidden className="mt-0.5 size-3.5 shrink-0" strokeWidth={2.5} />}
      {(tone === "hold" || tone === "stop") && (
        <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" strokeWidth={2.2} />
      )}
      <span>{children}</span>
    </p>
  );
}

function Checking() {
  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-faint" role="status">
      <Loader2 aria-hidden className="size-3.5 animate-spin" strokeWidth={2.2} />
      Checking…
    </p>
  );
}

// The app's text field styling, tuned to match the filed-record language: a
// taller control than the shadcn default with the hairline rule border and
// lead focus ring used across the client record.
const fieldClass =
  "h-10 w-full rounded-inset border border-rule bg-white px-3 text-sm outline-none transition-[border-color,box-shadow] focus-visible:border-lead focus-visible:ring-2 focus-visible:ring-lead/20 aria-invalid:border-stop/60";
const textClass = `mt-1.5 ${fieldClass}`;

/** Resolves after the browser has painted twice — long enough for a state update's effects to run. */
const nextPaint = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/**
 * What sits inside the right edge of a checked field: a spinner while the check
 * runs, the tick when it passed, a warning when it did not. Nothing for an empty
 * field — there is nothing to have an opinion about yet.
 */
function FieldStatus({ state }: { state: "checking" | "valid" | "warning" | "invalid" | null }) {
  if (state === "checking") return <Loader2 aria-label="Checking" className="size-4 animate-spin text-faint" strokeWidth={2.2} />;
  if (state === "valid") return <AnimatedTick />;
  if (state === "warning") return <TriangleAlert aria-label="Needs a look" className="size-4 text-hold" strokeWidth={2.2} />;
  if (state === "invalid") return <TriangleAlert aria-label="Not valid" className="size-4 text-stop" strokeWidth={2.2} />;
  return null;
}
const textareaClass =
  "mt-1.5 w-full rounded-inset border border-rule bg-white px-3 py-2 text-sm outline-none transition-[border-color,box-shadow] focus-visible:border-lead focus-visible:ring-2 focus-visible:ring-lead/20";

/**
 * A text input that knows when its value is wrong.
 *
 * Still uncontrolled as far as the form is concerned — `name` and `defaultValue`
 * on a real input — but it keeps its own copy of the value so the message can
 * be worked out in render, and sets the browser's custom validity from it, so a
 * wrong value blocks submit exactly as a missing required one does. The message
 * waits for the first blur: telling someone their postcode is wrong after the
 * first letter is nagging, not checking.
 */
function CheckedInput({
  validate,
  normalise,
  onValue,
  note,
  adornment,
  defaultValue,
  ...props
}: Omit<ComponentProps<"input">, "defaultValue" | "onChange"> & {
  defaultValue: string;
  validate: (value: string) => string | null;
  /** Applied on blur — the canonical form of what was typed. */
  normalise?: (value: string) => string;
  onValue?: (value: string) => void;
  /** Rendered under the field when there is no validation message. */
  note?: (value: string) => ReactNode;
  /**
   * Rendered inside the field's right edge. When given, the field is wrapped to
   * position it, so pass a class without the top margin (`fieldClass`).
   */
  adornment?: (state: { value: string; message: string | null }) => ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);
  const [touched, setTouched] = useState(false);
  // Debounced so "that's not an email" doesn't flash on the second keystroke —
  // it waits for a pause in typing, the same courtesy the message text already
  // gets from `touched`. Blur (below) still resolves it instantly.
  const [debouncedValue, setDebouncedValue] = useState(defaultValue);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), 500);
    return () => clearTimeout(timer);
  }, [value]);
  const message = debouncedValue.trim() ? validate(debouncedValue) : null;

  useEffect(() => {
    ref.current?.setCustomValidity(message ?? "");
  }, [message]);

  const input = (
      <Input
        {...props}
        aria-invalid={touched && message ? true : undefined}
        defaultValue={defaultValue}
        onBlur={(event) => {
          setTouched(true);
          setDebouncedValue(event.target.value);
          if (!normalise || !event.target.value.trim()) return;
          const next = normalise(event.target.value);
          if (next === event.target.value) return;
          event.target.value = next;
          setValue(next);
          setDebouncedValue(next);
          onValue?.(next);
        }}
        onChange={(event) => {
          setValue(event.target.value);
          onValue?.(event.target.value);
        }}
        ref={ref}
      />
  );

  return (
    <>
      {adornment ? (
        <div className="relative mt-1.5">
          {input}
          <span className="pointer-events-none absolute top-1/2 right-3 flex -translate-y-1/2 items-center">
            {adornment({ value, message })}
          </span>
        </div>
      ) : (
        input
      )}
      {touched && message ? <FieldNote tone="stop">{message}</FieldNote> : note?.(value)}
    </>
  );
}

/**
 * Runs `check` on `input` once typing has paused, and returns the result only
 * while it still describes the current input — an answer for "example.or" must
 * not be shown under "example.org".
 */
function useDebouncedCheck<T>(input: string | null, check: (input: string) => Promise<T>) {
  const [answer, setAnswer] = useState<{ input: string; result: T } | null>(null);
  // One flight per input: the debounce and a submit-time flush asking about the
  // same value share it rather than checking twice.
  const inflight = useRef<{ input: string; promise: Promise<T> } | null>(null);

  const run = (value: string): Promise<T> => {
    if (inflight.current?.input === value) return inflight.current.promise;
    const promise = check(value).then((result) => {
      // Stored even if typing has moved on: the read below only shows an
      // answer that matches the current input, so a stale one is inert.
      setAnswer({ input: value, result });
      return result;
    });
    inflight.current = { input: value, promise };
    promise
      .catch(() => {
        // A failed check is not a verdict on the field; show nothing.
      })
      .finally(() => {
        if (inflight.current?.promise === promise) inflight.current = null;
      });
    return promise;
  };

  useEffect(() => {
    if (!input) return;
    const timer = setTimeout(() => {
      run(input).catch(() => undefined);
    }, CHECK_DELAY_MS);
    return () => clearTimeout(timer);
    // `check` is a stable server action reference, and `run` only closes over it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  const current = input && answer?.input === input ? answer.result : null;

  /** The answer for the current input, checking now instead of waiting out the debounce. */
  const flush = async (): Promise<T | null> => {
    if (!input) return null;
    if (answer?.input === input) return answer.result;
    try {
      return await run(input);
    } catch {
      return null;
    }
  };

  return { result: current, checking: Boolean(input) && current === null, flush };
}

/** Loose name comparison: "The Sheffield Trust Ltd" and "Sheffield Trust" agree. */
function sameOrganisation(a: string, b: string): boolean {
  const simplify = (value: string) =>
    value
      .toLowerCase()
      .replace(/\b(the|ltd|limited|cic|cio|trust|charity|uk)\b/g, "")
      .replace(/[^a-z0-9]/g, "");
  const left = simplify(a);
  const right = simplify(b);
  return Boolean(left && right) && (left.includes(right) || right.includes(left));
}

function WebsiteField({
  defaultValue,
  imported,
  onValue,
  registerCheck,
}: {
  defaultValue: string;
  imported: boolean;
  onValue: (value: string) => void;
  /** Hands the form a way to finish this field's check before it submits. */
  registerCheck: (id: string, flush: () => Promise<unknown>) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);
  const { result, checking, flush } = useDebouncedCheck<WebsiteCheck>(value.trim() || null, checkWebsiteField);

  useEffect(() => {
    registerCheck("website", flush);
  }, [flush, registerCheck]);
  const invalidMessage = result?.status === "invalid" ? result.message : null;

  useEffect(() => {
    ref.current?.setCustomValidity(invalidMessage ?? "");
  }, [invalidMessage]);

  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor="website" imported={imported}>
        Website
      </FieldLabel>
      <div className="relative mt-1.5">
      <Input
        aria-invalid={invalidMessage ? true : undefined}
        className={`${fieldClass} pr-10`}
        defaultValue={defaultValue}
        id="website"
        inputMode="url"
        maxLength={500}
        name="website"
        onChange={(event) => {
          setValue(event.target.value);
          onValue(event.target.value);
        }}
        placeholder="https://example.org"
        ref={ref}
        required
      />
        <span className="pointer-events-none absolute top-1/2 right-3 flex -translate-y-1/2 items-center">
          <FieldStatus
            state={
              checking
                ? "checking"
                : result?.status === "reachable"
                  ? "valid"
                  : result?.status === "unreachable"
                    ? "warning"
                    : result?.status === "invalid"
                      ? "invalid"
                      : null
            }
          />
        </span>
      </div>
      {result?.status === "unreachable" ? (
        <FieldNote tone="hold">{result.message}</FieldNote>
      ) : result?.status === "invalid" ? (
        <FieldNote tone="stop">{result.message}</FieldNote>
      ) : result?.status === "error" ? (
        <FieldNote tone="dim">{result.message}</FieldNote>
      ) : null}
    </div>
  );
}

function RegistrationFields({
  defaultName,
  defaultNumber,
  legalName,
  importedName,
  importedNumber,
  onName,
  onNumber,
  registerCheck,
}: {
  defaultName: string;
  defaultNumber: string;
  /** The name typed above, to compare with what the register calls this number. */
  legalName: string;
  importedName: boolean;
  importedNumber: boolean;
  onName: (value: string) => void;
  onNumber: (value: string) => void;
  registerCheck: (id: string, flush: () => Promise<unknown>) => void;
}) {
  const [register, setRegister] = useState<RegisterId | null>(() => registerIdForName(defaultName));
  const [number, setNumber] = useState(defaultNumber);
  const option = REGISTER_OPTIONS.find((candidate) => candidate.id === register) ?? null;

  const shape = register ? normaliseRegistrationNumber(register, number) : null;
  const checkable = register && register !== "other" && shape?.ok ? `${register}|${shape.value}` : null;
  const { result, checking, flush } = useDebouncedCheck<RegistrationCheck>(checkable, (key) => {
    const [id, value] = key.split("|");
    return checkRegistrationField(id, value);
  });

  useEffect(() => {
    registerCheck("registration", flush);
  }, [flush, registerCheck]);

  function chooseRegister(next: string) {
    const id = next as RegisterId;
    setRegister(id);
    onName(REGISTER_OPTIONS.find((candidate) => candidate.id === id)?.name ?? "");
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="registry-name" imported={importedName}>
          Register
        </FieldLabel>
        {register !== "other" && <input name="registryName" type="hidden" value={option?.name ?? ""} />}
        <Select value={register ?? ""} onValueChange={chooseRegister}>
          <SelectTrigger
            className="mt-1.5 h-10 w-full rounded-inset border border-rule bg-white"
            id="registry-name"
          >
            <SelectValue placeholder="Choose a register" />
          </SelectTrigger>
          <SelectContent>
            {REGISTER_OPTIONS.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.id}>
                {candidate.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {register === "other" && (
          <Input
            aria-label="Name of the register"
            className={textClass}
            defaultValue={registerIdForName(defaultName) === "other" ? defaultName : ""}
            maxLength={200}
            name="registryName"
            onChange={(event) => onName(event.target.value)}
            placeholder="Name of the register"
            required
          />
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="registry-number" imported={importedNumber}>
          Number on that register
        </FieldLabel>
        <CheckedInput
          className={`${textClass} font-mono tracking-[0.02em]`}
          defaultValue={defaultNumber}
          id="registry-number"
          maxLength={200}
          name="registryNumber"
          normalise={(value) => {
            const next = register ? normaliseRegistrationNumber(register, value) : null;
            return next?.ok ? next.value : value;
          }}
          note={() => {
            if (!register) return null;
            if (checking) return <Checking />;
            if (!result) return null;
            if (result.status === "found") {
              return (
                <>
                  <FieldNote tone={legalName.trim() && !sameOrganisation(legalName, result.name) ? "hold" : "go"}>
                    {option?.label} holds this number as <strong className="font-semibold">{result.name}</strong>
                    {legalName.trim() && !sameOrganisation(legalName, result.name)
                      ? " — not the name above. Check it is the right number."
                      : "."}
                  </FieldNote>
                  {result.listedOrganisationId && (
                    <FieldNote tone="hold">
                      Already a client.{" "}
                      <Link className="font-semibold underline underline-offset-2" href={`/clients/${result.listedOrganisationId}`}>
                        Open the record
                      </Link>
                    </FieldNote>
                  )}
                  {/* The register's second number for a charity that is also a
                      company. Said here because it is the only place the fact
                      is known before the record exists, and because it changes
                      what the client will carry: two numbers, not one. */}
                  {result.companyNumber && (
                    <FieldNote tone="dim">
                      The register also lists it as a company. Companies House number{" "}
                      <span className="font-mono">{result.companyNumber}</span> — both numbers
                      go on the client record.
                    </FieldNote>
                  )}
                </>
              );
            }
            if (result.status === "not_found") return <FieldNote tone="hold">{result.message}</FieldNote>;
            if (result.status === "unchecked") return <FieldNote tone="dim">{result.message}</FieldNote>;
            return <FieldNote tone="dim">{result.message}</FieldNote>;
          }}
          onValue={(value) => {
            setNumber(value);
            onNumber(value);
          }}
          placeholder={option?.example ? `e.g. ${option.example}` : undefined}
          required
          validate={(value) => {
            if (!register) return "Choose the register first.";
            const next = normaliseRegistrationNumber(register, value);
            return next.ok ? null : next.message;
          }}
        />
      </div>
    </div>
  );
}

/**
 * Values read off a register file for this organisation, waiting to be checked.
 *
 * Distinct from `initialEntry`: a draft is work this CAM already saved, and a
 * prefill is a register's answer they have not accepted yet. Every field takes
 * the prefill first and falls back to the draft, because arriving with a
 * prefill means they chose to replace what was there.
 */
export type ManualEntryPrefill = {
  legalName: string;
  missionStatement: string;
  organisationType: string;
  addressLine1: string;
  city: string;
  postcode: string;
  countryCode: string;
  website: string;
  contactEmail: string;
  registryName: string;
  registryNumber: string;
  /**
   * The register's classification, in the form's own vocabulary, or "".
   *
   * A charity's sector decides its SCOUT sector factor, so a prefilled match
   * that dropped it would score against neutrals while showing the reader the
   * register's classification on the card above. Empty for a company: nothing
   * maps SIC codes to a sector yet.
   */
  sector: string;
};

/**
 * A prefilled value, or the draft's, or nothing.
 *
 * Whitespace-only counts as nothing: a register that publishes an empty string
 * has published nothing, and rendering it would fill the box with invisible
 * content that then reads as the CAM having left it blank on purpose.
 */
function seed(prefilled: string | undefined, stored: string | null | undefined): string {
  return prefilled?.trim() || stored?.trim() || "";
}

/** Joins what is there and drops what is not; null when nothing is. */
function line(parts: readonly (string | null | undefined)[], separator = " · "): string | null {
  const present = parts.map((part) => part?.trim()).filter(Boolean);
  return present.length > 0 ? present.join(separator) : null;
}

function hostOf(website: string | undefined): string | undefined {
  if (!website?.trim()) return undefined;
  try {
    return new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).host.replace(/^www\./, "");
  } catch {
    return website;
  }
}

function formatUkPostcode(value: string): string {
  const compact = value.replace(/\s+/g, "").toUpperCase();
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
}

const REACH_LABELS: Readonly<Record<string, string>> = {
  local: "Local",
  regional: "Regional",
  national: "National",
  international: "International",
};

const WHOLE_NUMBER = /^\d{1,12}$/;

const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });

/** Today as YYYY-MM-DD, the ceiling for an accounts year end. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ManualEntryForm({
  initialEntry,
  isAdmin,
  prefillContactEmail,
  prefill,
  draftId,
  onDraftSaved,
  onClearAll,
  onDirtyChange,
  onSubmitted,
  saveDraftRef,
}: {
  initialEntry: ManualEntryDraft | null;
  isAdmin: boolean;
  prefillContactEmail?: string | null;
  /** Set when the CAM picked a register match above; see the console's note. */
  prefill?: ManualEntryPrefill | null;
  /** The draft this composer has already saved, held by the console. */
  draftId?: string | null;
  onDraftSaved?: (id: string) => void;
  /** Empties the form and deletes its draft; resolves to an error message or null. */
  onClearAll?: () => Promise<string | null>;
  /** Told whenever the form gains or loses changes nobody has saved. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Told when "Add client" / "Submit for review" succeeds outright. */
  onSubmitted?: (entryId: string) => void;
  /** Filled with this form's "Save draft", for the console's leave dialog. */
  saveDraftRef?: RefObject<(() => Promise<string | null>) | null>;
}) {
  const [state, action, pending] = useActionState(saveManualEntry, initialState);
  const [discardState, discardAction, discarding] = useActionState(
    discardImportDraft,
    initialImportState,
  );
  // The draft being edited must outlive both a failed save (whose state carries
  // no entryId) and a remount (a register prefill re-keys this form). Losing it
  // sends the next autosave in with no id, and the RPC inserts a fresh draft —
  // which is how one client became a dozen rows in the drafts list. So the
  // console holds the id, and this state is only the newest word on it.
  const entryId = state.entryId ?? draftId ?? initialEntry?.id ?? "";
  useEffect(() => {
    if (state.entryId) onDraftSaved?.(state.entryId);
  }, [state.entryId, onDraftSaved]);

  // Which imported values are still the imported ones. A field the CAM edits leaves
  // this set immediately, so the badge disappears as they type rather than after a
  // round trip — the label has to stop claiming the value was imported at the
  // moment it stops being true.
  const [importedColumns, setImportedColumns] = useState<string[]>(
    initialEntry?.imported_field_paths ?? [],
  );

  const isImported = (column: string) => importedColumns.includes(column);

  // The seeds, computed once. The fields stay uncontrolled; this copy exists only
  // so each section's summary can say what is in it.
  const [seeded] = useState<Record<string, string>>(() => ({
    legalName: seed(prefill?.legalName, initialEntry?.legal_name),
    missionStatement: seed(prefill?.missionStatement, initialEntry?.mission_statement),
    organisationType: seed(prefill?.organisationType, initialEntry?.organisation_type),
    addressLine1: seed(prefill?.addressLine1, initialEntry?.address_line_1),
    city: seed(prefill?.city, initialEntry?.city),
    postcode: seed(prefill?.postcode, initialEntry?.postcode),
    countryCode: (seed(prefill?.countryCode, initialEntry?.country_code) || "GB").toUpperCase(),
    website: seed(prefill?.website, initialEntry?.website),
    contactEmail: seed(prefill?.contactEmail, initialEntry?.contact_email) || prefillContactEmail || "",
    registryName: seed(prefill?.registryName, initialEntry?.registry_name),
    registryNumber: seed(prefill?.registryNumber, initialEntry?.registry_number),
    sector: seed(prefill?.sector, initialEntry?.sector),
    geographicReach: initialEntry?.geographic_reach ?? "",
    latestIncome: initialEntry?.latest_income != null ? String(initialEntry.latest_income) : "",
    accountsYearEnd: initialEntry?.accounts_year_end ?? "",
    staffCount: initialEntry?.staff_count != null ? String(initialEntry.staff_count) : "",
    volunteerCount: initialEntry?.volunteer_count != null ? String(initialEntry.volunteer_count) : "",
    reason:
      initialEntry?.reason_for_manual_entry ??
      (prefill
        ? `Taken from the ${prefill.registryName} entry${prefill.registryNumber ? ` (${prefill.registryNumber})` : ""} and checked by hand.`
        : initialEntry?.source_url
          ? `Imported from ${initialEntry.source_url} and reviewed by hand.`
          : ""),
  }));
  const [values, setValues] = useState(seeded);
  // The shared-inbox confirmation for the contact email. Pre-ticked when this
  // draft already holds one for the same address; cleared the moment the address
  // changes, because a confirmation is about one address (the RPC enforces that).
  const [roleConfirmed, setRoleConfirmed] = useState(
    Boolean(seeded.contactEmail.trim()) &&
      initialEntry?.contact_email_role_confirmed_for === seeded.contactEmail.trim().toLowerCase(),
  );
  const setValue = (field: string, value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  // Its own state rather than read off the code: typing "GB" into the other-
  // country box must not flip the address into UK mode under the person's hands.
  const [country, setCountry] = useState<"uk" | "abroad">(seeded.countryCode === "GB" ? "uk" : "abroad");
  const inUk = country === "uk";

  const isComplete = (section: SectionId, source = values) =>
    SECTION_FIELDS[section].every((field) => source[field]?.trim()) &&
    (section !== "reason" || source.reason.trim().length >= REASON_MIN);

  // A blank form opens on its first question. A filled one — a draft, a register
  // match, a website import — opens only what still needs something, so the rows
  // that are done stay folded into their summaries.
  const [open, setOpen] = useState<Record<SectionId, boolean>>(() => {
    const started = Object.entries(seeded).some(
      ([field, value]) => field !== "countryCode" && field !== "reason" && value.trim(),
    );
    return Object.fromEntries(
      SECTION_ORDER.map((section) => [
        section,
        started ? !isComplete(section, seeded) : section === "organisation",
      ]),
    ) as Record<SectionId, boolean>;
  });

  const toggle = (section: SectionId) =>
    setOpen((current) => ({ ...current, [section]: !current[section] }));

  // Hands a column back to the person the moment its value stops being the
  // imported one — for the controls that fire no form change event.
  function releaseImported(column: string, value: string) {
    if (!importedColumns.includes(column)) return;
    const original = initialEntry?.[column as keyof ManualEntryDraft];
    if (typeof original === "string" && original.trim() === value.trim()) return;
    setImportedColumns((columns) => columns.filter((entry) => entry !== column));
  }

  function handleOrganisationTypeChange(value: string) {
    setTypeError(null);
    setValue("organisationType", value);
    releaseImported("organisation_type", value);
  }

  // One handler on the form rather than eleven on the fields: change events bubble,
  // and the alternative is threading a callback through every label on the page.
  function handleFieldChange(event: FormEvent<HTMLFormElement>) {
    const target = event.target;
    if (
      !(target instanceof HTMLInputElement) &&
      !(target instanceof HTMLTextAreaElement) &&
      !(target instanceof HTMLSelectElement)
    ) {
      return;
    }

    if (target.name in values) setValue(target.name, target.value);
    if (target.name === "contactEmail") setRoleConfirmed(false);

    const column = FIELD_COLUMNS[target.name];
    if (column) releaseImported(column, target.value);
  }

  /**
   * A required or invalid field inside a closed row cannot be focused, so the
   * browser's own "fill this in" bubble would fail silently and the submit would
   * just not happen. Catch the first invalid field first: if its row is closed,
   * open it and point at the field once the row has finished opening.
   */
  //
  // Checks that run on the server (website, registration number) register a
  // flush here, so submit can finish them first: "Done" may be pressed before a
  // check lands, but "Add client" never goes out on an unanswered one.
  const checks = useRef(new Map<string, () => Promise<unknown>>());
  const registerCheck = (id: string, flush: () => Promise<unknown>) => {
    checks.current.set(id, flush);
  };
  const [verifying, setVerifying] = useState(false);

  /**
   * Saving is always something the person asks for. There is no autosave:
   * a draft exists because "Save draft" was pressed, a client because "Add
   * client" was. What the form does instead is know when it holds changes
   * nobody has saved, so the console can ask before they are thrown away.
   */
  const formRef = useRef<HTMLFormElement>(null);
  const hasContent = Object.entries(values).some(
    ([field, value]) => field !== "countryCode" && field !== "reason" && value.trim(),
  );
  // What the database holds for this form, as field values. A fresh form, or
  // one filled from a register or the inbox, holds nothing saved yet — null —
  // so it counts as changed as soon as there is anything in it.
  const [savedValues, setSavedValues] = useState<Record<string, string> | null>(() =>
    prefill || (!initialEntry && prefillContactEmail) ? null : seeded,
  );
  const dirty = savedValues ? JSON.stringify(values) !== JSON.stringify(savedValues) : hasContent;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // Which button the in-flight action belongs to, so "Adding…" only ever shows
  // after "Add client" and "Saving…" only after "Save draft". The values sent
  // with it become the saved baseline once it succeeds.
  const [pendingIntent, setPendingIntent] = useState<"submit" | "draft" | null>(null);
  const [sentValues, setSentValues] = useState(values);
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state.kind === "success" || state.kind === "warning") setSavedValues(sentValues);
  }

  // A clean submit closes the form: the console goes back to the lists, which
  // say where the client went and link to it. A warning (possible duplicate,
  // failed activation) stays here, because it needs reading and acting on.
  useEffect(() => {
    if (pendingIntent === "submit" && state.kind === "success" && state.entryId) {
      onSubmitted?.(state.entryId);
    }
  }, [state, pendingIntent, onSubmitted]);

  // Dispatched by hand rather than as a form submit: React 19 resets an
  // uncontrolled <form> after an action bound to it succeeds, which would put
  // every field back to what it was seeded with while `values` kept the edits.
  function handleSaveDraft() {
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);
    formData.set("intent", "draft");
    setPendingIntent("draft");
    setSentValues(values);
    startTransition(() => action(formData));
  }

  // The leave dialog's "Save as draft". Calls the action directly because the
  // dialog has to know whether it worked before it lets the person leave.
  useEffect(() => {
    if (!saveDraftRef) return;
    saveDraftRef.current = async () => {
      if (!formRef.current) return "The form could not be read. Please try again.";
      const formData = new FormData(formRef.current);
      formData.set("intent", "draft");
      const snapshot = values;
      const result = await saveManualEntry(state, formData);
      if (result.kind === "error") return result.message;
      if (result.entryId) onDraftSaved?.(result.entryId);
      setSavedValues(snapshot);
      return null;
    };
    return () => {
      saveDraftRef.current = null;
    };
  }, [saveDraftRef, values, state, onDraftSaved]);

  // Enter in a text field would submit the form through its first button —
  // "Add client". Adding a client takes a click on that button, nothing less.
  function blockImplicitSubmit(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
  }

  // The type is a custom select, so the browser's required-field check cannot
  // see it; without this a submit with no type went all the way to the server.
  const [typeError, setTypeError] = useState<string | null>(null);

  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  // "Clear all" asks once, in place. On success the console re-keys this form,
  // so there is no state here to reset afterwards.
  async function handleClearAll() {
    if (!onClearAll) return;
    setClearing(true);
    setClearError(null);
    const message = await onClearAll();
    if (message) {
      setClearError(message);
      setClearing(false);
      setConfirmingClear(false);
    }
  }

  async function handleSubmitClick(event: MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;
    if (!form) return;
    event.preventDefault();

    setVerifying(true);
    try {
      await Promise.all(Array.from(checks.current.values(), (flush) => flush()));
      // The answers land as state; their validity effects run after the paint.
      await nextPaint();
    } catch {
      // A check that could not run is not a failure of the form.
    }

    const invalid = Array.from(form.elements).filter(
      (element): element is HTMLInputElement | HTMLTextAreaElement =>
        (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
        element.type !== "hidden" &&
        !element.validity.valid,
    );

    const typeMissing = !values.organisationType;
    if (typeMissing) setTypeError("Choose a type.");

    if (invalid.length === 0 && !typeMissing) {
      setPendingIntent("submit");
      setSentValues(values);
      // Dispatched by hand, like handleSaveDraft: a native submit through the
      // form's action lets React 19 reset every uncontrolled field when the
      // action returns — including when it returns an error, which emptied the
      // form the moment a refusal (a personal-looking email) came back.
      const formData = new FormData(form);
      formData.set("intent", "submit");
      startTransition(() => action(formData));
      setVerifying(false);
      return;
    }
    setVerifying(false);

    if (invalid.length === 0) {
      if (!open.organisation) setOpen((current) => ({ ...current, organisation: true }));
      setTimeout(() => document.getElementById("type")?.focus(), open.organisation ? 0 : 340);
      return;
    }

    // Every row holding a problem opens, not just the first — the person sees
    // all of what is left in one pass rather than one row per submit.
    const closed = new Set<SectionId>();
    if (typeMissing && !open.organisation) closed.add("organisation");
    for (const element of invalid) {
      const section = element.closest<HTMLElement>("[data-disclosure]")?.dataset.disclosure as
        | SectionId
        | undefined;
      if (section && !open[section]) closed.add(section);
    }
    if (closed.size > 0) {
      setOpen((current) => {
        const next = { ...current };
        for (const section of closed) next[section] = true;
        return next;
      });
    }
    setTimeout(() => invalid[0].reportValidity(), closed.size > 0 ? 340 : 0);
  }

  const summaryFor = (section: SectionId, filled: string | null) =>
    isComplete(section) ? filled : filled ? `${filled} — something still missing` : null;

  // Green when done, amber once anything is in it, nothing for an untouched row.
  // The country code does not count as "anything": it is always set.
  const statusFor = (section: SectionId) =>
    isComplete(section)
      ? "complete"
      : SECTION_FIELDS[section].some((field) => field !== "countryCode" && values[field]?.trim())
        ? "incomplete"
        : null;

  const registerLabel =
    REGISTER_OPTIONS.find((option) => option.id !== "other" && option.name === values.registryName)?.label ??
    values.registryName;

  return (
    <>
      {initialEntry?.source_url && (
        <section className="mb-4 rounded-panel border border-lead/15 bg-lead-wash px-5 py-4 text-sm text-ink">
          <p className="text-[13px] font-semibold text-lead">
            Read from their website
          </p>
          <p className="mt-1 leading-[1.7]">
            The fields marked <span className="font-bold">Imported</span> were filled from{" "}
            <a
              className="font-bold underline underline-offset-2"
              href={initialEntry.source_url}
              rel="noreferrer nofollow noopener"
              target="_blank"
            >
              {initialEntry.source_url}
            </a>{" "}
            and confirmed against public registers. Check every one of them before you submit —
            nothing here is saved as a client until you do.
          </p>
          {initialEntry.import_notes.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5">
              {initialEntry.import_notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          <form action={discardAction} className="mt-3">
            <input name="entryId" type="hidden" value={initialEntry.id} />
            <OriginButton
              variant="outline"
              size="sm"
              disabled={discarding}
              loading={discarding}
              type="submit"
            >
              {discarding ? "Discarding…" : "Discard this import"}
            </OriginButton>
          </form>
          {discardState.message && (
            <div className="mt-2">
              <InlineAlert
                variant="inline"
                tone={discardState.kind === "error" ? "error" : "neutral"}
                message={discardState.message}
              />
            </div>
          )}
        </section>
      )}

      <form
        // No `action`: both buttons dispatch the server action themselves (see
        // handleSubmitClick / handleSaveDraft), so React never auto-resets the
        // fields. Anything that still reaches a native submit is a no-op.
        className="space-y-5"
        onSubmit={(event) => event.preventDefault()}
        onChange={handleFieldChange}
        onKeyDown={blockImplicitSubmit}
        ref={formRef}
      >
        <input name="entryId" type="hidden" value={entryId} />
        {initialEntry?.source_url && (
          <input name="importedFieldPaths" type="hidden" value={JSON.stringify(importedColumns)} />
        )}

        <div className="rounded-panel border border-rule bg-white px-5">
          <DisclosureSection
            id="organisation"
            onToggle={() => toggle("organisation")}
            open={open.organisation}
            status={statusFor("organisation")}
            summary={summaryFor(
              "organisation",
              line([values.legalName, TYPE_LABELS[values.organisationType]]),
            )}
            title="Organisation"
          >
            <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_14rem]">
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="legal-name" imported={isImported("legal_name")}>
                  Name
                </FieldLabel>
                <Input
                  id="legal-name"
                  className={textClass}
                  defaultValue={seeded.legalName}
                  maxLength={200}
                  name="legalName"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="type" imported={isImported("organisation_type")}>
                  Type
                </FieldLabel>
                <input name="organisationType" type="hidden" value={values.organisationType} />
                <Select value={values.organisationType} onValueChange={handleOrganisationTypeChange}>
                  <SelectTrigger
                    id="type"
                    className="mt-1.5 h-10 w-full rounded-inset border border-rule bg-white"
                  >
                    <SelectValue placeholder="Choose a type" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {typeError && <p className="text-[12.5px] text-stop">{typeError}</p>}
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <FieldLabel htmlFor="mission" imported={isImported("mission_statement")}>
                  Mission
                </FieldLabel>
                <Textarea
                  id="mission"
                  className={textareaClass}
                  defaultValue={seeded.missionStatement}
                  maxLength={5000}
                  name="missionStatement"
                  placeholder="What the organisation does, in its own words or yours."
                  required
                  rows={4}
                />
              </div>
            </div>
          </DisclosureSection>

          <DisclosureSection
            id="address"
            onToggle={() => toggle("address")}
            open={open.address}
            status={statusFor("address")}
            summary={summaryFor(
              "address",
              values.addressLine1.trim() || values.city.trim()
                ? line([
                    line([values.addressLine1, values.city], ", "),
                    values.postcode,
                    inUk ? "UK" : values.countryCode,
                  ])
                : null,
            )}
            title="Address"
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="country" imported={isImported("country_code")}>
                  Country
                </FieldLabel>
                <CountryField
                  defaultCode={seeded.countryCode}
                  id="country"
                  onCodeChange={(code) => {
                    setCountry(code === "GB" ? "uk" : "abroad");
                    setValue("countryCode", code);
                    releaseImported("country_code", code);
                  }}
                />
              </div>
              <div aria-hidden className="hidden sm:block" />
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <FieldLabel htmlFor="addr" imported={isImported("address_line_1")}>
                  Address line 1
                </FieldLabel>
                <Input
                  id="addr"
                  className={textClass}
                  defaultValue={seeded.addressLine1}
                  maxLength={300}
                  name="addressLine1"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="city" imported={isImported("city")}>
                  Town or city
                </FieldLabel>
                <UkTownField
                  className={textClass}
                  defaultValue={seeded.city}
                  id="city"
                  // Remounted on a country switch so the strictness and the
                  // stored text agree with each other from the first render.
                  key={inUk ? "uk" : "abroad"}
                  onValueChange={(value) => {
                    setValue("city", value);
                    releaseImported("city", value);
                  }}
                  strict={inUk}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="postcode" imported={isImported("postcode")}>
                  {inUk ? "Postcode" : "Postal code"}
                </FieldLabel>
                <CheckedInput
                  className={`${textClass} ${inUk ? "uppercase" : ""}`}
                  defaultValue={seeded.postcode}
                  id="postcode"
                  key={inUk ? "uk" : "abroad"}
                  maxLength={32}
                  name="postcode"
                  normalise={inUk ? formatUkPostcode : undefined}
                  placeholder={inUk ? "e.g. S1 2HE" : undefined}
                  required
                  validate={(value) =>
                    inUk && !UK_POSTCODE.test(value.trim())
                      ? "That is not a UK postcode — it should look like S1 2HE."
                      : null
                  }
                />
              </div>
            </div>
          </DisclosureSection>

          <DisclosureSection
            id="contact"
            onToggle={() => toggle("contact")}
            open={open.contact}
            status={statusFor("contact")}
            summary={summaryFor("contact", line([hostOf(values.website), values.contactEmail]))}
            title="Website and contact"
          >
            <div className="grid gap-5">
              <WebsiteField
                defaultValue={seeded.website}
                imported={isImported("website")}
                onValue={(value) => setValue("website", value)}
                registerCheck={registerCheck}
              />
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="email" imported={isImported("contact_email")}>
                  Contact email
                </FieldLabel>
                <CheckedInput
                  adornment={({ value, message }) => (
                    <FieldStatus state={!value.trim() ? null : message ? "invalid" : "valid"} />
                  )}
                  className={`${fieldClass} pr-10`}
                  defaultValue={seeded.contactEmail}
                  id="email"
                  inputMode="email"
                  maxLength={320}
                  name="contactEmail"
                  normalise={(value) => value.trim()}
                  placeholder="hello@example.org"
                  required
                  type="text"
                  validate={(value) =>
                    EMAIL.test(value.trim()) ? null : "That is not an email address — it should look like hello@example.org."
                  }
                />
              </div>
            </div>
          </DisclosureSection>

          <DisclosureSection
            id="registration"
            onToggle={() => toggle("registration")}
            open={open.registration}
            status={statusFor("registration")}
            summary={summaryFor("registration", line([registerLabel, values.registryNumber]))}
            title="Registration"
          >
            <RegistrationFields
              defaultName={seeded.registryName}
              defaultNumber={seeded.registryNumber}
              importedName={isImported("registry_name")}
              importedNumber={isImported("registry_number")}
              legalName={values.legalName}
              onName={(value) => {
                setValue("registryName", value);
                releaseImported("registry_name", value);
              }}
              onNumber={(value) => setValue("registryNumber", value)}
              registerCheck={registerCheck}
            />
          </DisclosureSection>

          <DisclosureSection
            id="size"
            onToggle={() => toggle("size")}
            open={open.size}
            status={
              values.sector || values.geographicReach || values.latestIncome || values.staffCount || values.volunteerCount
                ? (values.latestIncome || values.staffCount || values.volunteerCount) && !values.accountsYearEnd
                  ? "incomplete"
                  : "complete"
                : null
            }
            summary={
              line([
                values.sector,
                REACH_LABELS[values.geographicReach],
                WHOLE_NUMBER.test(values.latestIncome) ? `${GBP.format(Number(values.latestIncome))} income` : undefined,
                WHOLE_NUMBER.test(values.staffCount) ? `${values.staffCount} staff` : undefined,
                WHOLE_NUMBER.test(values.volunteerCount) ? `${values.volunteerCount} volunteers` : undefined,
              ]) ?? "Optional — sector, reach, income, staff and volunteers"
            }
            title="Size and focus"
          >
            {/* Optional, and worth giving: the priority score reads sector and
                income, CAM queues match on reach, and staff and volunteers fill
                the record's Headcount tick. Figures are filed as one set of
                accounts, so they need the year end they are from. */}
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="sector">Sector</FieldLabel>
                <input name="sector" type="hidden" value={values.sector} />
                <Select
                  value={values.sector}
                  onValueChange={(value) => setValue("sector", value === "__none" ? "" : value)}
                >
                  <SelectTrigger className="mt-1.5 h-10 w-full rounded-inset border border-rule bg-white" id="sector">
                    <SelectValue placeholder="Choose a sector" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="__none">Not sure</SelectItem>
                    {Object.entries(SECTOR_TAXONOMY).map(([category, presets]) => (
                      <SelectGroup key={category}>
                        <SelectLabel>{category}</SelectLabel>
                        {presets.map((preset) => (
                          <SelectItem key={preset} value={preset}>
                            {preset}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="geographic-reach">Where it works</FieldLabel>
                <input name="geographicReach" type="hidden" value={values.geographicReach} />
                <Select
                  value={values.geographicReach}
                  onValueChange={(value) => setValue("geographicReach", value === "__none" ? "" : value)}
                >
                  <SelectTrigger
                    className="mt-1.5 h-10 w-full rounded-inset border border-rule bg-white"
                    id="geographic-reach"
                  >
                    <SelectValue placeholder="Choose how far it reaches" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Not sure</SelectItem>
                    <SelectItem value="local">Local — one town or area</SelectItem>
                    <SelectItem value="regional">Regional — several areas</SelectItem>
                    <SelectItem value="national">National — across the UK</SelectItem>
                    <SelectItem value="international">International</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="latest-income">Annual income</FieldLabel>
                <CheckedInput
                  className={`${textClass} tabular-nums`}
                  defaultValue={seeded.latestIncome}
                  id="latest-income"
                  inputMode="numeric"
                  maxLength={12}
                  name="latestIncome"
                  normalise={(value) => value.replace(/[£,\s]/g, "")}
                  placeholder="e.g. 250000"
                  validate={(value) =>
                    WHOLE_NUMBER.test(value.replace(/[£,\s]/g, "")) ? null : "A whole number of pounds, like 250000."
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="accounts-year-end">Accounts year end</FieldLabel>
                <Input
                  className={textClass}
                  defaultValue={seeded.accountsYearEnd}
                  id="accounts-year-end"
                  max={today()}
                  name="accountsYearEnd"
                  // Required only once a figure is given — the figures describe
                  // a year of accounts, and that year has to end somewhere.
                  required={Boolean(values.latestIncome || values.staffCount || values.volunteerCount)}
                  type="date"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="staff-count">Staff</FieldLabel>
                <CheckedInput
                  className={`${textClass} tabular-nums`}
                  defaultValue={seeded.staffCount}
                  id="staff-count"
                  inputMode="numeric"
                  maxLength={7}
                  name="staffCount"
                  placeholder="e.g. 12"
                  validate={(value) => (WHOLE_NUMBER.test(value.trim()) ? null : "A whole number, like 12.")}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="volunteer-count">Volunteers</FieldLabel>
                <CheckedInput
                  className={`${textClass} tabular-nums`}
                  defaultValue={seeded.volunteerCount}
                  id="volunteer-count"
                  inputMode="numeric"
                  maxLength={7}
                  name="volunteerCount"
                  placeholder="e.g. 40"
                  validate={(value) => (WHOLE_NUMBER.test(value.trim()) ? null : "A whole number, like 40.")}
                />
              </div>
            </div>
          </DisclosureSection>

          <DisclosureSection
            id="reason"
            onToggle={() => toggle("reason")}
            open={open.reason}
            status={statusFor("reason")}
            summary={
              values.reason.trim()
                ? values.reason.trim().length < REASON_MIN
                  ? "A few more words needed"
                  : values.reason.trim()
                : null
            }
            title="Why edit manually"
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor="reason" className="text-[13px] font-semibold text-dim">
                Explain why a register lookup or import wasn&apos;t enough
              </label>
              <Textarea
                id="reason"
                className={textareaClass}
                defaultValue={seeded.reason}
                maxLength={2000}
                minLength={REASON_MIN}
                name="reason"
                required
                rows={3}
              />
            </div>
          </DisclosureSection>
        </div>

        {isAdmin && (
          <label
            className="flex cursor-pointer items-start gap-3 rounded-panel border border-rule bg-white px-5 py-4 text-sm leading-[1.65] text-ink"
            htmlFor="admin-confirmed-eligible"
          >
            <Checkbox
              className="mt-0.5"
              id="admin-confirmed-eligible"
              name="adminConfirmedEligible"
              size="sm"
              value="on"
            />
            <span>
              I confirm this organisation meets 180 Degrees Consulting client criteria.
            </span>
          </label>
        )}

        {/* F247 override: offered once the address has been refused as personal,
            or when this draft already carries a confirmation. It sits right above
            the refusal, beside the buttons, so the fix is where the person is
            already looking — the contact row may be folded away up the page.
            Ticking it is a recorded statement — who and when — that an admin sees
            at review, not a switch that turns the rule off. */}
        {(state.needsRoleConfirmation || roleConfirmed) && (
          <label className="flex items-start gap-2 rounded-inset border border-hold/25 bg-hold-wash px-3 py-2.5 text-[13px] leading-[1.5] text-ink">
            <input
              checked={roleConfirmed}
              className="mt-1 accent-[var(--color-lead)]"
              name="contactEmailRoleConfirmed"
              onChange={(event) => setRoleConfirmed(event.target.checked)}
              type="checkbox"
              value="on"
            />
            <span>
              <span className="font-semibold">{values.contactEmail.trim() || "This address"}</span> is the
              organisation&rsquo;s shared inbox, not a named person&rsquo;s address. Your name is
              recorded with this confirmation
              {isAdmin ? "." : ", and an admin checks it before the client is added."}
            </span>
          </label>
        )}
        {state.message && (
          <InlineAlert
            variant="page"
            tone={
              state.kind === "success" ? "success" : state.kind === "warning" ? "warning" : "error"
            }
            message={state.message}
          />
        )}
        {state.warnings && state.warnings.length > 0 && (
          <div className="rounded-panel border border-hold/20 bg-hold-wash px-5 py-4">
            <p className="text-sm font-bold text-hold">Saved with field warnings</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-hold">
              {state.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
        {state.organisationId && (
          <Link
            className="group inline-flex items-center gap-1 text-sm font-semibold text-lead hover:underline"
            href={`/clients/${state.organisationId}`}
          >
            Open the client
            <ArrowRight aria-hidden className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <OriginButton
            size="md"
            disabled={pending}
            loading={pending}
            name="intent"
            onClick={handleSubmitClick}
            type="submit"
            value="submit"
          >
            {verifying
              ? "Checking…"
              : pending && pendingIntent === "submit"
                ? isAdmin
                  ? "Adding…"
                  : "Submitting…"
                : isAdmin
                  ? "Add client"
                  : "Submit for review"}
          </OriginButton>
          <OriginButton
            variant="outline"
            size="md"
            disabled={pending}
            loading={pending && pendingIntent === "draft"}
            onClick={handleSaveDraft}
            type="button"
          >
            {pending && pendingIntent === "draft" ? "Saving…" : "Save draft"}
          </OriginButton>
          <p className="text-[13px] text-dim">
            {dirty
              ? "Unsaved changes"
              : isAdmin
                ? ""
                : "An admin approves it before it joins the client list."}
          </p>
          {onClearAll && (hasContent || entryId) && (
            <span className="ml-auto flex items-center gap-1.5 text-[13px] font-semibold">
              {confirmingClear ? (
                <>
                  <span className="font-normal text-dim">
                    {entryId ? "Clear every field and delete this draft?" : "Clear every field?"}
                  </span>
                  <button
                    className="cursor-pointer rounded-inset border border-stop/30 px-2 py-0.5 text-stop transition-colors hover:bg-stop/10 disabled:cursor-default disabled:opacity-60"
                    disabled={clearing || pending}
                    onClick={handleClearAll}
                    type="button"
                  >
                    {clearing ? "Clearing…" : "Clear"}
                  </button>
                  <button
                    className="cursor-pointer rounded-inset px-2 py-0.5 text-dim transition-colors hover:text-ink disabled:cursor-default disabled:opacity-60"
                    disabled={clearing}
                    onClick={() => setConfirmingClear(false)}
                    type="button"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  className="cursor-pointer rounded-inset px-2 py-0.5 text-dim transition-colors hover:text-stop disabled:cursor-default disabled:opacity-60"
                  disabled={pending || verifying}
                  onClick={() => setConfirmingClear(true)}
                  type="button"
                >
                  Clear all
                </button>
              )}
            </span>
          )}
        </div>
        {clearError && <InlineAlert variant="inline" tone="error" message={clearError} />}
      </form>
    </>
  );
}
