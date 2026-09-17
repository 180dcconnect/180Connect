"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, X } from "lucide-react";
import { DateRangeCalendar } from "@/components/ui/date-range-calendar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { OriginButton } from "@/components/ui/origin-button";
import { VIEW_ONLY_CONTROL_NOTE } from "@/lib/auth/view-only";
import {
  assigneeOwnerNote,
  formatDueDate,
  formatDueDateWithRelative,
  formatTeamAssignedActions,
  type TeamActionRow,
} from "@/lib/actions";

type TeamMember = {
  id: string;
  full_name: string | null;
  role?: string | null;
  email?: string | null;
};
type ClientOption = {
  id: string;
  legal_name: string;
  /** Who owns the client, so the picker can say when the assignee isn't them. */
  owner_id: string | null;
  owner: { full_name: string | null } | null;
};

const STATUS_STYLE: Record<TeamActionRow["status"], string> = {
  open: "bg-amber-50 text-amber-800",
  completed: "bg-green-50 text-green-800",
  cancelled: "bg-black/5 text-foreground/55",
};

const STATUS_LABEL: Record<TeamActionRow["status"], string> = {
  open: "Outstanding",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** How many options the picker lists before asking for more typing. */
const PICKER_LIST_CAP = 30;

function memberLabel(member: TeamMember): string {
  return member.full_name ?? (member.role === "admin" ? "Unnamed Admin" : "Unnamed CAM");
}

const ROLE_LABEL: Record<string, string> = { cam: "CAM", admin: "Admin", viewer: "Viewer" };

/**
 * The label shape the rest of the app already uses: a rectangle with a V notch
 * cut into its right edge. Same 8px notch as the inbox's sector and tag chips
 * (gmail-sidebar.tsx SECTOR_TAG_CLIP) and the client record's tags
 * (lib/tags/tag-chips.tsx TAG_NOTCH_CLIP). A role on a person is a label, so it
 * wears the label's shape.
 */
const TAG_NOTCH_CLIP =
  "polygon(0 0, 100% 0, calc(100% - 8px) 50%, 100% 100%, 0 100%)";

/**
 * Tints for the role tags, taken from the app's own token set rather than
 * Tailwind's ramp: hold (amber) for admins, go (green) for CAMs, lead (blue)
 * for leadership, and grey for a test login. The clip carves the notch, so a
 * tag carries no border — a border would simply be sliced off at the notch,
 * which is why these are a tint with a darker text colour of the same hue,
 * exactly like the chips they take their shape from.
 */
const ROLE_BADGE_STYLE: Record<string, string> = {
  admin: "bg-hold-wash text-hold",
  cam: "bg-go-wash text-go",
  viewer: "bg-lead-wash text-lead",
};
const ROLE_BADGE_FALLBACK = "bg-paper-sunk text-dim";
const TEST_BADGE_STYLE = "bg-paper-sunk text-dim";

/**
 * Test logins (test-cam@180dc.org and siblings, see
 * scripts/create-test-accounts.mts) are real user rows with no distinguishing
 * column — the `test-` email prefix is the whole convention. Tagging them
 * beats hiding them: admins need to hand test actions to test accounts, and
 * a visible tag stops test work being mistaken for real work.
 */
function isTestAccount(email: string | null | undefined): boolean {
  return (email ?? "").toLowerCase().startsWith("test-");
}

type OptionBadge = { text: string; className: string };

function memberBadges(member: TeamMember): OptionBadge[] {
  const badges: OptionBadge[] = [];
  if (isTestAccount(member.email)) badges.push({ text: "Test", className: TEST_BADGE_STYLE });
  const role = member.role ?? "cam";
  badges.push({
    text: ROLE_LABEL[role] ?? role,
    className: ROLE_BADGE_STYLE[role] ?? ROLE_BADGE_FALLBACK,
  });
  return badges;
}

function Badges({ badges }: { badges: OptionBadge[] }) {
  return (
    <>
      {badges.map((badge) => (
        <span
          key={badge.text}
          style={{ clipPath: TAG_NOTCH_CLIP }}
          className={`inline-flex shrink-0 items-center py-0.5 pr-3 pl-2 text-[10px] font-semibold whitespace-nowrap ${badge.className}`}
        >
          {badge.text}
        </span>
      ))}
    </>
  );
}

/**
 * A searchable dropdown: trigger button, panel with a search field, capped
 * scroll list. The owner picker's pattern, reused rather than reinvented —
 * Radix Select cannot hold a search field, and its item-aligned positioning
 * is what resized the content on scroll. The list region carries a fixed
 * max-height instead (`max-h-64`), so the panel keeps its size however far
 * the list scrolls — the same bounded-height cure as the popper-positioned
 * selects elsewhere.
 */
function SearchablePicker({
  value,
  options,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyText,
  disabled = false,
}: {
  value: string;
  options: { id: string; label: string; hint?: string; badges?: OptionBadge[] }[];
  onChange: (id: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open ]);

  const selected = options.find((option) => option.id === value) ?? null;
  const needle = search.trim().toLowerCase();
  const matching = needle
    ? options.filter((option) =>
        `${option.label} ${option.hint ?? ""}`.toLowerCase().includes(needle),
      )
    : options;
  const visible = matching.slice(0, PICKER_LIST_CAP);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => setOpen((isOpen) => !isOpen)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm shadow-xs transition-colors hover:border-black/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={`truncate ${selected ? "" : "text-foreground/40"}`}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {selected?.badges && <Badges badges={selected.badges} />}
          <ChevronDown
            className={`size-4 shrink-0 opacity-50 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 rounded-xl border border-black/[0.08] bg-white p-2 shadow-md">
          <input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="mb-2 w-full rounded-lg border border-black/[0.08] bg-white px-3 py-1.5 text-sm outline-none focus:border-black/25"
          />
          <div className="max-h-64 overflow-y-auto">
            {visible.length === 0 ? (
              <p className="px-2 py-2 text-sm text-foreground/55">{emptyText}</p>
            ) : (
              <ul role="listbox" className="space-y-0.5">
                {visible.map((option) => (
                  <li key={option.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={option.id === value}
                      onClick={() => {
                        onChange(option.id);
                        setOpen(false);
                        setSearch("");
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-black/[0.04] ${option.id === value ? "font-bold text-brand" : ""}`}
                    >
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {option.badges && <Badges badges={option.badges} />}
                        {option.id === value && <span aria-hidden="true">✓</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {matching.length > visible.length && (
            <p className="px-2 pb-1 pt-2 text-[11px] text-foreground/45">
              Showing the first {visible.length} of {matching.length.toLocaleString()} —
              keep typing to narrow it down.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * F169 — the whole feature on this side: the create-and-assign form (AC1)
 * and the team-wide outstanding/completed split (AC3). Same local-state +
 * fetch/POST/refresh shape as EditSuggestionsPanel: no server action here,
 * matching this branch's existing convention for /admin/* panels (as
 * opposed to the client-profile page's "use server" actions).
 */
export function AssignActionPanel({
  team,
  clients,
  initialActions,
  canAssign = true,
}: {
  team: TeamMember[];
  clients: ClientOption[];
  initialActions: TeamActionRow[];
  /**
   * Whether to offer the assign form at all. False for leadership (viewer),
   * who watch the team's work but hand none of it out — the POST behind this
   * form refuses them anyway, so showing it would only be a button that fails.
   * The outstanding and completed lists below are unaffected.
   */
  canAssign?: boolean;
}) {
  const [rows, setRows] = useState(initialActions);
  // The assign form starts closed: most visits to this page are to read the
  // outstanding list, not to hand out new work, and an always-open form pushes
  // that list a full screen down. One button opens it.
  const [formOpen, setFormOpen] = useState(false);
  const [organisationId, setOrganisationId] = useState("");
  const [assigneeUserId, setAssigneeUserId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function refresh() {
    const response = await fetch("/api/admin/actions");
    if (!response.ok) return;
    const body = await response.json();
    setRows(body.actions as TeamActionRow[]);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organisationId) {
      setError("Choose which client this action is about.");
      return;
    }
    if (!assigneeUserId) {
      setError("Choose which team member to assign this to.");
      return;
    }
    if (!title.trim()) {
      setError("Enter what needs to be done.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage("");
    try {
      const response = await fetch("/api/admin/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organisationId,
          assigneeUserId,
          title,
          description: description.trim() || undefined,
          dueDate: dueDate || undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "The action could not be saved.");
        return;
      }
      setTitle("");
      setDescription("");
      setDueDate("");
      setCalendarOpen(false);
      setAssigneeUserId("");
      setOrganisationId("");
      setMessage("Assigned. It's on their Actions tab now.");
      await refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const formatted = formatTeamAssignedActions(rows);
  const outstanding = formatted.filter((action) => action.status === "open");
  const decided = formatted.filter((action) => action.status !== "open");

  // Says when the assignee isn't the client's owner (see assigneeOwnerNote),
  // and only once both choices are made — there is nothing to compare before
  // that.
  const chosenClient = clients.find((client) => client.id === organisationId) ?? null;
  const chosenMember = team.find((member) => member.id === assigneeUserId) ?? null;
  const ownerNote =
    chosenClient && chosenMember
      ? assigneeOwnerNote({
          assigneeUserId: chosenMember.id,
          assigneeName: memberLabel(chosenMember),
          clientOwnerId: chosenClient.owner_id,
          clientOwnerName: chosenClient.owner?.full_name ?? null,
        })
      : "";

  return (
    <div className="space-y-8">
      {canAssign ? (
        <section
          aria-labelledby="assign-action-heading"
          className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm sm:p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2
              id="assign-action-heading"
              className="font-body text-[18px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink"
            >
              Assign a new action
            </h2>
            <OriginButton
              type="button"
              size="sm"
              variant={formOpen ? "ghost" : "outline"}
              aria-expanded={formOpen}
              aria-controls="assign-action-form"
              onClick={() => setFormOpen((open) => !open)}
            >
              {formOpen ? "Close" : "Assign a new action"}
            </OriginButton>
          </div>
          {formOpen && (
          <form id="assign-action-form" className="mt-4 space-y-4" onSubmit={submit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5 text-sm">
                <span className="text-xs font-bold uppercase tracking-wide text-foreground/50">
                  Client
                </span>
                <SearchablePicker
                  value={organisationId}
                  options={clients.map((client) => ({ id: client.id, label: client.legal_name }))}
                  onChange={setOrganisationId}
                  placeholder="Choose a client"
                  searchPlaceholder={`Search ${clients.length.toLocaleString()} clients…`}
                  emptyText="No matching clients."
                  disabled={busy}
                />
              </div>

              <div className="flex flex-col gap-1.5 text-sm">
                <span className="text-xs font-bold uppercase tracking-wide text-foreground/50">
                  Assign to
                </span>
                <SearchablePicker
                  value={assigneeUserId}
                  options={team.map((member) => {
                    const badges = memberBadges(member);
                    return {
                      id: member.id,
                      label: memberLabel(member),
                      hint: `${member.role ?? ""} ${isTestAccount(member.email) ? "test" : ""}`,
                      badges,
                    };
                  })}
                  onChange={setAssigneeUserId}
                  placeholder="Choose a team member"
                  searchPlaceholder="Search the team…"
                  emptyText="No matching team members."
                  disabled={busy}
                />
                {/* Always mounted, so the note is announced when it appears
                    rather than only when it changes (see ownerNote). */}
                <p aria-live="polite" className="text-[13px] leading-[1.55] text-dim">
                  {ownerNote}
                </p>
              </div>
            </div>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-xs font-bold uppercase tracking-wide text-foreground/50">
                What needs to be done
              </span>
              <Input
                type="text"
                value={title}
                disabled={busy}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Send the revised proposal"
                className="rounded-lg bg-white"
              />
            </label>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-xs font-bold uppercase tracking-wide text-foreground/50">
                Details (optional)
              </span>
              <Textarea
                value={description}
                disabled={busy}
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
                className="rounded-lg bg-white"
              />
            </label>

            <div className="flex max-w-md flex-col gap-1.5 text-sm">
              <span className="text-xs font-bold uppercase tracking-wide text-foreground/50">
                Due date (optional)
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-expanded={calendarOpen}
                  disabled={busy}
                  onClick={() => setCalendarOpen((isOpen) => !isOpen)}
                  className="rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm shadow-xs transition-colors hover:border-black/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {dueDate ? formatDueDateWithRelative(dueDate) : "Pick a date"}
                </button>
                {dueDate && (
                  <button
                    type="button"
                    onClick={() => setDueDate("")}
                    disabled={busy}
                    aria-label="Clear due date"
                    className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold text-foreground/55 transition-colors hover:text-foreground disabled:opacity-50"
                  >
                    <X className="size-3.5" />
                    Clear
                  </button>
                )}
              </div>
              {calendarOpen && (
                <DateRangeCalendar
                  mode="single"
                  value={{ from: dueDate || null, to: dueDate || null }}
                  onChange={(selection) => {
                    setDueDate(selection.from ?? "");
                    setCalendarOpen(false);
                  }}
                  showPresets={false}
                  className="max-w-[320px] rounded-xl border border-black/[0.08] bg-white p-3 shadow-md"
                />
              )}
            </div>

            <OriginButton type="submit" size="sm" loading={busy} disabled={busy}>
              {busy ? "Assigning…" : "Assign action"}
            </OriginButton>

            {message && (
              <p aria-live="polite" className="text-sm font-bold text-brand">
                {message}
              </p>
            )}
            {error && (
              <p aria-live="polite" role="alert" className="text-sm font-bold text-destructive">
                {error}
              </p>
            )}
          </form>
          )}
        </section>
      ) : (
        // Where the assign form would have been, the one voice the app uses for
        // a control withheld from a viewer — the header above already says the
        // page reads the same to them, but a silent gap here would read as a
        // broken form, not a permission.
        <section
          aria-labelledby="assign-action-heading"
          className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm sm:p-6"
        >
          <h2
            id="assign-action-heading"
            className="font-body text-[18px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink"
          >
            Assign a new action
          </h2>
          <p className="mt-2 text-sm text-foreground/55">{VIEW_ONLY_CONTROL_NOTE}</p>
        </section>
      )}

      <section>
        <h2 className="px-1 text-[11px] font-bold uppercase tracking-[0.1em] text-foreground/40">
          Outstanding ({outstanding.length})
        </h2>
        {outstanding.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-black/10 px-5 py-6 text-sm text-foreground/55">
            Nothing assigned is outstanding.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {outstanding.map((action) => (
              <li
                key={action.id}
                className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm"
              >
                <ActionRowContent action={action} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="px-1 text-[11px] font-bold uppercase tracking-[0.1em] text-foreground/40">
          Completed ({decided.length})
        </h2>
        {decided.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-black/10 px-5 py-6 text-sm text-foreground/55">
            Nothing completed yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {decided.map((action) => (
              <li
                key={action.id}
                className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm"
              >
                <ActionRowContent action={action} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ActionRowContent({ action }: { action: ReturnType<typeof formatTeamAssignedActions>[number] }) {
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <Link
          href={`/clients/${action.organisationId}`}
          className="font-bold hover:text-brand hover:underline"
        >
          {action.organisationName}
        </Link>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_STYLE[action.status]}`}>
          {STATUS_LABEL[action.status]}
        </span>
      </div>
      <p className="mt-1 text-sm font-bold text-foreground/85">{action.title}</p>
      {action.description && (
        <p className="mt-1 text-sm text-foreground/65">{action.description}</p>
      )}
      <p className="mt-1 text-xs text-foreground/50">
        Assigned to {action.assigneeName} by {action.assignedByName}
        {action.dueDate && (
          <>
            {" · "}
            <span className={action.isOverdue ? "font-bold text-destructive" : ""}>
              {action.isOverdue ? "Overdue " : "Due "}
              {formatDueDate(action.dueDate)}
            </span>
          </>
        )}
      </p>
    </>
  );
}
