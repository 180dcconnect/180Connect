"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { OriginButton } from "@/components/ui/origin-button";
import {
  formatDueDate,
  formatTeamAssignedActions,
  type TeamActionRow,
} from "@/lib/actions";

type TeamMember = { id: string; full_name: string | null };
type ClientOption = { id: string; legal_name: string };

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
}: {
  team: TeamMember[];
  clients: ClientOption[];
  initialActions: TeamActionRow[];
}) {
  const [rows, setRows] = useState(initialActions);
  const [organisationId, setOrganisationId] = useState("");
  const [assigneeUserId, setAssigneeUserId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
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
      setError("Choose which CAM to assign this to.");
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

  return (
    <div className="mt-8 space-y-10">
      <form
        className="space-y-4 rounded-xl border border-black/10 p-5"
        onSubmit={submit}
      >
        <h2 className="text-sm font-bold">Assign a new action</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs font-bold uppercase tracking-wide text-foreground/50">
              Client
            </span>
            <Select value={organisationId} onValueChange={setOrganisationId} disabled={busy}>
              <SelectTrigger className="w-full rounded-lg bg-white text-sm">
                <SelectValue placeholder="Choose a client" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.legal_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs font-bold uppercase tracking-wide text-foreground/50">
              Assign to
            </span>
            <Select value={assigneeUserId} onValueChange={setAssigneeUserId} disabled={busy}>
              <SelectTrigger className="w-full rounded-lg bg-white text-sm">
                <SelectValue placeholder="Choose a CAM" />
              </SelectTrigger>
              <SelectContent>
                {team.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.full_name ?? "Unnamed CAM"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
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

        <label className="flex max-w-xs flex-col gap-1.5 text-sm">
          <span className="text-xs font-bold uppercase tracking-wide text-foreground/50">
            Due date (optional)
          </span>
          <Input
            type="date"
            value={dueDate}
            disabled={busy}
            onChange={(event) => setDueDate(event.target.value)}
            className="rounded-lg bg-white"
          />
        </label>

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

      <div>
        <h2 className="text-sm font-bold">Outstanding</h2>
        {outstanding.length === 0 ? (
          <p className="mt-2 text-sm text-foreground/55">
            Nothing admin-assigned is outstanding.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {outstanding.map((action) => (
              <li key={action.id} className="rounded-xl border border-black/10 p-4">
                <ActionRowContent action={action} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="text-sm font-bold">Completed</h2>
        {decided.length === 0 ? (
          <p className="mt-2 text-sm text-foreground/55">Nothing decided yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {decided.map((action) => (
              <li key={action.id} className="rounded-xl border border-black/10 p-4">
                <ActionRowContent action={action} />
              </li>
            ))}
          </ul>
        )}
      </div>
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
