import {
  describeSendStatus,
  type OutreachHistory as OutreachHistoryData,
} from "@/lib/outreach-history";
import { isRichEmailHtml, sanitizeEmailHtml } from "@/lib/outreach/email-html";

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * F117: a row's body is either legacy plain text (sent before this feature)
 * or HTML from the rich-text editor — `isRichEmailHtml` tells them apart so
 * both keep rendering correctly with no data migration. The HTML branch
 * re-sanitizes on every render rather than trusting what was stored, so a
 * write path that ever skipped sanitizing still can't reach
 * `dangerouslySetInnerHTML` unsanitized.
 */
function EmailBodyPreview({ body }: { body: string }) {
  if (isRichEmailHtml(body)) {
    return (
      <div
        className="mt-2 text-sm text-foreground/80 [&_a]:text-brand [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-black/15 [&_blockquote]:pl-3 [&_blockquote]:text-foreground/70 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-5"
        dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(body) }}
      />
    );
  }
  return <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/80">{body}</p>;
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
                <EmailBodyPreview body={message.body} />
                {/* F125: the exact final content plus who delivered it — sent
                    rows are immutable history, so attribution is fixed at send
                    time and falls back for senders since removed from users. */}
                <p className="mt-2 text-xs text-foreground/55">
                  Sent by{" "}
                  {message.sender?.full_name?.trim() || "a former team member"}
                  {message.sent_at ? ` on ${formatDate(message.sent_at)}` : ""}
                </p>
              </details>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-6 text-xs font-bold uppercase tracking-wide text-foreground/60">
        Not sent
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
                  {/* AC2's "send date", for something that has not gone out
                      yet: a scheduled row shows when it is due, so a CAM can
                      tell two hours from two weeks. Drafts and failures have
                      no due date — the badge carries the state instead. */}
                  <span className="flex shrink-0 items-center gap-2">
                    {message.scheduled_at && (
                      <span className="text-foreground/60">
                        Due {formatDate(message.scheduled_at)}
                      </span>
                    )}
                    <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-bold text-foreground/70">
                      {describeSendStatus(message.send_status)}
                    </span>
                  </span>
                </summary>
                <EmailBodyPreview body={message.body} />
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
