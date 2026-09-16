"use client";

import {
  RequestFeedbackButton as RequestFeedbackButtonUI,
  type RequestFeedbackButtonProps,
} from "@/components/ui/request-feedback-button";
import { requestFeedbackRound } from "@/lib/feedback-actions";

/**
 * Admin-only button: clears feedback_snoozed_until for every active user,
 * so the in-app prompt re-appears on their next dashboard visit.
 *
 * Implements confirmation morph ("Confirm" + "X" cancel), Thanos snap particle
 * dissolve, and a smooth 1-second reappearance animation.
 */
export function RequestFeedbackButton(props: Partial<RequestFeedbackButtonProps>) {
  const handleConfirm = async () => {
    const result = await requestFeedbackRound();
    if (!result.ok) {
      throw new Error(result.message);
    }
  };

  return (
    <RequestFeedbackButtonUI
      onConfirm={handleConfirm}
      variant="lead"
      size="md"
      {...props}
    />
  );
}

