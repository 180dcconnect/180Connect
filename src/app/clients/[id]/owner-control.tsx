"use client";

import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/animate-ui/components/radix/dialog";

import { AssignOwnerForm } from "./assign-owner-form";

type TeamMember = { id: string; full_name: string | null };

/** First letters of the first two words. */
function initialsOf(name: string | null | undefined): string {
  return (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

/**
 * Who this record belongs to, and the one control that changes it — in the
 * header, on every tab.
 *
 * Ownership used to be shown twice: read-only in the hero, with the claim and
 * reassign controls in a card far down the right-hand column, under a hero line
 * that read "Claim it from the Ownership card below." A record's owner is the
 * first thing a CAM checks and among the first things an admin changes, so the
 * display and the control are the same thing now, and the card is gone.
 *
 * Reassign opens a dialog rather than expanding in place: the form carries a
 * picker plus a required reason that lands in the audit log, which is more than
 * a header row should grow to hold inline.
 */
export function OwnerControl({
  organisationId,
  ownerId,
  ownerName,
  isSelf,
  canEdit,
  isAdmin,
  team,
}: {
  organisationId: string;
  ownerId: string | null;
  ownerName: string | null;
  isSelf: boolean;
  canEdit: boolean;
  isAdmin: boolean;
  team: TeamMember[];
}) {
  const [assigning, setAssigning] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = team
    .filter((m) => (m.full_name ?? "").toLowerCase().includes(search.trim().toLowerCase()))
    .slice(0, 30);

  async function handleAssign(e?: React.FormEvent) {
    e?.preventDefault();
    if (!selectedId) {
      setError("Choose a team member.");
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${organisationId}/assign-owner`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId: selectedId, reason }),
      });
      if (res.ok) {
        setDropdownOpen(false);
        setSelectedId(null);
        setReason("");
        setSearch("");
        window.location.reload();
        return;
      }
      const body = await res.json();
      setError(body.error ?? "Could not assign.");
    } catch {
      setError("Could not reach server.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSelfAssign() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${organisationId}/claim`, { method: "POST" });
      if (res.ok) {
        setDropdownOpen(false);
        window.location.reload();
        return;
      }
      const body = await res.json();
      setError(body.error ?? "Could not claim.");
    } catch {
      setError("Could not reach server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="font-body text-[12px] uppercase font-bold tracking-[-0.01em] text-ink">Owner</span>

      <div className="relative">
        {ownerId ? (
          isAdmin ? (
            <button
              type="button"
              onClick={() => setDropdownOpen((v) => !v)}
              aria-expanded={dropdownOpen}
              aria-haspopup="listbox"
              className="flex min-w-0 items-center gap-2 rounded-full border border-rule bg-white px-2.5 py-1 pr-2 text-[12px] font-medium text-ink transition-colors hover:bg-paper focus-visible:ring-2 focus-visible:ring-lead-mid focus-visible:outline-none"
            >
              <span
                aria-hidden="true"
                className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-ink font-mono text-[9.5px] font-semibold text-white"
              >
                {initialsOf(ownerName) || "?"}
              </span>
              <span className="truncate text-[13.5px] font-medium text-ink">{ownerName}</span>
              {isSelf && <span className="text-faint">(you)</span>}
              <span aria-hidden="true" className={`ml-1 text-[10px] leading-none transition-transform ${dropdownOpen ? "rotate-180" : ""}`}>
                ▾
              </span>
            </button>
          ) : (
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-ink font-mono text-[9.5px] font-semibold text-white"
              >
                {initialsOf(ownerName) || "?"}
              </span>
              <span className="truncate text-[13.5px] font-medium text-ink">{ownerName}</span>
              {isSelf && <span className="text-[13px] text-faint">(you)</span>}
            </span>
          )
        ) : isAdmin ? (
          <button
            type="button"
            onClick={() => setDropdownOpen((v) => !v)}
            aria-expanded={dropdownOpen}
            aria-haspopup="listbox"
            className="inline-flex items-center gap-2 rounded-full border border-rule bg-white px-2.5 py-1 pr-2 text-[12px] font-medium text-dim transition-colors hover:bg-paper focus-visible:ring-2 focus-visible:ring-lead-mid focus-visible:outline-none"
          >
            <span
              aria-hidden="true"
              className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-ink font-mono text-[9.5px] font-semibold text-white"
            >
              UA
            </span>
            <span className="text-[13.5px] font-medium text-black">Unassigned</span>
            <span aria-hidden="true" className={`ml-1 text-[10px] leading-none transition-transform ${dropdownOpen ? "rotate-180" : ""}`}>
              ▾
            </span>
          </button>
        ) : canEdit ? (
          <button
            type="button"
            onClick={() => setDropdownOpen((v) => !v)}
            aria-expanded={dropdownOpen}
            aria-haspopup="dialog"
            className="inline-flex items-center gap-2 rounded-full border border-rule bg-white px-2.5 py-1 pr-2 text-[12px] font-medium text-dim transition-colors hover:bg-paper focus-visible:ring-2 focus-visible:ring-lead-mid focus-visible:outline-none"
          >
            <span
              aria-hidden="true"
              className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-ink font-mono text-[9.5px] font-semibold text-white"
            >
              UA
            </span>
            <span className="text-[13.5px] font-medium text-black">Unassigned</span>
            <span aria-hidden="true" className={`ml-1 text-[10px] leading-none transition-transform ${dropdownOpen ? "rotate-180" : ""}`}>
              ▾
            </span>
          </button>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-full border border-rule bg-white px-2.5 py-1 text-[12px] font-medium text-dim">
            <span
              aria-hidden="true"
              className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-ink font-mono text-[9.5px] font-semibold text-white"
            >
              UA
            </span>
            <span className="text-[13.5px] font-medium text-black">Unassigned</span>
          </span>
        )}

        {(isAdmin || (canEdit && !ownerId)) && dropdownOpen && (
          <div className="absolute left-0 top-full z-20 mt-2 w-72 rounded-2xl border border-black/[0.08] bg-white p-3 shadow-xl">
            {isAdmin ? (
              <>
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search team (30 max)…"
                  className="mb-2 w-full rounded-full border border-rule bg-white px-3 py-1.5 text-xs outline-none focus:border-lead"
                  aria-label="Search team members"
                />
                <div className="max-h-64 overflow-y-auto">
                  {filtered.length === 0 ? (
                    <p className="px-2 py-2 text-xs text-dim">No matching team members.</p>
                  ) : (
                    <ul className="space-y-1" role="listbox">
                      {filtered.map((m) => (
                        <li key={m.id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={selectedId === m.id}
                            onClick={() => setSelectedId(m.id)}
                            className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-paper ${selectedId === m.id ? "bg-lead-wash text-lead" : "text-ink"}`}
                          >
                            <span className="flex items-center gap-2 truncate">
                              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-ink font-mono text-[8px] font-semibold text-white">
                                {initialsOf(m.full_name) || "?"}
                              </span>
                              {m.full_name ?? "Unnamed"}
                            </span>
                            {selectedId === m.id && <span aria-hidden="true">✓</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {selectedId && (
                  <form onSubmit={handleAssign} className="mt-3 border-t border-rule pt-3">
                    <label className="flex flex-col gap-1 text-xs">
                      <span className="font-medium text-dim">Reason (required)</span>
                      <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Why this handover?"
                        className="rounded-full border border-rule bg-white px-3 py-1.5 text-xs outline-none focus:border-lead"
                      />
                    </label>
                    {error && <p className="mt-2 text-xs font-semibold text-stop">{error}</p>}
                    <div className="mt-2 flex gap-2">
                      <button
                        type="submit"
                        disabled={busy}
                        className="rounded-full bg-lead px-3 py-1.5 text-xs font-bold text-white hover:bg-lead-mid disabled:opacity-50"
                      >
                        {busy ? "Assigning…" : "Confirm assign"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDropdownOpen(false)}
                        className="rounded-full border border-rule bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-paper"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </>
            ) : (
              <div className="p-1">
                <p className="px-2 py-1 text-xs leading-relaxed text-dim">Assign this unassigned client to you?</p>
                {error && <p className="mt-1 px-2 text-xs font-semibold text-stop">{error}</p>}
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={handleSelfAssign}
                    disabled={busy}
                    className="rounded-full bg-lead px-4 py-1.5 text-xs font-bold text-white hover:bg-lead-mid disabled:opacity-50"
                  >
                    {busy ? "Assigning…" : "Assign to me"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDropdownOpen(false)}
                    className="rounded-full border border-rule bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-paper"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {isAdmin && (
        <Dialog open={assigning} onOpenChange={setAssigning}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{ownerId ? "Reassign this client" : "Assign an owner"}</DialogTitle>
              <DialogDescription>
                The reason is required and is written to the audit log alongside the change.
              </DialogDescription>
            </DialogHeader>
            <AssignOwnerForm
              organisationId={organisationId}
              currentOwnerId={ownerId}
              currentOwnerName={ownerName}
              team={team}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
