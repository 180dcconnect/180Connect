"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useBulkSelect } from "./bulk-select-provider";
import { OriginButton } from "@/components/ui/origin-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { UsersGroupIcon } from "@/components/ui/users-group-icon";

type TeamMember = { id: string; full_name: string | null };

/**
 * F253: Bulk Assign Action Bar & Dialog.
 * When one or more clients are selected on the list by an admin, this floating action bar
 * slides up from the bottom of the viewport. Opening the modal allows picking a target CAM
 * and providing a mandatory audit reason, executing the bulk assignment via the F253 API.
 */
export function BulkActionBar({ team }: { team: TeamMember[] }) {
  const router = useRouter();
  const { selectedIds, selectedCount, clearSelection } = useBulkSelect();
  const [modalOpen, setModalOpen] = useState(false);
  const [ownerId, setOwnerId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close modal on Escape key
  useEffect(() => {
    if (!modalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        setModalOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [modalOpen, busy]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ownerId) {
      setError("Choose a CAM to assign.");
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required so the handover can be understood later.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/clients/bulk-assign-owner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organisationIds: Array.from(selectedIds),
          ownerId,
          reason: reason.trim(),
        }),
      });

      if (response.ok) {
        setReason("");
        setOwnerId("");
        setModalOpen(false);
        clearSelection();
        router.refresh();
        return;
      }

      const body = await response.json();
      setError(body.error ?? "These clients could not be assigned.");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AnimatePresence>
        {selectedCount > 0 && (
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="fixed bottom-6 inset-x-0 z-40 mx-auto flex max-w-lg items-center justify-between gap-4 rounded-2xl border border-black/10 bg-[#1c1a18]/95 px-5 py-3.5 text-white shadow-2xl backdrop-blur-md"
            role="region"
            aria-label="Bulk actions"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/20 text-xs font-bold text-[#e6f5c0]">
                {selectedCount}
              </span>
              <span className="text-sm font-medium text-white/90">
                client{selectedCount === 1 ? "" : "s"} selected
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={clearSelection}
                className="rounded-full px-3 py-1.5 text-xs font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              >
                Clear
              </button>
              <OriginButton
                size="sm"
                variant="default"
                onClick={() => {
                  setError(null);
                  setModalOpen(true);
                }}
              >
                Assign owner
              </OriginButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !busy && setModalOpen(false)}
              className="fixed inset-0 bg-black/50 backdrop-blur-xs"
              aria-hidden="true"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="relative w-full max-w-md overflow-hidden rounded-2xl border border-black/10 bg-white p-6 shadow-2xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="bulk-assign-title"
            >
              <div className="flex items-center gap-3 border-b border-black/[0.06] pb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
                  <UsersGroupIcon className="h-5 w-5" />
                </div>
                <div>
                  <h2 id="bulk-assign-title" className="text-lg font-bold text-foreground">
                    Bulk Assign Owner
                  </h2>
                  <p className="text-xs text-foreground/60">
                    Assigning {selectedCount} client{selectedCount === 1 ? "" : "s"} in one action
                  </p>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="mt-4 space-y-4">
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/50">
                    Assign to CAM
                  </span>
                  <Select value={ownerId} onValueChange={setOwnerId}>
                    <SelectTrigger className="w-full rounded-xl bg-white text-sm border-black/15">
                      <SelectValue placeholder="Choose a CAM" />
                    </SelectTrigger>
                    <SelectContent>
                      {team.map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.full_name ?? "Unnamed CAM"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/50">
                    Reason
                  </span>
                  <Input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Workload redistribution or onboarding"
                    className="rounded-xl border-black/15 bg-white"
                  />
                  <span className="text-[11px] text-foreground/40">
                    Recorded in the audit log for each client
                  </span>
                </label>

                {error && (
                  <p role="alert" className="text-xs font-bold text-destructive">
                    {error}
                  </p>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <OriginButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setModalOpen(false)}
                  >
                    Cancel
                  </OriginButton>
                  <OriginButton
                    type="submit"
                    size="sm"
                    variant="dark"
                    loading={busy}
                    disabled={busy}
                  >
                    {busy ? "Assigning…" : `Assign ${selectedCount} client${selectedCount === 1 ? "" : "s"}`}
                  </OriginButton>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
