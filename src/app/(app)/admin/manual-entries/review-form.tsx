"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { OriginButton } from "@/components/ui/origin-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  approveManualEntry,
  checkAvailableManualEntryDependencies,
  rejectManualEntry,
  type ManualEntryReviewState,
} from "./actions";

const initialState: ManualEntryReviewState = { kind: "idle", message: "" };

const checkStyles = {
  passed: "border-green-200 bg-green-50 text-green-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  blocked: "border-red-200 bg-red-50 text-red-900",
} as const;

export function ManualEntryReviewForm({
  entryId,
  organisationType,
}: {
  entryId: string;
  organisationType: "charity" | "cio" | "cic" | "social_enterprise" | "ngo" | "company" | "both" | "other";
}) {
  const [state, checkAction, checking] = useActionState(
    checkAvailableManualEntryDependencies,
    initialState,
  );
  const [approvalState, approvalAction, approving] = useActionState(
    approveManualEntry,
    initialState,
  );
  const [rejectionState, rejectionAction, rejecting] = useActionState(
    rejectManualEntry,
    initialState,
  );
  const [duplicateDecision, setDuplicateDecision] = useState("link_existing");

  return (
    <div className="mt-4 rounded-xl border border-black/10 bg-gray-50 p-4">
      <h3 className="text-sm font-bold">Approval checks</h3>
      <p className="mt-1 text-sm text-foreground/65">
        Submitted organisation type: <span className="font-bold">{organisationType}</span>
      </p>
      <form action={checkAction} className="mt-3 space-y-3">
        <input name="id" type="hidden" value={entryId} />
        {(organisationType === "company" || organisationType === "other" || organisationType === "ngo") && (
          <label className="flex items-start gap-2 text-sm">
            <input className="mt-1" name="adminConfirmedEligible" type="checkbox" />
            <span>
              I have confirmed that this organisation is a non-profit, social enterprise,
              NGO or socially focused startup.
            </span>
          </label>
        )}
        <button
          className="rounded-lg border border-brand px-3 py-2 text-sm font-bold text-brand disabled:cursor-not-allowed disabled:opacity-50"
          disabled={checking}
          type="submit"
        >
          {checking ? "Running checks…" : "Run approval checks"}
        </button>
      </form>

      {state.message && (
        <p
          className={`mt-3 rounded-lg p-3 text-sm ${state.kind === "error" ? "bg-red-50 text-red-900" : "bg-blue-50 text-blue-900"}`}
          role={state.kind === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      )}
      {state.checks && (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {state.checks.map((check) => (
            <li className={`rounded-lg border p-3 text-sm ${checkStyles[check.status]}`} key={check.label}>
              <p className="font-bold">{check.label}: {check.status}</p>
              <p className="mt-1">{check.message}</p>
            </li>
          ))}
        </ul>
      )}

      {state.approval && (
        <form action={approvalAction} className="mt-4 space-y-3 rounded-lg border border-brand/30 bg-white p-4">
          <input name="id" type="hidden" value={entryId} />
          <input name="adminConfirmedEligible" type="hidden" value={String(state.approval.adminConfirmedEligible)} />
          <input name="candidateOrganisationId" type="hidden" value={state.approval.candidateOrganisationId ?? ""} />

          {state.approval.candidateOrganisationId ? (
            <>
              <p className="text-sm font-bold text-amber-900">
                Human duplicate decision required
              </p>
              <p className="text-sm text-foreground/70">
                The F042 matcher found{" "}
                <Link className="font-bold text-brand hover:underline" href={`/clients/${state.approval.candidateOrganisationId}`} target="_blank">
                  {state.approval.candidateOrganisationName ?? "an existing client"}
                </Link>
                {state.approval.matchedOn === "registration_number"
                  ? " with the same registration number."
                  : " with the same normalised name."}
              </p>
              <label className="block text-sm font-bold">
                Decision
                <input name="duplicateDecision" type="hidden" value={duplicateDecision} />
                <Select value={duplicateDecision} onValueChange={setDuplicateDecision}>
                  <SelectTrigger className="mt-1 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="link_existing">Same organisation — link existing client</SelectItem>
                    <SelectItem value="create_new">Different organisation — create separate client</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="block text-sm font-bold">
                Decision notes
                <textarea className="mt-1 w-full rounded-lg border border-black/20 px-3 py-2" minLength={3} name="notes" required rows={3} />
              </label>
            </>
          ) : (
            <>
              <input name="duplicateDecision" type="hidden" value="create_new" />
              <label className="block text-sm font-bold">
                Approval notes <span className="font-normal text-foreground/60">(optional)</span>
                <textarea className="mt-1 w-full rounded-lg border border-black/20 px-3 py-2" name="notes" rows={2} />
              </label>
            </>
          )}

          <OriginButton
            disabled={approving}
            loading={approving}
            size="md"
            type="submit"
          >
            {approving
              ? "Approving…"
              : state.approval.candidateOrganisationId
                ? "Save decision and approve"
                : "Approve and create client"}
          </OriginButton>
        </form>
      )}

      {approvalState.message && (
        <p
          className={`mt-3 rounded-lg p-3 text-sm ${approvalState.kind === "success" ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`}
          role={approvalState.kind === "error" ? "alert" : "status"}
        >
          {approvalState.message}
        </p>
      )}

      <form action={rejectionAction} className="mt-4 flex flex-wrap gap-2 border-t border-black/10 pt-4">
        <input name="id" type="hidden" value={entryId} />
        <input
          className="min-w-40 flex-1 rounded-lg border border-black/20 px-3 py-2 text-sm"
          minLength={3}
          name="notes"
          placeholder="Reason for rejection"
          required
        />
        <button
          className="rounded-lg bg-red-700 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={rejecting}
          type="submit"
        >
          {rejecting ? "Rejecting…" : "Reject"}
        </button>
      </form>
      {rejectionState.message && (
        <p
          className={`mt-3 rounded-lg p-3 text-sm ${rejectionState.kind === "success" ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`}
          role={rejectionState.kind === "error" ? "alert" : "status"}
        >
          {rejectionState.message}
        </p>
      )}
    </div>
  );
}
