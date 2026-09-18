import { redirect } from "next/navigation";

import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { InlineAlert } from "@/components/ui/inline-alert";
import { formatTeamTasks, taskPriorityToDb, type TeamActionRow } from "@/lib/actions";
import { getViewingActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { hasPermission } from "@/lib/auth/permissions";
import { dayKeyOf } from "@/lib/display-format";
import { reportError } from "@/lib/error-logging";
import { fetchPaged } from "@/lib/supabase/fetch-paged";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";
import { ActionsHeader } from "../../actions/actions-header";
import { TaskFilters, type TeamTaskFilterValues } from "./task-filters";
import {
  TeamTasksPanel,
  type TaskClientOption,
  type TaskTeamMember,
} from "./team-tasks-panel";

const PAGE_SIZE = 50;

const ACTION_SELECT =
  "id, title, description, due_date, status, priority, organisation_id, created_by_user_id, assignee_user_id, created_at, updated_at, " +
  "organisation:organisations!actions_organisation_id_fkey(legal_name), " +
  "created_by_user:users!actions_created_by_user_id_fkey(full_name), " +
  "assignee:users!actions_assignee_user_id_fkey(full_name)";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function scalar(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function oneOf<const T extends readonly string[]>(value: string, choices: T, fallback: T[number]): T[number] {
  return choices.includes(value) ? (value as T[number]) : fallback;
}

function hrefForPage(params: URLSearchParams, page: number): string {
  const next = new URLSearchParams(params);
  if (page <= 1) next.delete("page");
  else next.set("page", String(page));
  const query = next.toString();
  return query ? `/admin/actions?${query}` : "/admin/actions";
}

export default async function AdminActionsPage({ searchParams }: { searchParams?: SearchParams }) {
  const authorization = await getViewingActor("user:manage", { route: "/admin/actions" });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const raw = searchParams ? await searchParams : {};
  const query = scalar(raw.q).trim().slice(0, 120);
  const status = oneOf(scalar(raw.status), ["open", "completed", "cancelled", "all"] as const, "open");
  const priority = oneOf(scalar(raw.priority), ["high", "normal", "low", "all"] as const, "all");
  const due = oneOf(scalar(raw.due), ["all", "overdue", "today", "week", "undated"] as const, "all");
  const sort = oneOf(scalar(raw.sort), ["due", "priority", "updated"] as const, "due");
  const assigneeParam = scalar(raw.assignee);
  const clientParam = scalar(raw.client);
  const assignee = assigneeParam === "unassigned" || isUuid(assigneeParam) ? assigneeParam : "";
  const client = isUuid(clientParam) ? clientParam : "";
  const page = Math.max(1, Number.parseInt(scalar(raw.page), 10) || 1);

  const filters: TeamTaskFilterValues = { query, status, assignee, client, priority, due, sort };
  const supabase = await createClient();
  const canManage = hasPermission(authorization.actor.role, "user:manage");

  let tasksQuery = supabase.from("actions").select(ACTION_SELECT, { count: "exact" });
  if (status !== "all") tasksQuery = tasksQuery.eq("status", status);
  if (assignee === "unassigned") tasksQuery = tasksQuery.is("assignee_user_id", null);
  else if (assignee) tasksQuery = tasksQuery.eq("assignee_user_id", assignee);
  if (client) tasksQuery = tasksQuery.eq("organisation_id", client);
  if (priority !== "all") tasksQuery = tasksQuery.eq("priority", taskPriorityToDb(priority));
  if (query) tasksQuery = tasksQuery.ilike("title", `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);

  const today = new Date();
  const todayKey = dayKeyOf(today);
  if (due === "overdue") tasksQuery = tasksQuery.lt("due_date", todayKey).eq("status", "open");
  if (due === "today") tasksQuery = tasksQuery.eq("due_date", todayKey);
  if (due === "week") {
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);
    tasksQuery = tasksQuery.gte("due_date", todayKey).lte("due_date", dayKeyOf(weekEnd));
  }
  if (due === "undated") tasksQuery = tasksQuery.is("due_date", null);

  if (sort === "priority") {
    tasksQuery = tasksQuery.order("priority").order("due_date", { nullsFirst: false }).order("created_at");
  } else if (sort === "updated") {
    tasksQuery = tasksQuery.order("updated_at", { ascending: false });
  } else {
    tasksQuery = tasksQuery.order("due_date", { nullsFirst: false }).order("priority").order("created_at");
  }
  tasksQuery = tasksQuery.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const [tasksResult, teamResult, clientsResult] = await Promise.all([
    tasksQuery.overrideTypes<TeamActionRow[], { merge: false }>(),
    supabase
      .from("users")
      .select("id, full_name, role, email")
      .in("role", ["cam", "admin"])
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("full_name")
      .overrideTypes<TaskTeamMember[], { merge: false }>(),
    fetchPaged<TaskClientOption>(
      (from, to) =>
        supabase
          .from("organisations")
          .select(
            "id, legal_name, organisation_type, sector, city, country_code, outreach_status, website, owner_id, owner:users!organisations_owner_id_fkey(full_name, email)",
          )
          .order("legal_name")
          .order("id")
          .range(from, to)
          .overrideTypes<TaskClientOption[], { merge: false }>(),
      { pagesPerRound: 4 },
    ),
  ]);

  if (tasksResult.error) await reportError(tasksResult.error, { operation: "admin.tasks.page_list" });
  if (teamResult.error) await reportError(teamResult.error, { operation: "admin.tasks.page_team" });
  if (clientsResult.error) await reportError(clientsResult.error, { operation: "admin.tasks.page_clients" });

  const tasks = formatTeamTasks(tasksResult.data ?? []);
  const team = teamResult.data ?? [];
  const clients = clientsResult.data ?? clientsResult.partial;
  const total = tasksResult.count ?? tasks.length;
  const currentParams = new URLSearchParams();
  if (query) currentParams.set("q", query);
  if (status !== "open") currentParams.set("status", status);
  if (assignee) currentParams.set("assignee", assignee);
  if (client) currentParams.set("client", client);
  if (priority !== "all") currentParams.set("priority", priority);
  if (due !== "all") currentParams.set("due", due);
  if (sort !== "due") currentParams.set("sort", sort);
  const previousHref = page > 1 ? hrefForPage(currentParams, page - 1) : null;
  const nextHref = page * PAGE_SIZE < total ? hrefForPage(currentParams, page + 1) : null;

  return (
    <div className="min-h-screen max-w-full overflow-x-hidden bg-[#f4f4ef] px-4 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12">
      <Stage className="mx-auto w-full max-w-[1400px] space-y-6">
        <Rise>
          <ActionsHeader current="/admin/actions">
            <p className="mt-3 font-body text-sm leading-[1.7] text-dim">
              Balance client work across the team, see what is becoming urgent, and keep completed or cancelled tasks on record.
            </p>
          </ActionsHeader>
        </Rise>

        <Group className="space-y-4">
          <Rise className="relative z-20">
            <TaskFilters
              key={query}
              values={filters}
              team={[
                { value: "unassigned", label: "Unassigned" },
                ...team.map((member) => ({ value: member.id, label: member.full_name?.trim() || member.email || "Unnamed team member" })),
              ]}
              clients={clients.map((option) => ({ value: option.id, label: option.legal_name }))}
            />
          </Rise>

          {(tasksResult.error || teamResult.error || clientsResult.error) && (
            <Rise>
              <InlineAlert
                variant="page"
                message="Some team tasks could not be loaded. This has been recorded — refresh and try again."
              />
            </Rise>
          )}

          <Rise className="relative z-0 space-y-4">
            <TeamTasksPanel
              tasks={tasks}
              team={team}
              clients={clients}
              canManage={canManage}
              total={total}
              previousHref={previousHref}
              nextHref={nextHref}
            />
          </Rise>
        </Group>
      </Stage>
    </div>
  );
}
