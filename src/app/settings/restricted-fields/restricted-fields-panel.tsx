"use client";

import { useId, useState } from "react";
import { Check, Loader2, Lock } from "lucide-react";
import { Rise } from "@/components/dashboard-stage";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  restrictedFieldDescription,
  restrictedFieldLabel,
  type RestrictedFieldRow,
} from "@/lib/edit-suggestions";
import {
  CARD,
  CARD_HINT,
  CARD_TITLE,
  FIELD_LABEL,
  FOOTNOTE,
  INPUT,
  PRIMARY_BUTTON,
  ROW,
  ROW_ACTION,
  SELECT_CONTENT,
  SELECT_ITEM,
  SELECT_TRIGGER,
} from "../styles";

type Notice = { tone: "success" | "error"; text: string } | null;

const NETWORK_ERROR = "Could not reach the server. Check your connection and try again.";

/**
 * #23 (F020) — lock and unlock client fields.
 *
 * Written for an admin who does not know the database (AGENTS.md, "Who will
 * maintain this app"): fields are chosen from a list by their plain-English name,
 * each with a sentence on what it is used for; nothing on screen is a column name.
 * "Lock" / "Unlock" rather than restrict / retire, because that is what the admin
 * is doing from a CAM's point of view.
 *
 * Talks to `/api/admin/restricted-fields` (POST locks or re-locks, DELETE unlocks)
 * and refreshes from its GET, as before.
 */
export function RestrictedFieldsPanel({
  initialFields,
  lockableFields,
}: {
  initialFields: RestrictedFieldRow[];
  /** Every field the database will let an admin lock, locked or not. */
  lockableFields: string[];
}) {
  const [rows, setRows] = useState(initialFields);
  const [fieldName, setFieldName] = useState("");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [adding, setAdding] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const selectId = useId();
  const reasonId = useId();

  const active = rows.filter((row) => row.active);
  const unlocked = rows.filter((row) => !row.active);
  const lockedNames = new Set(active.map((row) => row.field_name));
  const available = lockableFields
    .filter((field) => !lockedNames.has(field))
    .sort((a, b) => restrictedFieldLabel(a).localeCompare(restrictedFieldLabel(b)));

  const selectedDescription = fieldName ? restrictedFieldDescription(fieldName) : null;

  async function refresh() {
    const response = await fetch("/api/admin/restricted-fields");
    if (!response.ok) return;
    const body = await response.json();
    setRows(body.fields as RestrictedFieldRow[]);
  }

  async function send(method: "POST" | "DELETE", payload: object): Promise<boolean> {
    const response = await fetch("/api/admin/restricted-fields", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setNotice({ tone: "error", text: body.error ?? "The change could not be saved. Try again." });
      return false;
    }
    return true;
  }

  async function lock(event: React.FormEvent) {
    event.preventDefault();
    setNotice(null);
    if (!fieldName) {
      setNotice({ tone: "error", text: "Choose a field to lock from the list." });
      return;
    }
    setAdding(true);
    try {
      if (await send("POST", { fieldName, reason })) {
        setNotice({
          tone: "success",
          text: `${restrictedFieldLabel(fieldName)} is now locked. CAMs will need to suggest changes to it from now on.`,
        });
        setFieldName("");
        setReason("");
        await refresh();
      }
    } catch {
      setNotice({ tone: "error", text: NETWORK_ERROR });
    } finally {
      setAdding(false);
    }
  }

  async function unlock(field: string) {
    setNotice(null);
    setWorking(field);
    try {
      if (await send("DELETE", { fieldName: field })) {
        setNotice({
          tone: "success",
          text: `${restrictedFieldLabel(field)} is unlocked. CAMs can change it directly again — you can lock it again below.`,
        });
        await refresh();
      }
    } catch {
      setNotice({ tone: "error", text: NETWORK_ERROR });
    } finally {
      setWorking(null);
    }
  }

  async function relock(row: RestrictedFieldRow) {
    setNotice(null);
    setWorking(row.field_name);
    try {
      if (await send("POST", { fieldName: row.field_name, reason: row.reason })) {
        setNotice({
          tone: "success",
          text: `${restrictedFieldLabel(row.field_name)} is locked again.`,
        });
        await refresh();
      }
    } catch {
      setNotice({ tone: "error", text: NETWORK_ERROR });
    } finally {
      setWorking(null);
    }
  }

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
        <section aria-labelledby="locked-heading" className={CARD}>
          <h2 id="locked-heading" className={CARD_TITLE}>
            Locked fields
          </h2>
          <p className={CARD_HINT}>
            A CAM cannot change these on a client record. Instead they suggest the
            change, and an admin approves or rejects it under Approvals. Lock the
            details that would cause real problems if someone got them wrong.
          </p>

          <ul className="mt-4">
            {active.map((row) => (
              <li key={row.field_name} className={`${ROW} items-start`}>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
                    <Lock aria-hidden="true" className="size-3.5 shrink-0 text-faint" strokeWidth={2} />
                    {restrictedFieldLabel(row.field_name)}
                  </p>
                  <p className="mt-1 text-[13px] leading-[1.55] text-dim">
                    <span className="text-faint">Why: </span>
                    {row.reason}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => unlock(row.field_name)}
                  disabled={working === row.field_name}
                  aria-busy={working === row.field_name || undefined}
                  className={`${ROW_ACTION} inline-flex items-center gap-1.5 disabled:pointer-events-none disabled:opacity-50`}
                >
                  {working === row.field_name && (
                    <Loader2 aria-hidden="true" className="size-3 animate-spin" strokeWidth={2.2} />
                  )}
                  Unlock<span className="sr-only"> {restrictedFieldLabel(row.field_name)}</span>
                </button>
              </li>
            ))}
            {active.length === 0 && (
              <li className={`${ROW} text-[13px] text-dim`}>
                No fields are locked. CAMs can change every detail on a client record directly.
              </li>
            )}
          </ul>
        </section>
      </Rise>

      <Rise>
        <section aria-labelledby="lock-heading" className={CARD}>
          <h2 id="lock-heading" className={CARD_TITLE}>
            Lock another field
          </h2>
          <p className={CARD_HINT}>
            Takes effect straight away for every CAM. You can unlock it again at any time.
          </p>

          {available.length === 0 ? (
            <p className={`mt-4 border-t border-rule-soft pt-4 ${FOOTNOTE}`}>
              Every field that can be locked already is.
            </p>
          ) : (
            <form onSubmit={lock} noValidate className="mt-4 space-y-4 border-t border-rule-soft pt-4">
              <div>
                <label htmlFor={selectId} className={FIELD_LABEL}>
                  Field
                </label>
                <Select value={fieldName} onValueChange={setFieldName}>
                  <SelectTrigger id={selectId} className={`mt-2 ${SELECT_TRIGGER}`}>
                    <SelectValue placeholder="Choose a field…" />
                  </SelectTrigger>
                  <SelectContent position="popper" className={SELECT_CONTENT}>
                    {available.map((field) => (
                      <SelectItem key={field} value={field} className={SELECT_ITEM}>
                        {restrictedFieldLabel(field)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedDescription && (
                  <p className="mt-2 rounded-inset bg-paper px-3 py-2 text-[13px] leading-[1.55] text-dim">
                    {selectedDescription}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor={reasonId} className={FIELD_LABEL}>
                  Why should changes be checked first?
                </label>
                <textarea
                  id={reasonId}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="For example: outreach emails are sent to this address, so a mistake means emails go to the wrong place."
                  className={`mt-2 ${INPUT} h-auto py-2 leading-[1.55]`}
                />
                <p className="mt-2 text-[13px] leading-[1.55] text-dim">
                  Shown next to the field in the list above, so the next admin knows why it is locked.
                </p>
              </div>

              <button
                type="submit"
                disabled={adding}
                aria-busy={adding || undefined}
                className={PRIMARY_BUTTON}
              >
                {adding && <Loader2 className="size-3.5 animate-spin" strokeWidth={2.2} />}
                {adding ? "Locking…" : "Lock field"}
              </button>
            </form>
          )}

          {unlocked.length > 0 && (
            <div className="mt-6">
              <h3 className="text-[13px] font-medium text-ink">Previously locked</h3>
              <ul className="mt-2">
                {unlocked.map((row) => (
                  <li key={row.field_name} className={`${ROW} items-start`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink">{restrictedFieldLabel(row.field_name)}</p>
                      <p className="mt-1 text-[13px] leading-[1.55] text-dim">
                        <span className="text-faint">Was locked because: </span>
                        {row.reason}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => relock(row)}
                      disabled={working === row.field_name}
                      aria-busy={working === row.field_name || undefined}
                      className={`${ROW_ACTION} inline-flex items-center gap-1.5 disabled:pointer-events-none disabled:opacity-50`}
                    >
                      {working === row.field_name && (
                        <Loader2 aria-hidden="true" className="size-3 animate-spin" strokeWidth={2.2} />
                      )}
                      Lock again<span className="sr-only"> {restrictedFieldLabel(row.field_name)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </Rise>
    </>
  );
}
