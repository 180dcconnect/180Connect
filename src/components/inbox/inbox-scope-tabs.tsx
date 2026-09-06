import Link from "next/link";

import { bucketLabel } from "@/lib/inbox-labels";
import {
  INBOX_BUCKETS,
  type InboxQueueBucket,
  type InboxScope,
} from "@/lib/inbox-queue";

/**
 * The two filters that shape the queue: whose it is, and which pile.
 *
 * Both are links driving `?scope=` and `?bucket=`, not local state — the same
 * decision `/clients` made with `?owner=` (src/app/clients/page.tsx:417). It
 * keeps the filtering on the server where the rows are, survives a refresh, and
 * makes "here is my needs-a-reply queue" a URL somebody can paste into Slack.
 *
 * Server component: no state, no handlers. It renders inside `Rise` rather than
 * being made sticky — a sticky bar cannot live under the entrance's blur filter
 * (docs/app-design-system.md §Motion), and a queue this short does not need one.
 */

const SCOPE_LABEL: Record<InboxScope, string> = {
  mine: "Mine",
  team: "Team",
  all: "All",
};

const SCOPE_ORDER: readonly InboxScope[] = ["mine", "team", "all"];

function tabClass(isActive: boolean): string {
  return `inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
    isActive
      ? "bg-ink text-white"
      : "bg-paper text-dim hover:bg-paper-sunk hover:text-ink"
  }`;
}

function countClass(isActive: boolean): string {
  return `rounded-full px-1 font-mono text-[10px] tabular-nums ${
    isActive ? "bg-white/20 text-white" : "bg-black/[0.06] text-faint"
  }`;
}

/** Builds an inbox href, dropping params that are at their default. */
function inboxHref(scope: InboxScope, bucket: InboxQueueBucket | null): string {
  const params = new URLSearchParams();
  if (scope !== "mine") params.set("scope", scope);
  if (bucket) params.set("bucket", bucket);
  const query = params.toString();
  return query ? `/inbox?${query}` : "/inbox";
}

export function InboxScopeTabs({
  scope,
  bucket,
  scopeCounts,
  bucketCounts,
}: {
  scope: InboxScope;
  bucket: InboxQueueBucket | null;
  scopeCounts: Record<InboxScope, number>;
  bucketCounts: Record<InboxQueueBucket | "all", number>;
}) {
  return (
    <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <nav aria-label="Whose queue" className="flex flex-wrap items-center gap-1">
        {SCOPE_ORDER.map((option) => {
          const isActive = option === scope;
          return (
            <Link
              key={option}
              href={inboxHref(option, bucket)}
              aria-current={isActive ? "page" : undefined}
              className={tabClass(isActive)}
            >
              <span>{SCOPE_LABEL[option]}</span>
              <span className={countClass(isActive)}>{scopeCounts[option]}</span>
            </Link>
          );
        })}
      </nav>

      <nav aria-label="Queue filter" className="flex flex-wrap items-center gap-1">
        <Link
          href={inboxHref(scope, null)}
          aria-current={bucket === null ? "page" : undefined}
          className={tabClass(bucket === null)}
        >
          <span>Everything</span>
          <span className={countClass(bucket === null)}>{bucketCounts.all}</span>
        </Link>
        {INBOX_BUCKETS.map((option) => {
          const isActive = option === bucket;
          return (
            <Link
              key={option}
              href={inboxHref(scope, option)}
              aria-current={isActive ? "page" : undefined}
              className={tabClass(isActive)}
            >
              <span>{bucketLabel(option)}</span>
              <span className={countClass(isActive)}>{bucketCounts[option]}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
