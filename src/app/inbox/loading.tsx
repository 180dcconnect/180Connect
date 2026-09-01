import { ThreadList } from "@/components/inbox/thread-list";

/**
 * Skeleton for /inbox. The heading, subtitle and container match page.tsx
 * exactly — they used to differ ("Outreach Threads" here, "Outreach Inbox"
 * there), which made the copy visibly flip as the real list arrived.
 */
export default function InboxLoading() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="text-2xl font-bold mb-1">Outreach Inbox</h1>
      <p className="text-sm text-muted-foreground mb-6">
        All outreach threads, newest activity first. Open a thread to read it and reply.
      </p>
      <ThreadList threads={[]} />
    </div>
  );
}
