import {
  describeSendStatus,
  type OutreachHistory as OutreachHistoryData,
} from "@/lib/outreach-history";

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * F070: a client's outreach history, split into what the client has actually
 * received (AC1) and what has not reached them yet (AC3). Each row is a native
 * `<details>`/`<summary>` disclosure rather than a client component with its
 * own open/close state — AC2's "can be opened to view the full content" needs
 * no more than that, and it works without shipping any JS for it.
 */
export function OutreachHistorySection({
  history,
  error,
}: {
  history: OutreachHistoryData;
  error: boolean;
}) {
  if (error) {
    return (
      <p className="mt-3 text-sm font-medium text-red-800" role="alert">
        Outreach history could not be loaded. Refresh and try again.
      </p>
    );
  }

  return (
    <div className="mt-3">
      <h3 className="text-xs font-bold uppercase tracking-wide text-foreground/60">
        Sent
      </h3>
      {history.sent.length === 0 ? (
        <p className="mt-2 text-sm text-foreground/65">
          No emails have been sent to this client yet.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-black/5">
          {history.sent.map((message) => (
            <li key={message.id}>
              <details className="py-2">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm">
                  <span className="font-medium">{message.subject}</span>
                  <span className="shrink-0 text-foreground/60">
                    {message.sent_at ? formatDate(message.sent_at) : ""}
                  </span>
                </summary>
                <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/80">
                  {message.body}
                </p>
              </details>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-6 text-xs font-bold uppercase tracking-wide text-foreground/60">
        Drafts &amp; scheduled
      </h3>
      {history.notSent.length === 0 ? (
        <p className="mt-2 text-sm text-foreground/65">Nothing waiting to be sent.</p>
      ) : (
        <ul className="mt-2 divide-y divide-black/5">
          {history.notSent.map((message) => (
            <li key={message.id}>
              <details className="py-2">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm">
                  <span className="font-medium">{message.subject}</span>
                  <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-xs font-bold text-foreground/70">
                    {describeSendStatus(message.send_status)}
                  </span>
                </summary>
                <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/80">
                  {message.body}
                </p>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
