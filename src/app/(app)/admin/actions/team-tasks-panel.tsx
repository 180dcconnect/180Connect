"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { CalendarDays, ChevronRight, Flag, Plus } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/animate-ui/components/radix/sheet";
import { OriginButton } from "@/components/ui/origin-button";
import { InitialsAvatar } from "@/components/ui/initials-avatar";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Pill } from "@/app/(app)/clients/[id]/section-card";
import { VIEW_ONLY_CONTROL_NOTE } from "@/lib/auth/view-only";
import {
  assigneeOwnerNote,
  formatDueDate,
  type ActionStatus,
  type TaskPriority,
  type TeamTask,
} from "@/lib/actions";
import {
  OrganisationHoverCard,
  type OrganisationPreview,
} from "@/components/organisation-hover-card";
import {
  createTeamTaskAction,
  setTeamTaskStatusAction,
  updateTeamTaskAction,
} from "./actions";

export type TaskTeamMember = {
  id: string;
  full_name: string | null;
  role: string | null;
  email: string | null;
};

export type TaskClientOption = {
  id: string;
  legal_name: string;
  organisation_type?: string | null;
  sector?: string | null;
  city?: string | null;
  country_code?: string | null;
  outreach_status?: string | null;
  website?: string | null;
  owner_id: string | null;
  owner: { full_name: string | null; email?: string | null } | null;
};

function buildClientPreview(
  organisationId: string,
  organisationName: string,
  clientMap: Map<string, TaskClientOption>,
): OrganisationPreview {
  const client = clientMap.get(organisationId);
  return {
    id: organisationId,
    legalName: client?.legal_name || organisationName,
    organisationType: client?.organisation_type ?? null,
    sector: client?.sector ?? null,
    city: client?.city ?? null,
    countryCode: client?.country_code ?? null,
    outreachStatus: client?.outreach_status ?? "not_contacted",
    website: client?.website ?? null,
    ownerId: client?.owner_id ?? null,
    ownerName: client?.owner?.full_name ?? null,
    ownerEmail: client?.owner?.email ?? null,
  };
}

type Draft = {
  organisationId: string;
  assigneeUserId: string;
  title: string;
  description: string;
  dueDate: string;
  priority: TaskPriority;
};

const EMPTY_DRAFT: Draft = {
  organisationId: "",
  assigneeUserId: "",
  title: "",
  description: "",
  dueDate: "",
  priority: "normal",
};

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  high: "High",
  normal: "Normal",
  low: "Low",
};

const STATUS_LABEL: Record<ActionStatus, string> = {
  open: "Open",
  completed: "Completed",
  cancelled: "Cancelled",
};

const ORIGIN_LABEL = {
  self: "Created by the assignee",
  system: "Created by the system",
  assigned: "Assigned by an administrator",
} as const;

function priorityTone(priority: TaskPriority): "stop" | "hold" | "neutral" {
  if (priority === "high") return "stop";
  if (priority === "normal") return "hold";
  return "neutral";
}

function statusTone(status: ActionStatus): "lead" | "go" | "neutral" {
  if (status === "open") return "lead";
  if (status === "completed") return "go";
  return "neutral";
}

function memberName(member: TaskTeamMember): string {
  return member.full_name?.trim() || member.email?.trim() || "Unnamed team member";
}

function DueReading({ task }: { task: TeamTask }) {
  if (!task.dueDate) return <span className="text-dim">No date</span>;
  if (task.isOverdue) {
    return (
      <span className="font-semibold text-stop">
        {task.daysOverdue === 1 ? "1 day overdue" : `${task.daysOverdue} days overdue`}
      </span>
    );
  }
  return <span className="tabular-nums text-ink">{formatDueDate(task.dueDate)}</span>;
}

function TaskRows({
  tasks,
  clientMap,
  onOpen,
}: {
  tasks: readonly TeamTask[];
  clientMap: Map<string, TaskClientOption>;
  onOpen: (task: TeamTask) => void;
}) {
  return (
    <div className="overflow-hidden rounded-panel border border-rule bg-white">
      <div
        aria-hidden="true"
        className="hidden grid-cols-[minmax(15rem,2.2fr)_minmax(10rem,1.35fr)_minmax(9rem,1fr)_8rem_7rem_7.5rem_2rem] gap-4 border-b border-rule bg-paper px-5 py-2.5 font-body text-[12px] font-semibold text-dim md:grid"
      >
        <span>Task</span>
        <span>Client</span>
        <span>Assigned to</span>
        <span>Due</span>
        <span>Priority</span>
        <span>Status</span>
        <span />
      </div>

      <ul className="divide-y divide-rule-soft">
        {tasks.map((task) => (
          <li key={task.id}>
            <div className="grid gap-3 px-4 py-5 transition-colors hover:bg-paper/70 sm:px-5 md:grid-cols-[minmax(15rem,2.2fr)_minmax(10rem,1.35fr)_minmax(9rem,1fr)_8rem_7rem_7.5rem_2rem] md:items-center md:gap-4">
              <button
                type="button"
                onClick={() => onOpen(task)}
                className="min-w-0 text-left focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead"
              >
                <span className="block truncate font-body text-[14px] font-semibold text-ink">
                  {task.title}
                </span>
                <span className="mt-1 block line-clamp-2 font-body text-[12.5px] leading-[1.45] text-dim">
                  {task.description?.trim() || "No description"}
                </span>
              </button>

              <span className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-3 md:block">
                <span className="font-body text-[12px] text-dim md:hidden">Client</span>
                <OrganisationHoverCard
                  org={buildClientPreview(task.organisationId, task.organisationName, clientMap)}
                  href={`/clients/${task.organisationId}`}
                  className="block truncate font-body text-[13px] font-semibold text-lead hover:text-lead-mid hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead"
                >
                  {task.organisationName}
                </OrganisationHoverCard>
              </span>

              <span className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-3 md:block">
                <span className="font-body text-[12px] text-dim md:hidden">Assigned to</span>
                <span className="flex min-w-0 items-center gap-2 font-body text-[13px] text-ink">
                  <InitialsAvatar name={task.assigneeName} compact />
                  <span className="truncate">{task.assigneeName}</span>
                </span>
              </span>

              <span className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-3 font-body text-[12.5px] md:block">
                <span className="text-dim md:hidden">Due</span>
                <DueReading task={task} />
              </span>

              <span className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-3 md:block">
                <span className="font-body text-[12px] text-dim md:hidden">Priority</span>
                <span><Pill tone={priorityTone(task.priority)}>{PRIORITY_LABEL[task.priority]}</Pill></span>
              </span>
              <span className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-3 md:block">
                <span className="font-body text-[12px] text-dim md:hidden">Status</span>
                <span><Pill tone={statusTone(task.status)}>{STATUS_LABEL[task.status]}</Pill></span>
              </span>

              <button
                type="button"
                onClick={() => onOpen(task)}
                aria-label={`Open ${task.title}`}
                className="hidden size-8 items-center justify-center rounded-inset text-faint hover:bg-paper-sunk hover:text-ink focus-visible:outline-2 focus-visible:outline-lead md:inline-flex"
              >
                <ChevronRight className="size-4" />
              </button>

              <button
                type="button"
                onClick={() => onOpen(task)}
                className="mt-1 flex items-center justify-between border-t border-rule-soft pt-3 font-body text-[13px] font-semibold text-lead md:hidden"
              >
                View task
                <ChevronRight className="size-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReadOnlyTask({
  task,
  clientMap,
}: {
  task: TeamTask;
  clientMap: Map<string, TaskClientOption>;
}) {
  const facts = [
    ["Client", task.organisationName],
    ["Assigned to", task.assigneeName],
    ["Due", task.dueDate ? formatDueDate(task.dueDate) : "No due date"],
    ["Priority", PRIORITY_LABEL[task.priority]],
    ["Status", STATUS_LABEL[task.status]],
    ["Created by", task.assignedByName],
  ];
  return (
    <div className="space-y-6 px-5 pb-8 sm:px-6">
      {task.description && <p className="font-body text-sm leading-[1.7] text-dim">{task.description}</p>}
      <dl className="divide-y divide-rule-soft rounded-panel border border-rule bg-paper px-4">
        {facts.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[7rem_1fr] gap-4 py-3 font-body text-[13px]">
            <dt className="text-dim">{label}</dt>
            <dd className="font-semibold text-ink">
              {label === "Client" ? (
                <OrganisationHoverCard
                  org={buildClientPreview(task.organisationId, task.organisationName, clientMap)}
                  href={`/clients/${task.organisationId}`}
                  className="text-lead hover:underline"
                >
                  {value}
                </OrganisationHoverCard>
              ) : (
                value
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className="rounded-inset bg-lead-wash px-4 py-3 font-body text-[13px] leading-[1.55] text-lead">
        {VIEW_ONLY_CONTROL_NOTE}
      </p>
    </div>
  );
}

export function TeamTasksPanel({
  tasks,
  team,
  clients,
  canManage,
  total,
  previousHref,
  nextHref,
}: {
  tasks: readonly TeamTask[];
  team: readonly TaskTeamMember[];
  clients: readonly TaskClientOption[];
  canManage: boolean;
  total: number;
  previousHref: string | null;
  nextHref: string | null;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selected, setSelected] = useState<TeamTask | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const clientMap = useMemo(
    () => new Map(clients.map((client) => [client.id, client])),
    [clients],
  );

  const openNew = () => {
    setSelected(null);
    setDraft(EMPTY_DRAFT);
    setError("");
    setSheetOpen(true);
  };

  const openExisting = (task: TeamTask) => {
    const assigneeIsAvailable = team.some((member) => member.id === task.assigneeId);
    setSelected(task);
    setDraft({
      organisationId: task.organisationId,
      assigneeUserId: assigneeIsAvailable ? (task.assigneeId ?? "") : "",
      title: task.title,
      description: task.description ?? "",
      dueDate: task.dueDate ?? "",
      priority: task.priority,
    });
    setError("");
    setSheetOpen(true);
  };

  const finish = (message: string) => {
    setNotice(message);
    setSheetOpen(false);
  };

  const chosenClient = clients.find((client) => client.id === draft.organisationId) ?? null;
  const chosenMember = team.find((member) => member.id === draft.assigneeUserId) ?? null;
  const selectedAssigneeUnavailable = Boolean(
    selected &&
      (!selected.assigneeId || !team.some((member) => member.id === selected.assigneeId)),
  );
  const ownerNote =
    chosenClient && chosenMember
      ? assigneeOwnerNote({
          assigneeUserId: chosenMember.id,
          assigneeName: memberName(chosenMember),
          clientOwnerId: chosenClient.owner_id,
          clientOwnerName: chosenClient.owner?.full_name ?? null,
        })
      : "";
  const hasUnsavedChanges = Boolean(
    selected &&
      (draft.assigneeUserId !== (selected.assigneeId ?? "") ||
        draft.title !== selected.title ||
        draft.description !== (selected.description ?? "") ||
        draft.dueDate !== (selected.dueDate ?? "") ||
        draft.priority !== selected.priority),
  );

  const submit = () => {
    setError("");
    startTransition(async () => {
      const result = selected
        ? await updateTeamTaskAction({
            actionId: selected.id,
            expectedUpdatedAt: selected.updatedAt,
            assigneeUserId: draft.assigneeUserId,
            title: draft.title,
            description: draft.description,
            dueDate: draft.dueDate,
            priority: draft.priority,
          })
        : await createTeamTaskAction(draft);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      finish(result.message);
    });
  };

  const changeStatus = (status: ActionStatus) => {
    if (!selected) return;
    setError("");
    startTransition(async () => {
      const result = await setTeamTaskStatusAction({
        actionId: selected.id,
        status,
        expectedUpdatedAt: selected.updatedAt,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      finish(result.message);
    });
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-body text-[13px] text-dim">
          <span className="font-semibold tabular-nums text-ink">{total.toLocaleString()}</span>{" "}
          {total === 1 ? "task" : "tasks"} matching
        </p>
        {canManage ? (
          <OriginButton type="button" size="sm" variant="ink" onClick={openNew}>
            <Plus className="size-4" />
            New task
          </OriginButton>
        ) : (
          <p className="font-body text-[13px] text-dim">{VIEW_ONLY_CONTROL_NOTE}</p>
        )}
      </div>

      {notice && (
        <p aria-live="polite" className="rounded-inset bg-go-wash px-4 py-3 font-body text-[13px] font-semibold text-go">
          {notice}
        </p>
      )}

      {tasks.length > 0 ? (
        <TaskRows tasks={tasks} clientMap={clientMap} onOpen={openExisting} />
      ) : (
        <div className="rounded-panel border border-dashed border-rule bg-white px-6 py-12 text-center">
          <p className="font-body text-[15px] font-semibold text-ink">No tasks match these filters.</p>
          <p className="mt-1 font-body text-[13px] text-dim">
            {canManage ? "Clear a filter or create a new task." : "Clear a filter to see more tasks."}
          </p>
        </div>
      )}

      {(previousHref || nextHref) && (
        <nav aria-label="Task pages" className="flex items-center justify-between">
          {previousHref ? (
            <Link href={previousHref} className="font-body text-[13px] font-semibold text-lead hover:text-lead-mid">Previous</Link>
          ) : <span />}
          {nextHref && (
            <Link href={nextHref} className="font-body text-[13px] font-semibold text-lead hover:text-lead-mid">Next</Link>
          )}
        </nav>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="right"
          className="w-full max-w-full gap-0 overflow-y-auto border-l border-rule bg-white p-0 sm:w-[34rem]"
        >
          <SheetHeader className="border-b border-rule-soft px-5 py-5 pr-12 text-left sm:px-6">
            <SheetTitle className="font-body text-[22px] font-semibold tracking-[-0.02em] text-ink">
              {selected ? selected.title : "New task"}
            </SheetTitle>
            <SheetDescription className="font-body text-[13px] leading-[1.55] text-dim">
              {selected
                ? canManage
                  ? "Change the work, who owns it, or what happens next. The linked client stays fixed."
                  : "Task details for the team."
                : "Give a team member a clear piece of client work."}
            </SheetDescription>
          </SheetHeader>

          {selected && !canManage ? (
            <ReadOnlyTask task={selected} clientMap={clientMap} />
          ) : (
            <form
              className="flex flex-1 flex-col"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <div className="space-y-5 px-5 py-5 sm:px-6">
                {selected ? (
                  <div>
                    <p className="font-body text-[12px] font-semibold text-dim">Client</p>
                    <OrganisationHoverCard
                      org={buildClientPreview(selected.organisationId, selected.organisationName, clientMap)}
                      href={`/clients/${selected.organisationId}`}
                      className="mt-1 inline-block font-body text-sm font-semibold text-lead hover:underline"
                    >
                      {selected.organisationName}
                    </OrganisationHoverCard>
                    <p className="mt-1 font-body text-[12px] leading-[1.5] text-dim">
                      A task cannot be moved to another client. Create a new task if the client is wrong.
                    </p>
                  </div>
                ) : (
                  <label className="block">
                    <span className="font-body text-[12px] font-semibold text-dim">Client</span>
                    <SearchableSelect
                      id="new-task-client"
                      value={draft.organisationId}
                      onChange={(value) => setDraft((current) => ({ ...current, organisationId: value }))}
                      groups={[{ label: "Clients", options: clients.map((client) => ({ value: client.id, label: client.legal_name })) }]}
                      placeholder="Choose a client"
                      searchPlaceholder={`Search ${clients.length.toLocaleString()} clients…`}
                      emptyMessage="No matching clients."
                      ariaLabel="Client"
                      disabled={pending}
                      className="mt-1.5"
                    />
                  </label>
                )}

                <label className="block">
                  <span className="font-body text-[12px] font-semibold text-dim">Task name</span>
                  <Input
                    value={draft.title}
                    onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                    maxLength={200}
                    disabled={pending}
                    placeholder="Send the revised proposal"
                    className="mt-1.5 rounded-inset border-rule bg-white"
                  />
                </label>

                <label className="block">
                  <span className="font-body text-[12px] font-semibold text-dim">Description</span>
                  <Textarea
                    value={draft.description}
                    onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                    maxLength={2000}
                    rows={4}
                    disabled={pending}
                    placeholder="Add the context they need to finish it."
                    className="mt-1.5 rounded-inset border-rule bg-white"
                  />
                </label>

                <label className="block">
                  <span className="font-body text-[12px] font-semibold text-dim">Assigned to</span>
                  <SearchableSelect
                    id="task-assignee"
                    value={draft.assigneeUserId}
                    onChange={(value) => setDraft((current) => ({ ...current, assigneeUserId: value }))}
                    groups={[{ label: "Active team", options: team.map((member) => ({ value: member.id, label: memberName(member), keywords: [member.role ?? "", member.email ?? ""] })) }]}
                    placeholder="Choose a team member"
                    searchPlaceholder="Search the team…"
                    emptyMessage="No matching team members."
                    ariaLabel="Assigned to"
                    disabled={pending}
                    className="mt-1.5"
                  />
                  <span aria-live="polite" className="mt-1.5 block min-h-5 font-body text-[12px] leading-[1.5] text-dim">
                    {selectedAssigneeUnavailable
                      ? selected?.assigneeId
                        ? `${selected.assigneeName} is no longer active. Choose an active team member before saving.`
                        : "This task is unassigned. Choose an active team member before saving."
                      : ownerNote}
                  </span>
                </label>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="flex items-center gap-1.5 font-body text-[12px] font-semibold text-dim">
                      <CalendarDays className="size-3.5 text-faint" /> Due date
                    </span>
                    <Input
                      type="date"
                      value={draft.dueDate}
                      onChange={(event) => setDraft((current) => ({ ...current, dueDate: event.target.value }))}
                      disabled={pending}
                      className="mt-1.5 rounded-inset border-rule bg-white"
                    />
                  </label>
                  <label className="block">
                    <span className="flex items-center gap-1.5 font-body text-[12px] font-semibold text-dim">
                      <Flag className="size-3.5 text-faint" /> Priority
                    </span>
                    <Select
                      value={draft.priority}
                      onValueChange={(priority) => setDraft((current) => ({ ...current, priority: priority as TaskPriority }))}
                      disabled={pending}
                    >
                      <SelectTrigger
                        aria-label="Priority"
                        className="mt-1.5 h-10 w-full rounded-inset border-rule bg-white font-body text-sm text-ink shadow-none focus-visible:border-lead focus-visible:ring-2 focus-visible:ring-lead/20"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-inset border-rule bg-white font-body text-sm text-ink shadow-lg">
                        <SelectItem value="high" className="rounded-inset focus:bg-paper focus:text-ink">High</SelectItem>
                        <SelectItem value="normal" className="rounded-inset focus:bg-paper focus:text-ink">Normal</SelectItem>
                        <SelectItem value="low" className="rounded-inset focus:bg-paper focus:text-ink">Low</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                </div>

                {selected && (
                  <div className="space-y-1.5">
                    <p className="font-body text-[12px] leading-[1.55] text-dim">
                      {ORIGIN_LABEL[selected.origin]}{selected.origin === "assigned" ? ` by ${selected.assignedByName}` : ""}.
                    </p>
                    {hasUnsavedChanges && (
                      <p className="font-body text-[12px] font-semibold leading-[1.55] text-hold">
                        Save your changes before changing this task&apos;s status.
                      </p>
                    )}
                  </div>
                )}

                {error && <p role="alert" className="rounded-inset bg-stop-wash px-3 py-2.5 font-body text-[13px] font-semibold text-stop">{error}</p>}
              </div>

              <div className="mt-auto border-t border-rule bg-paper px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    {selected?.status === "open" && (
                      <OriginButton type="button" size="sm" variant="outline" disabled={pending || hasUnsavedChanges} onClick={() => changeStatus("cancelled")}>
                        Cancel task
                      </OriginButton>
                    )}
                    {selected && selected.status !== "open" && (
                      <OriginButton type="button" size="sm" variant="outline" disabled={pending || hasUnsavedChanges} onClick={() => changeStatus("open")}>
                        Restore to Open
                      </OriginButton>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <OriginButton type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setSheetOpen(false)}>
                      Close
                    </OriginButton>
                    <OriginButton type="submit" size="sm" variant="ink" loading={pending} disabled={pending}>
                      {selected ? "Save changes" : "Create task"}
                    </OriginButton>
                    {selected?.status === "open" && (
                      <OriginButton type="button" size="sm" variant="ink" disabled={pending || hasUnsavedChanges} onClick={() => changeStatus("completed")}>
                        Mark complete
                      </OriginButton>
                    )}
                  </div>
                </div>
              </div>
            </form>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
