"use client";

import { useState } from "react";
import { OriginButton } from "@/components/ui/origin-button";

export type HandoverUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: "cam" | "admin" | "viewer";
  is_active: boolean;
};

type Preview = {
  organisations: { id: string; legal_name: string; open_actions: number }[];
  crossOrgActions: { id: string; title: string; organisation: string }[];
};

type Result = {
  organisationsMoved: number;
  actionsMoved: number;
  skipped: number;
};

function label(user: HandoverUser) {
  const name = user.full_name ?? user.email;
  return user.is_active ? name : `${name} (deactivated)`;
}

export function OffboardPanel({ users }: { users: HandoverUser[] }) {
  const [fromUserId, setFromUserId] = useState("");
  const [toUserId, setToUserId] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadPreview(userId: string) {
    setFromUserId(userId);
    setPreview(null);
    setResult(null);
    setMessage("");
    if (!userId) return;

    setBusy(true);
    try {
      const response = await fetch(
        `/api/admin/offboard?userId=${encodeURIComponent(userId)}`,
      );
      const body = await response.json();
      if (!response.ok) {
        setMessage(body.error ?? "That team member's work could not be loaded.");
        return;
      }
      setPreview(body as Preview);
    } catch {
      setMessage("Could not load their work. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setResult(null);
    try {
      const response = await fetch("/api/admin/offboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromUserId, toUserId, reason }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage(body.error ?? "The handover was blocked.");
        return;
      }
      setResult(body as Result);
      setReason("");
      // The preview described a state that no longer exists.
      await loadPreview(fromUserId);
    } catch {
      setMessage("The handover could not be saved. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const nothingToMove =
    preview !== null
    && preview.organisations.length === 0
    && preview.crossOrgActions.length === 0;

  const ready =
    fromUserId !== ""
    && toUserId !== ""
    && toUserId !== fromUserId
    && reason.trim() !== ""
    && !nothingToMove;

  return (
    <form className="mt-6" onSubmit={submit}>
      <label className="block text-sm font-bold" htmlFor="from-user">
        Who is leaving
      </label>
      <select
        className="mt-2 w-full rounded-lg border border-black/15 bg-white px-3 py-2"
        disabled={busy}
        id="from-user"
        onChange={(event) => loadPreview(event.target.value)}
        value={fromUserId}
      >
        <option value="">Select a team member…</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>{label(user)}</option>
        ))}
      </select>

      {preview && (
        <div className="mt-6 rounded-xl bg-[#f1f2f4] p-4">
          <h2 className="text-sm font-bold">What moves</h2>
          {nothingToMove ? (
            <p className="mt-2 text-sm text-foreground/65">
              They own no clients and have no open actions. Nothing to reassign.
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm">
                <strong>{preview.organisations.length}</strong>
                {preview.organisations.length === 1 ? " client" : " clients"}
                {", "}
                <strong>
                  {preview.organisations.reduce((sum, o) => sum + o.open_actions, 0)}
                </strong>
                {" open actions on them"}
              </p>
              <ul className="mt-3 space-y-1 text-sm text-foreground/75">
                {preview.organisations.map((organisation) => (
                  <li key={organisation.id}>
                    {organisation.legal_name}
                    {organisation.open_actions > 0
                      && ` — ${organisation.open_actions} open`}
                  </li>
                ))}
              </ul>
              {preview.crossOrgActions.length > 0 && (
                <>
                  <p className="mt-4 text-sm">
                    <strong>{preview.crossOrgActions.length}</strong>
                    {" action(s) on clients they do not own — these move too"}
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-foreground/75">
                    {preview.crossOrgActions.map((action) => (
                      <li key={action.id}>
                        {action.title} — {action.organisation}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      )}

      {preview && !nothingToMove && (
        <>
          <label className="mt-6 block text-sm font-bold" htmlFor="to-user">
            Who takes over
          </label>
          <select
            className="mt-2 w-full rounded-lg border border-black/15 bg-white px-3 py-2"
            disabled={busy}
            id="to-user"
            onChange={(event) => setToUserId(event.target.value)}
            value={toUserId}
          >
            <option value="">Select a team member…</option>
            {users
              .filter((user) => user.is_active && user.id !== fromUserId)
              .map((user) => (
                <option key={user.id} value={user.id}>{label(user)}</option>
              ))}
          </select>

          <label className="mt-6 block text-sm font-bold" htmlFor="reason">
            Reason
          </label>
          <p className="mt-1 text-sm text-foreground/65">
            Recorded against every client that moves, and shown in their history.
          </p>
          <textarea
            className="mt-2 w-full rounded-lg border border-black/15 bg-white px-3 py-2"
            disabled={busy}
            id="reason"
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            value={reason}
          />

          <OriginButton
            className="mt-6"
            disabled={busy || !ready}
            loading={busy}
            size="md"
            type="submit"
          >
            {busy ? "Reassigning…" : "Reassign the work"}
          </OriginButton>
        </>
      )}

      <p aria-live="polite" className="mt-5 min-h-6 text-sm font-bold">
        {message}
        {result && (
          <span>
            {`Moved ${result.organisationsMoved} client(s) and ${result.actionsMoved} action(s).`}
            {/* A skip is not a failure — a client whose owner changed since the preview
                is left alone on purpose. Saying so stops it reading as data loss. */}
            {result.skipped > 0
              && ` ${result.skipped} were left alone because they had already moved.`}
          </span>
        )}
      </p>
    </form>
  );
}
