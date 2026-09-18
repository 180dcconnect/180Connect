"use client";

import { useState } from "react";
import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type FilterOption = { value: string; label: string };

export type TeamTaskFilterValues = {
  query: string;
  status: "open" | "completed" | "cancelled" | "all";
  assignee: string;
  client: string;
  priority: "high" | "normal" | "low" | "all";
  due: "all" | "overdue" | "today" | "week" | "undated";
  sort: "due" | "priority" | "updated";
};

const selectTriggerClass =
  "h-10 rounded-inset border-rule bg-white font-body text-[13px] font-semibold text-ink shadow-none focus-visible:border-lead focus-visible:ring-2 focus-visible:ring-lead/20";

const selectContentClass =
  "rounded-inset border-rule bg-white font-body text-[13px] text-ink shadow-lg";

function FilterSelect({
  value,
  onValueChange,
  ariaLabel,
  className,
  options,
}: {
  value: string;
  onValueChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger aria-label={ariaLabel} className={`${selectTriggerClass} ${className ?? ""}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className={selectContentClass}>
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="rounded-inset focus:bg-paper focus:text-ink"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function TaskFilters({
  values,
  team,
  clients,
}: {
  values: TeamTaskFilterValues;
  team: FilterOption[];
  clients: FilterOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(values.query);

  const navigate = (patch: Partial<Record<keyof TeamTaskFilterValues, string>>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      const isDefault =
        !value ||
        (key === "status" && value === "open") ||
        (key === "priority" && value === "all") ||
        (key === "due" && value === "all") ||
        (key === "sort" && value === "due");
      if (isDefault) params.delete(key === "query" ? "q" : key);
      else params.set(key === "query" ? "q" : key, value);
    }
    params.delete("page");
    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  };

  const filtersActive = Boolean(
    values.query ||
      values.status !== "open" ||
      values.assignee ||
      values.client ||
      values.priority !== "all" ||
      values.due !== "all" ||
      values.sort !== "due",
  );

  return (
    <div className="rounded-panel border border-rule bg-white px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative min-w-[15rem] flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            navigate({ query: query.trim() });
          }}
        >
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search task names"
            aria-label="Search task names"
            className="h-10 w-full rounded-inset border border-rule bg-paper pr-3 pl-9 font-body text-sm text-ink outline-none placeholder:text-faint focus:border-lead focus:ring-1 focus:ring-lead"
          />
        </form>

        <FilterSelect
          ariaLabel="Filter by status"
          value={values.status}
          onValueChange={(status) => {
            navigate(
              status !== "open" && values.due === "overdue"
                ? { status, due: "all" }
                : { status },
            );
          }}
          options={[
            { value: "open", label: "Open" },
            { value: "completed", label: "Completed" },
            { value: "cancelled", label: "Cancelled" },
            { value: "all", label: "All statuses" },
          ]}
        />

        <div className="w-[11rem]">
          <SearchableSelect
            id="task-assignee-filter"
            value={values.assignee}
            onChange={(value) => navigate({ assignee: value })}
            groups={[{ label: "People", options: [{ value: "", label: "All assignees" }, ...team] }]}
            placeholder="All assignees"
            searchPlaceholder="Search people…"
            ariaLabel="Filter by assignee"
            className="[&_button]:h-10 [&_button]:rounded-inset [&_button]:border-rule"
          />
        </div>

        <div className="w-[16rem] sm:w-[20rem] lg:w-[22rem]">
          <SearchableSelect
            id="task-client-filter"
            value={values.client}
            onChange={(value) => navigate({ client: value })}
            groups={[{ label: "Clients", options: [{ value: "", label: "All clients" }, ...clients] }]}
            placeholder="All clients"
            searchPlaceholder="Search clients…"
            ariaLabel="Filter by client"
            className="[&_button]:h-10 [&_button]:rounded-inset [&_button]:border-rule"
            popoverClassName="w-full min-w-[20rem] sm:min-w-[24rem]"
          />
        </div>

        <FilterSelect
          ariaLabel="Filter by priority"
          value={values.priority}
          onValueChange={(priority) => navigate({ priority })}
          options={[
            { value: "all", label: "All priorities" },
            { value: "high", label: "High" },
            { value: "normal", label: "Normal" },
            { value: "low", label: "Low" },
          ]}
        />

        <FilterSelect
          ariaLabel="Filter by due date"
          value={values.due}
          onValueChange={(due) => {
            navigate(due === "overdue" ? { due, status: "open" } : { due });
          }}
          options={[
            { value: "all", label: "Any due date" },
            { value: "overdue", label: "Overdue" },
            { value: "today", label: "Due today" },
            { value: "week", label: "Next 7 days" },
            { value: "undated", label: "No due date" },
          ]}
        />

        <FilterSelect
          ariaLabel="Sort tasks"
          value={values.sort}
          onValueChange={(sort) => navigate({ sort })}
          options={[
            { value: "due", label: "Sort: due date" },
            { value: "priority", label: "Sort: priority" },
            { value: "updated", label: "Sort: recently updated" },
          ]}
        />

        {filtersActive && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              router.replace(pathname, { scroll: false });
            }}
            className="inline-flex h-10 items-center gap-1.5 rounded-inset px-3 font-body text-[13px] font-semibold text-dim hover:bg-paper hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead"
          >
            <X className="size-3.5" />
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
