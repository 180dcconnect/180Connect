"use client";

import { useState } from "react";
import { OriginButton } from "@/components/ui/origin-button";
import { Input } from "@/components/ui/input";
import { restrictedFieldLabel, type RestrictedFieldRow } from "@/lib/edit-suggestions";

/**
 * #23 (F020) — manage which client fields CAMs cannot save directly. Same shape as
 * the suppressions panel: local state over the initial rows, POST/DELETE to the admin
 * route, refresh from its GET. Adding requires a reason because the panel shows why
 * a field is locked, not just that it is.
 */
export function RestrictedFieldsPanel({
  initialFields,
}: {
  initialFields: RestrictedFieldRow[];
}) {
  const [rows, setRows] = useState(initialFields);
  const [fieldName, setFieldName] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"info" | "error">("info");
  const [busy, setBusy] = useState(false);
  const [retiring, setRetiring] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch("/api/admin/restricted-fields");
    if (!response.ok) return;
    const body = await response.json();
    setRows(body.fields as RestrictedFieldRow[]);
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/restricted-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldName, reason }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessageTone("error");
        setMessage(body.error ?? "The change could not be saved.");
        return;
      }
      setFieldName("");
      setReason("");
      setMessageTone("info");
      setMessage(`"${restrictedFieldLabel(fieldName)}" is now restricted. It took effect immediately.`);
      await refresh();
    } catch {
      setMessageTone("error");
      setMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function retire(fieldNameToRetire: string) {
    setRetiring(fieldNameToRetire);
    setMessage("");
    try {
      const response = await fetch("/api/admin/restricted-fields", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldName: fieldNameToRetire }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessageTone("error");
        setMessage(body.error ?? "The change could not be saved.");
        return;
      }
      setMessageTone("info");
      setMessage(
        `"${restrictedFieldLabel(fieldNameToRetire)}" is no longer restricted — CAMs can edit it directly again.`,
      );
      await refresh();
    } catch {
      setMessageTone("error");
      setMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setRetiring(null);
    }
  }

  async function reRestrict(row: RestrictedFieldRow) {
    setRetiring(row.field_name);
    setMessage("");
    try {
      const response = await fetch("/api/admin/restricted-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldName: row.field_name, reason: row.reason }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessageTone("error");
        setMessage(body.error ?? "The change could not be saved.");
        return;
      }
      setMessageTone("info");
      setMessage(
        `"${restrictedFieldLabel(row.field_name)}" is restricted again. It took effect immediately.`,
      );
      await refresh();
    } catch {
      setMessageTone("error");
      setMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setRetiring(null);
    }
  }

  const active = rows.filter((row) => row.active);
  const retired = rows.filter((row) => !row.active);

  return (
    <div className="mt-6">
      <form onSubmit={add} className="rounded-xl border border-black/10 bg-black/[0.015] p-4">
        <p className="text-[13px] font-bold text-foreground/75">Restrict a client field</p>
        <p className="mt-1 text-[13px] leading-[1.6] text-foreground/50">
          Use the column name of the client record, e.g. trading_name. Only existing
          text columns can be restricted; system columns are refused.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
              Field (column name)
            </span>
            <Input
              type="text"
              value={fieldName}
              onChange={(event) => setFieldName(event.target.value)}
              required
              placeholder="trading_name"
              className="rounded-xl bg-white"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
              Why (shown in this list)
            </span>
            <Input
              type="text"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
              maxLength={500}
              placeholder="Feeds dedup — wrong values corrupt matching."
              className="rounded-xl bg-white"
            />
          </label>
        </div>
        <OriginButton className="mt-3" type="submit" size="sm" loading={busy} disabled={busy}>
          Restrict field
        </OriginButton>
      </form>

      {(message || messageTone === "error") && message && (
        <p
          aria-live="polite"
          role={messageTone === "error" ? "alert" : undefined}
          className={`mt-3 text-[13px] font-bold ${messageTone === "error" ? "text-destructive" : "text-emerald-700"}`}
        >
          {message}
        </p>
      )}

      <h2 className="mt-6 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
        Active restrictions
      </h2>
      <ul className="mt-2 divide-y divide-black/[0.06] rounded-xl border border-black/10">
        {active.map((row) => (
          <li key={row.field_name} className="flex items-start justify-between gap-4 p-4">
            <div>
              <p className="text-sm font-bold text-foreground/85">{restrictedFieldLabel(row.field_name)}</p>
              <p className="mt-0.5 text-[13px] leading-[1.6] text-foreground/50">
                <code className="rounded bg-black/[0.04] px-1 py-0.5 text-xs">{row.field_name}</code>{" "}
                — {row.reason}
              </p>
            </div>
            <OriginButton
              size="sm"
              type="button"
              variant="outline"
              disabled={retiring === row.field_name}
              loading={retiring === row.field_name}
              onClick={() => retire(row.field_name)}
            >
              Retire
            </OriginButton>
          </li>
        ))}
        {active.length === 0 && (
          <li className="p-4 text-[13px] text-foreground/45">No fields are currently restricted.</li>
        )}
      </ul>

      {retired.length > 0 && (
        <>
          <h2 className="mt-6 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
            Retired (history only)
          </h2>
          <ul className="mt-2 divide-y divide-black/[0.06] rounded-xl border border-black/10">
            {retired.map((row) => (
              <li key={row.field_name} className="flex items-start justify-between gap-4 p-4 opacity-60">
                <div>
                  <p className="text-sm font-bold text-foreground/70">{restrictedFieldLabel(row.field_name)}</p>
                  <p className="mt-0.5 text-[13px] leading-[1.6] text-foreground/45">{row.reason}</p>
                </div>
                <OriginButton
                  size="sm"
                  type="button"
                  disabled={retiring === row.field_name}
                  loading={retiring === row.field_name}
                  onClick={() => reRestrict(row)}
                >
                  Re-restrict
                </OriginButton>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
