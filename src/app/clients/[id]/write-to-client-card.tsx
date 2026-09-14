import { Mail, ArrowRight } from "lucide-react";
import { SectionCard } from "./section-card";
import { OriginButton } from "@/components/ui/origin-button";

/**
 * The client record's one route into composing.
 *
 * Writing and sending happen in the inbox, and only there. This page is for
 * knowing a client — mission, financials, contacts, what we have already sent
 * — so it links to the composer rather than embedding one. Four composing
 * surfaces used to exist, each independently responsible for the ownership,
 * suppression, rate-limit, approval and audit rules; the contract tests
 * guarding them exist because they kept drifting. One surface cannot drift.
 *
 * What does NOT move is knowing whether this client can be contacted. That is
 * a fact about the client, so it is answered here, before a CAM changes page
 * and writes an email that was never going to be allowed to leave.
 */
export function WriteToClientCard({
  organisationId,
  blocked,
  ownershipBlocked,
  suppressionReason,
  ownershipWarning,
  hasDraft,
  recipientEmail,
}: {
  organisationId: string;
  blocked: boolean;
  ownershipBlocked: boolean;
  suppressionReason?: string;
  ownershipWarning?: string;
  hasDraft: boolean;
  /**
   * The address on file (primary contact, else the organisation's own —
   * already redaction-filtered by the caller). Travels as ?to= so the inbox
   * composer opens addressed even when this client is absent from its
   * directory (seed rows are excluded there by design). Null when nothing is
   * on file: the window then opens blank, as before.
   */
  recipientEmail?: string | null;
}) {
  const stopped = blocked || ownershipBlocked;
  const composeHref =
    recipientEmail?.trim()
      ? `/inbox?compose=${organisationId}&to=${encodeURIComponent(recipientEmail.trim())}`
      : `/inbox?compose=${organisationId}`;
  return (
    <SectionCard
      headingId="outreach-compose-heading"
      title="Write to this client"
      hint={
        stopped
          ? "Outreach to this client is on hold."
          : hasDraft
            ? "A draft is already open for this client in the inbox."
            : "Emails are written and sent in the inbox."
      }
      icon={<Mail />}
    >
      {stopped ? (
        <p className="mt-4 text-[13px] font-semibold leading-[1.6] text-stop" role="alert">
          {blocked
            ? suppressionReason
              ? `This client is suppressed: ${suppressionReason}`
              : "This client is suppressed and cannot be contacted."
            : (ownershipWarning ?? "Outreach is unavailable on this client.")}
        </p>
      ) : (
        <div className="mt-4">
          {/* ?compose= resolves to a window already addressed to this client,
              so the trip to the inbox costs no retyping. ?to= carries the
              on-file address for clients the inbox directory cannot resolve
              (seed rows are excluded there); the shell prefers its own
              directory hit whenever it has one. */}
          <OriginButton variant="ink" size="md" href={composeHref}>
            {hasDraft ? "Continue draft in inbox" : "Write in inbox"}
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </OriginButton>
        </div>
      )}
    </SectionCard>
  );
}
