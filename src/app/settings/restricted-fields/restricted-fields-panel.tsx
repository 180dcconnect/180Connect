"use client";

import { useId, useState } from "react";
import { Check, Loader2, Lock, Unlock } from "lucide-react";
import { Switch } from "@/components/ui/material-design-3-switch";
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
  QUIET_BUTTON,
  ROW,
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
  readOnly = false,
}: {
  initialFields: RestrictedFieldRow[];
  /** Every field the database will let an admin lock, locked or not. */
  lockableFields: string[];
  readOnly?: boolean;
}) {
  const [rows, setRows] = useState(initialFields);
  const [fieldName, setFieldName] = useState("");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [adding, setAdding] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  // Unlocking a field lets CAMs change it directly again, so it waits in this
  // pending slot until the admin confirms in the sticky bar at the bottom of
  // the screen (the same position as the score settings save bar). The switch
  // is controlled and stays visibly locked until then — the unlock animation
  // plays when the save lands and the row refreshes. The row never leaves the
  // list: unlocked fields stay where they are with their switch off, so locking
  // one again is the same toggle.
  const [pendingUnlock, setPendingUnlock] = useState<string | null>(null);
  const selectId = useId();
  const reasonId = useId();

  // Every field ever locked stays in the main list, locked or not — so the
  // "lock another field" dropdown only offers what is not already there.
  const existingNames = new Set(rows.map((row) => row.field_name));
  const available = lockableFields
    .filter((field) => !existingNames.has(field))
    .sort((a, b) => restrictedFieldLabel(a).localeCompare(restrictedFieldLabel(b)));
  const pendingRow = rows.find((row) => row.field_name === pendingUnlock) ?? null;

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
          text: `${restrictedFieldLabel(field)} is unlocked. CAMs can change it directly again — it stays in the list above, so you can lock it again with the same switch.`,
        });
        await refresh();
      }
    } catch {
      setNotice({ tone: "error", text: NETWORK_ERROR });
    } finally {
      setPendingUnlock(null);
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
            {rows.map((row) => (
              <li key={row.field_name} className={`${ROW} items-start`}>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-ink">
                    {row.active ? (
                      <Lock aria-hidden="true" className="size-3.5 shrink-0 text-faint" strokeWidth={2} />
                    ) : (
                      <Unlock aria-hidden="true" className="size-3.5 shrink-0 text-faint" strokeWidth={2} />
                    )}
                    {restrictedFieldLabel(row.field_name)}
                    {!row.active && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-paper px-2 py-0.5 text-[11px] font-medium text-dim">
                        Unlocked
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-[13px] leading-[1.55] text-dim">
                    <span className="text-faint">Why: </span>
                    {row.reason}
                  </p>
                </div>
                {!readOnly && (
                  <Switch
                    role="switch"
                    aria-label={`Lock on ${restrictedFieldLabel(row.field_name)}`}
                    checked={row.active}
                    aria-busy={working === row.field_name || undefined}
                    onCheckedChange={(checked) => {
                      if (!checked) {
                        // The switch stays locked until the bottom bar confirms —
                        // flipping it here would lie about what CAMs can do.
                        if (row.active) {
                          setNotice(null);
                          setPendingUnlock(row.field_name);
                        }
                      } else if (!row.active) {
                        void relock(row);
                      }
                    }}
                    disabled={working === row.field_name}
                    variant="destructive"
                    showIcons
                    checkedIcon={<Lock aria-hidden="true" className="size-3" />}
                    uncheckedIcon={<Unlock aria-hidden="true" className="size-3" />}
                  />
                )}
              </li>
            ))}
            {rows.length === 0 && (
              <li className={`${ROW} text-[13px] text-dim`}>
                No fields are locked. CAMs can change every detail on a client record directly.
              </li>
            )}
          </ul>
        </section>
      </Rise>

      {!readOnly && (
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

        </section>
      </Rise>
      )}

      {/* Unlocking confirms here, at the bottom of the screen — the same
          position as the score settings save bar — so the toggle in the list
          never moves and the row stays where it is, locked or not. */}
      {!readOnly && pendingRow && (
        <div className="sticky bottom-4 z-10 mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-3 gap-y-2 rounded-panel border border-rule bg-white px-4 py-3 sm:flex-nowrap">
          <p aria-live="polite" className="mr-auto min-w-0 flex-1 text-[13px] leading-[1.55] text-ink">
            Unlock {restrictedFieldLabel(pendingRow.field_name).toLowerCase()}? CAMs can
            change it directly again.
          </p>
          <span className="flex shrink-0 items-center gap-x-3">
            <button
              type="button"
              onClick={() => setPendingUnlock(null)}
              disabled={working !== null}
              className={QUIET_BUTTON}
            >
              Keep it locked
            </button>
            <button
              type="button"
              onClick={() => void unlock(pendingRow.field_name)}
              disabled={working !== null}
              aria-busy={working === pendingRow.field_name || undefined}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-inset border border-stop bg-stop px-2.5 py-1 whitespace-nowrap text-[13px] font-medium text-white transition-colors hover:bg-stop/90 focus-visible:ring-2 focus-visible:ring-stop/30 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
            >
              {working === pendingRow.field_name && (
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              )}
              {working === pendingRow.field_name ? "Unlocking…" : "Yes, unlock it"}
            </button>
          </span>
        </div>
      )}
    </>
  );
}
