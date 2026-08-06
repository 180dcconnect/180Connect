"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * F162 — claims an unowned client for the signed-in CAM/admin. Used on both the
 * profile page (src/app/clients/[id]/page.tsx) and the client list
 * (src/app/clients/page.tsx), which is why it takes a `compact` variant rather than
 * being two separate components.
 *
 * On a 409 the server is reporting AC2's conflict case — someone else claimed this
 * client, either before the page loaded or in the race between load and click. That
 * is shown as a distinct, sticky warning rather than folded into the generic error
 * state, so a CAM cannot read it as "try again" and retry into an override. This is
 * the minimal form of F165 (conflict-warning flow): F165 itself, not a dependency of
 * this issue, can build a fuller resolution UI later without this button changing.
 */
export function ClaimButton({
  organisationId,
  compact = false,
}: {
  organisationId: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function claim() {
    setBusy(true);
    setConflict(null);
    setError(null);
    try {
      const response = await fetch(`/api/clients/${organisationId}/claim`, {
        method: "POST",
      });
      if (response.ok) {
        router.refresh();
        return;
      }
      const body = await response.json();
      if (response.status === 409) {
        setConflict(
          body.error ??
            "Someone already owns this client. Refresh to see who — self-assignment cannot override an existing owner.",
        );
        return;
      }
      setError(body.error ?? "This client could not be claimed.");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const message = conflict ?? error;

  return (
    <div className={compact ? "text-right" : ""}>
      <button
        className={
          compact
            ? "shrink-0 rounded-full border border-brand/30 px-3 py-1 text-xs font-bold text-brand hover:bg-brand/5 disabled:opacity-50"
            : "rounded-lg bg-brand px-5 py-2.5 font-bold text-white disabled:opacity-50"
        }
        disabled={busy}
        onClick={claim}
        type="button"
      >
        {busy ? "Claiming…" : "Claim this client"}
      </button>
      {message && (
        <p
          aria-live="polite"
          role={conflict ? "alert" : undefined}
          className={
            (compact ? "mt-1 text-xs " : "mt-3 text-sm ") +
            "font-bold " +
            (conflict ? "text-amber-800" : "text-red-800")
          }
        >
          {message}
        </p>
      )}
    </div>
  );
}
