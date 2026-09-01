"use client";

import { useState } from "react";
import { OriginButton } from "@/components/ui/origin-button";
import { cancelScheduledEmail } from "./outreach-actions";

export function ScheduledEmailList({ organisationId, messages }: { organisationId: string; messages: { id: string; subject: string; scheduled_at: string }[] }) {
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (messages.length === 0) return null;
  return (
    <div className="mt-4 space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-dim">Scheduled</h4>
      {messages.map((message) => (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-inset border border-hold/25 bg-hold-wash p-3" key={message.id}>
          <p className="text-sm"><strong>{message.subject}</strong><br /><span className="text-xs text-dim">{new Date(message.scheduled_at).toLocaleString("en-GB")}</span></p>
          <OriginButton disabled={busy === message.id} onClick={async () => { setBusy(message.id); const result = await cancelScheduledEmail({ organisationId, messageId: message.id }); setNotice(result.message); setBusy(null); }} size="sm" type="button" variant="outline">Cancel schedule</OriginButton>
        </div>
      ))}
      {notice && <p className="text-xs font-semibold" role="status">{notice}</p>}
    </div>
  );
}
