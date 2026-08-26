"use client";

import { useState } from "react";
import { OriginButton } from "@/components/ui/origin-button";
import { retryFailedEmail } from "./outreach-actions";

/**
 * F129: scheduled deliveries whose send did not leave. Each row shows why it
 * failed (from the newest SEND_EVENTS 'failed' record) and offers a retry —
 * the reviewed content is intact, so nothing has to be recreated.
 */
export function FailedEmailList({
  organisationId,
  messages,
}: {
  organisationId: string;
  messages: { id: string; subject: string; reason: string }[];
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (messages.length === 0) return null;
  return (
    <div className="mt-4 space-y-2">
      <h4 className="text-xs font-bold uppercase tracking-wide text-foreground/55">Failed sends</h4>
      {messages.map((message) => (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-3"
          key={message.id}
        >
          <p className="text-sm">
            <strong>{message.subject}</strong>
            <br />
            <span className="text-xs text-red-800">{message.reason}</span>
          </p>
          <OriginButton
            disabled={busy === message.id}
            onClick={async () => {
              setBusy(message.id);
              setNotice(null);
              const result = await retryFailedEmail({ organisationId, messageId: message.id });
              setNotice(result.message);
              setBusy(null);
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            {busy === message.id ? "Retrying…" : "Retry send"}
          </OriginButton>
        </div>
      ))}
      {notice && (
        <p className="text-xs font-bold text-red-800" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
