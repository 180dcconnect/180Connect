"use client";

import { useId, useState, useTransition, type ReactNode } from "react";
import { Check, ChevronRight, Loader2, Lock, TriangleAlert, Unlock } from "lucide-react";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Switch } from "@/components/ui/material-design-3-switch";
import { Rise } from "@/components/dashboard-stage";
import { Pill } from "@/app/(app)/clients/[id]/section-card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  catalogueKey,
  findCatalogueEntry,
  RULE_CATALOGUE,
  ruleEffect,
  ruleKey,
  SOURCE_LABELS,
  sourceLabel,
  type CatalogueEntry,
} from "@/lib/data-handling-catalogue";
import { createRule, loadRules, toggleRuleActive, type RuleRow } from "./actions";
import { ObservedFieldPicker } from "./observed-field-picker";
import {
  CARD,
  CARD_HINT,
  CARD_TITLE,
  FIELD_LABEL,
  FOOTNOTE,
  INPUT,
  PRIMARY_BUTTON,
  QUIET_BUTTON,
  ROW,
  SELECT_CONTENT,
  SELECT_GROUP_LABEL,
  SELECT_ITEM,
  SELECT_TRIGGER,
} from "../styles";

type Notice = { tone: "success" | "error"; text: string } | null;

const GLOBAL_SOURCE = "__every_source";

function ruleName(rule: RuleRow): { label: string; description: string } {
  const entry = findCatalogueEntry(rule.source, rule.field_path, rule.rule_kind);
  if (entry) return { label: entry.label, description: entry.description };
  // A rule added through the developer form has no catalogue entry; its recorded
  // reason is the best plain description there is.
  return { label: "Custom protection", description: rule.reason };
}

function groupBySource<T>(items: T[], sourceOf: (item: T) => string | null) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const label = sourceLabel(sourceOf(item));
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }
  // "Every source" first — it is the widest protection — then alphabetical.
  return [...groups.entries()].sort(([a], [b]) =>
    a === "Every source" ? -1 : b === "Every source" ? 1 : a.localeCompare(b),
  );
}

function EffectPill({ rule }: { rule: RuleRow }) {
  if (rule.action === "allow") return <Pill tone="hold">Kept (exception)</Pill>;
  return ruleEffect(rule.rule_kind) === "removed" ? (
    <Pill tone="neutral" dot={false}>Removed</Pill>
  ) : (
    <Pill tone="neutral" dot={false}>Blanked out</Pill>
  );
}

/**
 * F246 / F247 — the protections list, turning protections on and off, and a
 * developer form for anything the catalogue does not cover.
 *
 * Plain names come from `src/lib/data-handling-catalogue.ts`. Turning a
 * protection off asks first, because it is the one action here that weakens
 * privacy: personal data starts being saved from the next import.
 *
 * ── The order of the cards ──
 *
 * The reader arrives with one question — "is our data handling right?" — so the
 * two cards that answer it come first: what is protected, then what the
 * protections have actually removed. The card that *changes* them sits last,
 * under its own heading, and `removedSoFar` is a slot rather than a third card
 * here for exactly that reason: the evidence card is the page's to render, and
 * it has to land between the two. Putting the form in the middle split the
 * reading and pushed the evidence below a developer form, which is the wrong
 * way round for the job people come here to do.
 */
export function RulesPanel({
  initialRules,
  initialVersion,
  readOnly = false,
  removedSoFar,
}: {
  initialRules: RuleRow[];
  initialVersion: number;
  readOnly?: boolean;
  /** "What has been removed so far" — see the note above on card order. */
  removedSoFar?: ReactNode;
}) {
  const [rules, setRules] = useState(initialRules);
  const [version, setVersion] = useState(initialVersion);
  const [notice, setNotice] = useState<Notice>(null);
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  // Turning a protection off is the one action here that weakens privacy, so it
  // waits in this pending slot until the admin confirms in the sticky bar at the
  // bottom of the screen (the same position as the score settings save bar).
  // The switch itself is controlled and stays visibly on until then — the
  // turn-off animation plays when the save lands and the row refreshes. The row
  // never leaves the list: off protections stay where they are with their switch
  // off, so turning one back on is the same toggle.
  const [pendingOffId, setPendingOffId] = useState<string | null>(null);
  const [chosenKey, setChosenKey] = useState("");
  const [devSource, setDevSource] = useState(GLOBAL_SOURCE);
  const [devAction, setDevAction] = useState<"deny" | "allow">("deny");
  const chooseId = useId();
  const devSourceId = useId();
  const devActionId = useId();

  const activeCount = rules.filter((rule) => rule.is_active).length;
  // Every rule ever added stays in the main list, on or off — so the picker and
  // the dropdown below only offer what is not already there.
  const existingKeys = new Set(
    rules.map((rule) => ruleKey(rule.source, rule.field_path, rule.rule_kind)),
  );
  const available = RULE_CATALOGUE.filter((entry) => !existingKeys.has(catalogueKey(entry)));
  const pendingRule = rules.find((rule) => rule.id === pendingOffId) ?? null;
  const chosen = available.find((entry) => catalogueKey(entry) === chosenKey) ?? null;

  async function refresh() {
    const result = await loadRules();
    if (!result.error) {
      setRules(result.rules);
      setVersion(result.version);
    }
  }

  function report(result: Awaited<ReturnType<typeof createRule>>) {
    setNotice(result.ok ? { tone: "success", text: result.message } : { tone: "error", text: result.error });
  }

  function toggle(rule: RuleRow, isActive: boolean) {
    setNotice(null);
    setBusyId(rule.id);
    startTransition(async () => {
      const result = await toggleRuleActive(rule.id, isActive);
      report(result);
      setPendingOffId(null);
      setBusyId(null);
      if (result.ok) await refresh();
    });
  }

  function turnOn(entry: CatalogueEntry) {
    setNotice(null);
    // Turning a known protection back on reuses its old row, so its history stays
    // in one place rather than starting a second copy.
    const previous = rules.find(
      (rule) =>
        !rule.is_active &&
        ruleKey(rule.source, rule.field_path, rule.rule_kind) === catalogueKey(entry),
    );
    if (previous) {
      toggle(previous, true);
      setChosenKey("");
      return;
    }
    const formData = new FormData();
    formData.set("source", entry.source ?? "");
    formData.set("field_path", entry.fieldPath);
    formData.set("action", "deny");
    formData.set("rule_kind", entry.ruleKind);
    formData.set("reason", entry.reason);
    startTransition(async () => {
      const result = await createRule(formData);
      report(result);
      if (result.ok) {
        setChosenKey("");
        await refresh();
      }
    });
  }

  function submitDeveloperRule(formData: FormData) {
    setNotice(null);
    formData.set("source", devSource === GLOBAL_SOURCE ? "" : devSource);
    formData.set("action", devAction);
    formData.set("rule_kind", "field_path");
    startTransition(async () => {
      const result = await createRule(formData);
      report(result);
      if (result.ok) await refresh();
    });
  }

  const availableGroups = groupBySource(available, (entry) => entry.source);

  return (
    <>
      {notice && (
        <Rise>
          <p
            aria-live="polite"
            role={notice.tone === "error" ? "alert" : undefined}
            className={`flex items-center gap-1.5 rounded-panel border px-4 py-3 text-[13px] font-semibold ${
              notice.tone === "error"
                ? "border-stop/30 bg-stop-wash text-stop"
                : "border-go/30 bg-go-wash text-go"
            }`}
          >
            {notice.tone === "success" && (
              <Check aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.5} />
            )}
            {notice.text}
          </p>
        </Rise>
      )}

      <Rise>
        <section aria-labelledby="protections-heading" className={CARD}>
          <h2 id="protections-heading" className={CARD_TITLE}>
            What we never save
          </h2>
          <p className={CARD_HINT}>
            When the platform imports clients from public registers, these personal
            details are removed before anything is saved. Changes apply from the
            next import.
          </p>

          {rules.length === 0 ? (
            <p className={`mt-4 ${ROW} text-[13px] text-stop`}>
              No protections are on — personal details from imports are being saved.
              Turn protections on below.
            </p>
          ) : (
            <>
              {activeCount === 0 && (
                <p className="mt-4 rounded-inset bg-stop-wash px-3 py-2.5 text-[13px] font-medium text-stop">
                  No protections are on — personal details from imports are being saved.
                  Turn one back on below.
                </p>
              )}
              {groupBySource(rules, (rule) => rule.source).map(([group, groupRules]) => (
                <div key={group} className="mt-5">
                  <h3 className="text-[13px] font-medium text-ink">From {group}</h3>
                  <ul className="mt-1">
                    {groupRules.map((rule) => {
                      const { label, description } = ruleName(rule);
                      const turnOffNote = `From the next import, ${label.toLowerCase()} will be saved again.`;
                      const turnOnNote = `From the next import, ${label.toLowerCase()} will be removed again.`;
                      // The note is real text in the row, not just tooltip copy: a
                      // tooltip is only announced while it is open, so the switch
                      // points at this instead. `aria-description` would be shorter
                      // and is not yet supported on `role="switch"`.
                      const turnNoteId = `protection-note-${rule.id}`;
                      return (
                        <li key={rule.id} className={`${ROW} items-start`}>
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                              {label}
                              <EffectPill rule={rule} />
                              {!rule.is_active && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-paper px-2 py-0.5 text-[11px] font-medium text-dim">
                                  Off
                                </span>
                              )}
                            </p>
                            <p className="mt-1 text-[13px] leading-[1.55] text-dim">{description}</p>
                          </div>
                          {!readOnly && (
                            // A switch has no room to say what it does, and this is
                            // the control that decides whether a personal detail is
                            // saved. The sentence below is the confirmation's own
                            // wording, so the hover and the bottom bar agree.
                            <>
                              <span id={turnNoteId} className="sr-only">
                                {rule.is_active ? turnOffNote : turnOnNote}
                              </span>
                              <InfoTooltip
                                title={rule.is_active ? "Turning this off" : "Turning this on"}
                                content={rule.is_active ? turnOffNote : turnOnNote}
                                side="top"
                                align="end"
                              >
                                <span className="inline-flex">
                                  <Switch
                                    role="switch"
                                    aria-label={`${label} protection from ${group}`}
                                    aria-describedby={turnNoteId}
                                    checked={rule.is_active}
                                    onCheckedChange={(nextChecked) => {
                                      if (nextChecked) {
                                        if (!rule.is_active) toggle(rule, true);
                                      } else if (rule.is_active) {
                                        // The switch stays on until the bottom bar
                                        // confirms — flipping it here would lie
                                        // about what is saved.
                                        setNotice(null);
                                        setPendingOffId(rule.id);
                                      }
                                    }}
                                    disabled={isPending}
                                    variant="destructive"
                                    showIcons
                                    checkedIcon={<Lock aria-hidden="true" className="size-3" />}
                                    uncheckedIcon={<Unlock aria-hidden="true" className="size-3" />}
                                  />
                                </span>
                              </InfoTooltip>
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </>
          )}
        </section>
      </Rise>

      {removedSoFar}

      {!readOnly && (
        <>
        {/* The one screen in Settings where a non-technical admin can do real
            damage without any visible sign: a protection that quietly matches
            nothing looks exactly like one that works, and the list above says
            "on" either way. So the section is labelled as a developer's job
            before anyone starts choosing from it — as a heading rather than a
            tinted card, since most of what is under it is ordinary. */}
        <Rise>
          <section aria-labelledby="danger-zone-heading">
            <div className="flex items-baseline gap-2">
              <TriangleAlert
                aria-hidden="true"
                className="size-[15px] shrink-0 self-center text-stop/70"
                strokeWidth={2.2}
              />
              <h2
                id="danger-zone-heading"
                className="font-body text-[19px] leading-[1.3] font-normal tracking-[-0.01em] text-stop"
              >
                Danger zone
              </h2>
            </div>
            <p className="mt-1.5 text-[13px] leading-[1.55] text-dim">
              If something here needs changing, it is better to ask a developer than
              to guess.
            </p>
          </section>
        </Rise>
        <Rise>
          <section aria-labelledby="turn-on-heading" className={CARD}>
          <h2 id="turn-on-heading" className={CARD_TITLE}>
            Turn a protection on
          </h2>
          <p className={CARD_HINT}>
            Choose the kind of personal detail to keep out of imports.
            {available.length === 0 && (
              <>
                {" "}
                <span className="text-ink">
                  Every protection the platform knows about is already on.
                </span>
              </>
            )}
          </p>

          {available.length > 0 && (
            <div className="mt-4 space-y-4 border-t border-rule-soft pt-4">
              <div>
                <label htmlFor={chooseId} className={FIELD_LABEL}>
                  Keep out
                </label>
                <Select value={chosenKey} onValueChange={setChosenKey}>
                  <SelectTrigger id={chooseId} className={`mt-2 ${SELECT_TRIGGER}`}>
                    <SelectValue placeholder="Choose a personal detail…" />
                  </SelectTrigger>
                  <SelectContent position="popper" className={SELECT_CONTENT}>
                    {availableGroups.map(([group, entries]) => (
                      <SelectGroup key={group}>
                        <SelectLabel className={SELECT_GROUP_LABEL}>From {group}</SelectLabel>
                        {entries.map((entry) => (
                          <SelectItem
                            key={catalogueKey(entry)}
                            value={catalogueKey(entry)}
                            className={SELECT_ITEM}
                          >
                            {entry.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
                {chosen && (
                  <p className="mt-2 rounded-inset bg-paper px-3 py-2 text-[13px] leading-[1.55] text-dim">
                    {chosen.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => chosen && turnOn(chosen)}
                disabled={!chosen || isPending}
                aria-busy={isPending || undefined}
                className={PRIMARY_BUTTON}
              >
                {isPending && busyId === null && (
                  <Loader2 className="size-3.5 animate-spin" strokeWidth={2.2} />
                )}
                Turn on
              </button>
            </div>
          )}

          <ObservedFieldPicker
            existingKeys={existingKeys}
            onResult={(result) => {
              report(result);
              if (result.ok) void refresh();
            }}
          />

          {/* The escape hatch for a field no catalogue entry names. Collapsed and
              labelled for developers: it needs the exact name a source's API uses,
              which an admin has no way to know. */}
          <details className="group mt-6 border-t border-rule-soft pt-4">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-dim hover:text-ink">
              <ChevronRight
                aria-hidden="true"
                className="size-3.5 transition-transform group-open:rotate-90"
              />
              For developers: add a custom protection
            </summary>
            <p className={`mt-2 ${FOOTNOTE}`}>
              Only needed for a personal detail not in the list above. You will need the exact
              field name the source uses — if you are not sure, ask a developer rather than guessing,
              because a wrong name silently protects nothing.
            </p>
            <form action={submitDeveloperRule} className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor={devSourceId} className={FIELD_LABEL}>
                    Source
                  </label>
                  <Select value={devSource} onValueChange={setDevSource}>
                    <SelectTrigger id={devSourceId} className={`mt-2 ${SELECT_TRIGGER}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" className={SELECT_CONTENT}>
                      <SelectItem value={GLOBAL_SOURCE} className={SELECT_ITEM}>
                        Every source
                      </SelectItem>
                      {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value} className={SELECT_ITEM}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label htmlFor={devActionId} className={FIELD_LABEL}>
                    What happens
                  </label>
                  <Select
                    value={devAction}
                    onValueChange={(value) => setDevAction(value as "deny" | "allow")}
                  >
                    <SelectTrigger id={devActionId} className={`mt-2 ${SELECT_TRIGGER}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" className={SELECT_CONTENT}>
                      <SelectItem value="deny" className={SELECT_ITEM}>
                        Remove this field
                      </SelectItem>
                      <SelectItem value="allow" className={SELECT_ITEM}>
                        Keep it from this source (exception to an every-source rule)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label htmlFor="dev-field-path" className={FIELD_LABEL}>
                  Field name in the source&rsquo;s data
                </label>
                <input
                  id="dev-field-path"
                  type="text"
                  name="field_path"
                  required
                  placeholder="e.g. officers[*].usual_residential_address"
                  className={`mt-2 ${INPUT} font-mono text-[13px]`}
                />
              </div>
              <div>
                <label htmlFor="dev-reason" className={FIELD_LABEL}>
                  Why
                </label>
                <textarea
                  id="dev-reason"
                  name="reason"
                  required
                  rows={2}
                  maxLength={500}
                  placeholder="What this is and why it must not be saved."
                  className={`mt-2 ${INPUT} h-auto py-2 leading-[1.55]`}
                />
              </div>
              <button type="submit" disabled={isPending} className={PRIMARY_BUTTON}>
                Add custom protection
              </button>
            </form>
          </details>

          <p className={`mt-6 border-t border-rule-soft pt-4 ${FOOTNOTE}`}>
            Every import records which set of rules it was checked against (currently set{" "}
            {version}), so we can always show what was in force at the time.
          </p>
        </section>
      </Rise>
        </>
      )}

      {/* Turning a protection off confirms here, at the bottom of the screen —
          the same position as the score settings save bar — so the toggle in the
          list never moves and the row stays where it is, on or off. */}
      {!readOnly && pendingRule && (
        <div className="sticky bottom-4 z-10 mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-3 gap-y-2 rounded-panel border border-rule bg-white px-4 py-3 sm:flex-nowrap">
          <p aria-live="polite" className="mr-auto min-w-0 flex-1 text-[13px] leading-[1.55] text-ink">
            Turn off {ruleName(pendingRule).label.toLowerCase()}? New imports will save
            it.
          </p>
          <span className="flex shrink-0 items-center gap-x-3">
            <button
              type="button"
              onClick={() => setPendingOffId(null)}
              disabled={isPending}
              className={QUIET_BUTTON}
            >
              Keep it on
            </button>
            <button
              type="button"
              onClick={() => toggle(pendingRule, false)}
              disabled={isPending}
              aria-busy={isPending || undefined}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-inset border border-stop bg-stop px-2.5 py-1 whitespace-nowrap text-[13px] font-medium text-white transition-colors hover:bg-stop/90 focus-visible:ring-2 focus-visible:ring-stop/30 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
            >
              {busyId === pendingRule.id && (
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              )}
              {busyId === pendingRule.id ? "Turning off…" : "Yes, turn it off"}
            </button>
          </span>
        </div>
      )}
    </>
  );
}
