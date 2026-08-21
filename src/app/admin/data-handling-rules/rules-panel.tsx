"use client";

import { useState, useTransition } from "react";
import { createRule, toggleRuleActive, loadRules, type RuleRow } from "./actions";

const SOURCE_OPTIONS = [
  { value: "", label: "All sources (global)" },
  { value: "companies_house", label: "Companies House" },
  { value: "charitybase", label: "CharityBase" },
  { value: "charity_commission", label: "Charity Commission" },
  { value: "360giving", label: "360Giving" },
  { value: "find_that_charity", label: "Find That Charity" },
  { value: "globalgiving", label: "GlobalGiving" },
  { value: "candid", label: "Candid" },
] as const;

function sourceLabel(source: string | null): string {
  if (!source) return "All sources";
  return SOURCE_OPTIONS.find((o) => o.value === source)?.label ?? source;
}

function personLabel(
  person: { full_name: string | null; email: string } | null,
): string {
  // Null means the rule was seeded by a migration rather than written by an
  // admin — worth naming, because "—" reads as missing data rather than a fact.
  if (!person) return "System";
  return person.full_name ?? person.email;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function RulesPanel({
  initialRules,
  initialVersion,
}: {
  initialRules: RuleRow[];
  initialVersion: number;
}) {
  const [rules, setRules] = useState(initialRules);
  const [version, setVersion] = useState(initialVersion);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">(
    "success",
  );
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);

  async function refresh() {
    const result = await loadRules();
    if (!result.error) {
      setRules(result.rules);
      setVersion(result.version);
    }
  }

  function flash(msg: string, type: "success" | "error" = "success") {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => setMessage(""), 5000);
  }

  async function handleCreate(formData: FormData) {
    startTransition(async () => {
      const result = await createRule(formData);
      if (result.ok) {
        flash(result.message);
        setShowForm(false);
        await refresh();
      } else {
        flash(result.error, "error");
      }
    });
  }

  async function handleToggle(ruleId: string, isActive: boolean) {
    startTransition(async () => {
      const result = await toggleRuleActive(ruleId, isActive);
      if (result.ok) {
        flash(result.message);
        await refresh();
      } else {
        flash(result.error, "error");
      }
    });
  }

  const activeRules = rules.filter((r) => r.is_active);
  const inactiveRules = rules.filter((r) => !r.is_active);

  return (
    <div className="mt-6 space-y-6">
      {/* Version badge */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-foreground/65">
          Rule version:{" "}
          <span className="font-mono font-bold text-foreground">
            v{version}
          </span>{" "}
          · {activeRules.length} active rule
          {activeRules.length !== 1 ? "s" : ""}
        </p>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
          disabled={isPending}
        >
          {showForm ? "Cancel" : "+ Add rule"}
        </button>
      </div>

      {/* Flash message */}
      {message && (
        <p
          className={`rounded-xl p-3 text-sm font-medium ${
            messageType === "error"
              ? "bg-red-50 text-red-800"
              : "bg-green-50 text-green-800"
          }`}
          role="alert"
        >
          {message}
        </p>
      )}

      {/* Create form */}
      {showForm && (
        <form
          action={handleCreate}
          className="space-y-4 rounded-xl border border-black/10 p-5"
        >
          <h3 className="font-bold">New data handling rule</h3>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-foreground/80">
                Source
              </span>
              <select
                name="source"
                className="mt-1 block w-full rounded-lg border border-black/15 px-3 py-2 text-sm"
              >
                {SOURCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-foreground/80">
                Action
              </span>
              <select
                name="action"
                className="mt-1 block w-full rounded-lg border border-black/15 px-3 py-2 text-sm"
                defaultValue="deny"
              >
                <option value="deny">Deny (strip this field)</option>
                <option value="allow">
                  Allow (override a global deny for this source)
                </option>
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-foreground/80">
              Field path
            </span>
            <input
              type="text"
              name="field_path"
              required
              placeholder='e.g. officers[*].usual_residential_address'
              className="mt-1 block w-full rounded-lg border border-black/15 px-3 py-2 font-mono text-sm"
            />
            <span className="mt-1 block text-xs text-foreground/50">
              Dot-separated path into the API response JSON. Use [*] for array
              elements.
            </span>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-foreground/80">
              Reason
            </span>
            <textarea
              name="reason"
              required
              rows={2}
              placeholder="Why this field should be excluded — reference the data handling policy section if applicable."
              className="mt-1 block w-full rounded-lg border border-black/15 px-3 py-2 text-sm"
            />
          </label>

          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
          >
            {isPending ? "Creating…" : "Create rule"}
          </button>
        </form>
      )}

      {/* Active rules table */}
      {activeRules.length > 0 && (
        <div>
          <h3 className="mb-3 font-bold">Active rules</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-foreground/65">
                  <th className="pb-2 pr-4 font-medium">Source</th>
                  <th className="pb-2 pr-4 font-medium">Field path</th>
                  <th className="pb-2 pr-4 font-medium">Action</th>
                  <th className="pb-2 pr-4 font-medium">Reason</th>
                  <th className="pb-2 pr-4 font-medium">Created by</th>
                  <th className="pb-2 pr-4 font-medium">Date</th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {activeRules.map((rule) => (
                  <tr
                    key={rule.id}
                    className="border-b border-black/5 last:border-0"
                  >
                    <td className="py-3 pr-4">{sourceLabel(rule.source)}</td>
                    <td className="py-3 pr-4">
                      <code className="rounded bg-black/5 px-1.5 py-0.5 text-xs">
                        {rule.field_path}
                      </code>
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          rule.action === "deny"
                            ? "bg-red-50 text-red-800"
                            : "bg-green-50 text-green-800"
                        }`}
                      >
                        {rule.action}
                      </span>
                    </td>
                    <td className="max-w-xs truncate py-3 pr-4 text-foreground/65">
                      {rule.reason}
                    </td>
                    <td className="py-3 pr-4 text-foreground/65">
                      {personLabel(rule.created_by_user)}
                    </td>
                    <td className="py-3 pr-4 text-foreground/65">
                      {formatDate(rule.created_at)}
                    </td>
                    <td className="py-3">
                      <button
                        type="button"
                        onClick={() => handleToggle(rule.id, false)}
                        disabled={isPending}
                        className="rounded-lg border border-black/10 px-3 py-1 text-xs font-medium text-foreground/65 hover:bg-black/5 disabled:opacity-50"
                      >
                        Deactivate
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeRules.length === 0 && !showForm && (
        <p className="rounded-xl border border-dashed border-black/15 py-8 text-center text-sm text-foreground/50">
          No active rules. Click &ldquo;+ Add rule&rdquo; to create one.
        </p>
      )}

      {/* Inactive rules */}
      {inactiveRules.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-foreground/65 hover:text-foreground">
            {inactiveRules.length} inactive rule
            {inactiveRules.length !== 1 ? "s" : ""} (history)
          </summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-foreground/65">
                  <th className="pb-2 pr-4 font-medium">Source</th>
                  <th className="pb-2 pr-4 font-medium">Field path</th>
                  <th className="pb-2 pr-4 font-medium">Action</th>
                  <th className="pb-2 pr-4 font-medium">Reason</th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {inactiveRules.map((rule) => (
                  <tr
                    key={rule.id}
                    className="border-b border-black/5 text-foreground/50 last:border-0"
                  >
                    <td className="py-3 pr-4">{sourceLabel(rule.source)}</td>
                    <td className="py-3 pr-4">
                      <code className="rounded bg-black/5 px-1.5 py-0.5 text-xs">
                        {rule.field_path}
                      </code>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="inline-block rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium">
                        {rule.action}
                      </span>
                    </td>
                    <td className="max-w-xs truncate py-3 pr-4">
                      {rule.reason}
                    </td>
                    <td className="py-3">
                      <button
                        type="button"
                        onClick={() => handleToggle(rule.id, true)}
                        disabled={isPending}
                        className="rounded-lg border border-black/10 px-3 py-1 text-xs font-medium text-foreground/65 hover:bg-black/5 disabled:opacity-50"
                      >
                        Reactivate
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
