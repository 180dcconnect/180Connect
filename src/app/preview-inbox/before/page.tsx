"use client";

import { MOCK_INBOX_THREADS } from "@/lib/inbox-mock-data";
import { GmailInboxShellBefore } from "@/components/inbox/before/gmail-inbox-shell";

/**
 * Dedicated Standalone "Before" View of the Outreach Inbox:
 * Renders the frozen pre-redesign Gmail-style inbox shell in full screen.
 */
export default function PreviewInboxBeforeStandalonePage() {
  return (
    <div className="min-h-screen bg-[#f6f8fc] text-foreground">
      <main className="w-full py-3 pr-2 sm:pr-4">
        <GmailInboxShellBefore initialThreads={MOCK_INBOX_THREADS} />
      </main>
    </div>
  );
}
