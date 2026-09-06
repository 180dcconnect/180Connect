"use client";

import { MOCK_INBOX_THREADS } from "@/lib/inbox-mock-data";
import { GmailInboxShellBefore } from "@/components/inbox/before/gmail-inbox-shell";

/**
 * Dedicated Standalone "Before" View of the Outreach Inbox:
 * Renders the frozen pre-redesign Gmail-style inbox shell in full screen.
 */
export default function PreviewInboxBeforeStandalonePage() {
  return (
    <div className="h-[100dvh] overflow-hidden bg-[#f6f8fc] text-foreground flex flex-col">
      <main className="h-full w-full py-2 pr-2 sm:pr-4 flex flex-col min-h-0">
        <GmailInboxShellBefore initialThreads={MOCK_INBOX_THREADS} className="h-full" />
      </main>
    </div>
  );
}

