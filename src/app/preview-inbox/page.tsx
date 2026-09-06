"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Columns2, ExternalLink, History, Sparkles } from "lucide-react";

import { GmailInboxShellBefore } from "@/components/inbox/before/gmail-inbox-shell";
import { InboxScopeTabs } from "@/components/inbox/inbox-scope-tabs";
import { QueueList } from "@/components/inbox/queue-list";
import { MOCK_INBOX_THREADS, mockQueueRows } from "@/lib/inbox-mock-data";
import { BUCKET_HINT, bucketLabel } from "@/lib/inbox-labels";
import {
  countByBucket,
  countByScope,
  filterByBucket,
  filterByScope,
  INBOX_BUCKETS,
  type InboxQueueBucket,
  type InboxScope,
} from "@/lib/inbox-queue";

/**
 * Before/after harness for the inbox redesign.
 *
 * "Before" is the frozen Gmail shell in `src/components/inbox/before/` — a
 * snapshot, wired to nothing, kept only so the two can be looked at together.
 * "After" is the real queue: the same components `/inbox` renders, fed the mock
 * rows, so what you see here is what ships apart from the data behind it.
 *
 * This route is a workbench, not an app screen — it is not in the sidebar and
 * it does not sit under `AppShell`. It dies with the mock data.
 */

const PREVIEW_ACTOR = "preview-cam";

function PreviewInboxContent() {
  const [showBefore, setShowBefore] = useState(false);
  const [scope, setScope] = useState<InboxScope>("mine");
  const [bucket, setBucket] = useState<InboxQueueBucket | null>(null);
  const [isEmpty, setIsEmpty] = useState(false);

  const rows = useMemo(
    () => (isEmpty ? [] : mockQueueRows(PREVIEW_ACTOR)),
    [isEmpty],
  );
  const scoped = useMemo(() => filterByScope(rows, scope), [rows, scope]);
  const visible = useMemo(() => filterByBucket(scoped, bucket), [scoped, bucket]);
  const scopeCounts = useMemo(() => countByScope(rows), [rows]);
  const bucketCounts = useMemo(() => countByBucket(scoped), [scoped]);

  const groups = bucket
    ? [{ bucket, rows: visible }]
    : INBOX_BUCKETS.map((key) => ({
        bucket: key,
        rows: visible.filter((row) => row.bucket === key),
      })).filter((group) => group.rows.length > 0);

  return (
    <div className="min-h-screen bg-[#f4f4ef]">
      <header className="sticky top-0 z-40 border-b border-rule bg-white/90 px-4 py-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[10.5px] font-medium tracking-[0.09em] text-faint uppercase">
              Inbox redesign
            </p>
            <h1 className="text-[15px] leading-tight font-semibold text-ink">
              Queue preview, on mock data
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
            <button
              type="button"
              onClick={() => setShowBefore((value) => !value)}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold transition-colors ${
                showBefore
                  ? "bg-ink text-white"
                  : "bg-paper text-dim hover:bg-paper-sunk hover:text-ink"
              }`}
            >
              {showBefore ? (
                <History aria-hidden="true" className="size-3.5" />
              ) : (
                <Sparkles aria-hidden="true" className="size-3.5" />
              )}
              <span>{showBefore ? "Hide the old shell" : "Show the old shell"}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsEmpty((value) => !value)}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold transition-colors ${
                isEmpty
                  ? "bg-ink text-white"
                  : "bg-paper text-dim hover:bg-paper-sunk hover:text-ink"
              }`}
            >
              <Columns2 aria-hidden="true" className="size-3.5" />
              <span>Empty state</span>
            </button>

            <Link
              href="/preview-inbox-thread"
              className="inline-flex items-center gap-1 rounded-full bg-paper px-2.5 py-1 font-semibold text-dim transition-colors hover:bg-paper-sunk hover:text-ink"
            >
              <span>Thread view</span>
              <ArrowRight aria-hidden="true" className="size-3" />
            </Link>

            <Link
              href="/inbox"
              target="_blank"
              className="inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-1 font-semibold text-white"
            >
              <span>Live /inbox</span>
              <ExternalLink aria-hidden="true" className="size-3 opacity-70" />
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-8 sm:px-8 sm:py-10">
        <div>
          <h2 className="font-body text-[clamp(2rem,4vw,2.75rem)] leading-[1] font-semibold tracking-[-0.03em] text-ink">
            Inbox
          </h2>
          <p className="mt-2 max-w-[54ch] text-[13px] leading-[1.55] text-dim">
            Outreach that is waiting on somebody. Replies first, then clients
            that have gone quiet past your follow-up threshold.
          </p>
        </div>

        {/* The real switcher is a set of links driving ?scope=/?bucket=. In the
            harness there is no route to drive, so the same visual row is wired
            to local state — the queue below is the shipping component. */}
        <div
          onClickCapture={(event) => {
            const anchor = (event.target as HTMLElement).closest("a");
            if (!anchor) return;
            event.preventDefault();
            const url = new URL(anchor.getAttribute("href") ?? "/inbox", "http://x");
            setScope((url.searchParams.get("scope") as InboxScope | null) ?? "mine");
            setBucket(url.searchParams.get("bucket") as InboxQueueBucket | null);
          }}
        >
          <InboxScopeTabs
            scope={scope}
            bucket={bucket}
            scopeCounts={scopeCounts}
            bucketCounts={bucketCounts}
          />
        </div>

        {groups.length === 0 ? (
          <QueueList
            rows={[]}
            emptyTitle="Nothing waiting"
            emptyHint="No outreach of yours needs an answer or a follow-up. Try the Team or All scope to see the rest of the pipeline."
          />
        ) : (
          groups.map((group) => (
            <div key={group.bucket} className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="text-[18px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink">
                  {bucketLabel(group.bucket)}
                </h3>
                <p className="max-w-[54ch] text-[13px] leading-[1.55] text-dim">
                  {BUCKET_HINT[group.bucket]}
                </p>
              </div>
              <QueueList rows={group.rows} />
            </div>
          ))
        )}

        {showBefore && (
          <section className="space-y-3 pt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="text-[18px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink">
                Before — the Gmail shell
              </h3>
              <p className="font-mono text-[10.5px] font-medium tracking-[0.09em] text-faint uppercase">
                src/components/inbox/before/
              </p>
            </div>
            <p className="max-w-[74ch] text-[13px] leading-[1.55] text-dim">
              A frozen snapshot. Its star, snooze, archive, compose and reply
              controls were browser state only — nothing behind them was ever
              saved, and none of it survives a refresh.
            </p>
            <div className="overflow-hidden rounded-panel border border-rule bg-white p-3">
              <GmailInboxShellBefore initialThreads={MOCK_INBOX_THREADS} />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default function PreviewInboxPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#f4f4ef] text-sm text-dim">
          Loading the inbox preview…
        </div>
      }
    >
      <PreviewInboxContent />
    </Suspense>
  );
}
