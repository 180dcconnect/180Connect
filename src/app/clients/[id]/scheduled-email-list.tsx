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
      <h4 className="text-xs font-bold uppercase tracking-wide text-foreground/55">Scheduled</h4>
      {messages.map((message) => (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3" key={message.id}>
          <p className="text-sm"><strong>{message.subject}</strong><br /><span className="text-xs text-foreground/60">{new Date(message.scheduled_at).toLocaleString("en-GB")}</span></p>
          <OriginButton disabled={busy === message.id} onClick={async () => { setBusy(message.id); const result = await cancelScheduledEmail({ organisationId, messageId: message.id }); setNotice(result.message); setBusy(null); }} size="sm" type="button" variant="outline">Cancel schedule</OriginButton>
        </div>
      ))}
      {notice && <p className="text-xs font-bold" role="status">{notice}</p>}
    </div>
  );
}
