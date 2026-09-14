import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logApiHealth } from "../api-health-log.ts";
import { reportError } from "../error-logging.ts";
import { createAdminClient } from "../supabase/admin.ts";
import { getGmailAccessToken, resolveGmailConfig, resolveGmailSender, type GmailConfig } from "./client.ts";
import { isPotentialCrmReply, matchInboundReply, parseInboundReply, type GmailInboundMessage, type SentThreadReference } from "./reply-message.ts";
import { sendNotificationEmail } from "../notification-email.ts";
import { wantsEmailNotification } from "../email-notification-preferences.ts";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const TIMEOUT_MS = 15_000;
const MAX_MESSAGES = 100;
const DEFAULT_LOOKBACK_DAYS = 2;

export function resolveGmailReplyLookbackDays(
  source: Record<string, string | undefined> = process.env,
): number {
  const configured = Number(source.GMAIL_REPLY_LOOKBACK_DAYS?.trim());
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_LOOKBACK_DAYS;
}

export type ReplySyncResult = {
  scanned: number;
  captured: number;
  duplicates: number;
  ignored: number;
  unmatched: number;
  failed: number;
};

type Dependencies = {
  admin: SupabaseClient;
  config: GmailConfig;
  sender: string;
  fetchImpl?: typeof fetch;
  tokenProvider?: () => Promise<string>;
  lookbackDays?: number;
  /** Test seam: where reply notification emails go. Defaults to the real transport. */
  sendNotification?: typeof sendNotificationEmail;
};

/**
 * F179 AC1/AC3 — the email half of "in addition to in-app". Runs after
 * capture_gmail_reply has already created the in-app notification (that
 * half is F174's notify_on_reply_event trigger on reply_events, merged at
 * 20260912170300 — this function adds no second in-app row, only the email
 * on top), and sends with the lower-level Gmail transport directly
 * (notification-email.ts), never sendBranchOutreach's approval-gated
 * outreach path — see that file's header for why that boundary matters.
 *
 * Owning CAM only, matching F179's user story: the client's current owner
 * gets the email when they are active and `client_reply_received` (F174's
 * owner token, the column default) is in their email_notification_types.
 * Unowned / inactive-owner replies fall to F174's admin fallback
 * notifications, which stay in-app only on this ticket.
 *
 * Best-effort by construction: any failure here (a lookup error, Gmail being
 * unavailable) is reported and swallowed. The reply is already captured and
 * the in-app notification already exists regardless of whether this email
 * goes out — a CAM never loses the underlying signal over an email hiccup.
 */
export async function notifyReplyOwnerByEmail(
  admin: SupabaseClient,
  organisationId: string,
  replyBody: string,
  send: typeof sendNotificationEmail = sendNotificationEmail,
): Promise<void> {
  try {
    const { data: org, error: orgError } = await admin
      .from("organisations")
      .select("owner_id, legal_name")
      .eq("id", organisationId)
      .maybeSingle<{ owner_id: string | null; legal_name: string }>();
    if (orgError) throw orgError;
    if (!org?.owner_id) return;

    const { data: owner, error: ownerError } = await admin
      .from("users")
      .select("email, is_active, email_notification_types")
      .eq("id", org.owner_id)
      .maybeSingle<{ email: string; is_active: boolean; email_notification_types: string[] | null }>();
    if (ownerError) throw ownerError;
    if (!owner?.is_active || !owner.email) return;
    if (!wantsEmailNotification(owner.email_notification_types, "client_reply_received")) return;

    const result = await send({
      to: owner.email,
      subject: `${org.legal_name || "A client"} replied`,
      text: replyBody.slice(0, 2000),
    });
    if (!result.ok) {
      await reportError(new Error(result.reason), {
        operation: "gmail.reply_sync.notify_email",
        organisationId,
      });
    }
  } catch (error) {
    await reportError(error, { operation: "gmail.reply_sync.notify_email", organisationId });
  }
}

async function gmailJson<T>(url: string, token: string, fetchImpl: typeof fetch, operation: string): Promise<T> {
  const startedAt = Date.now();
  let healthLogged = false;
  try {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    logApiHealth("gmail", operation, response.ok, startedAt, { status: response.status });
    healthLogged = true;
    if (!response.ok) throw new Error(`Gmail ${operation} failed (${response.status}).`);
    return await response.json() as T;
  } catch (error) {
    if (!healthLogged) logApiHealth("gmail", operation, false, startedAt);
    throw error;
  }
}

/**
 * Ids from `ids` that capture_gmail_reply has already recorded. Re-fetching a
 * captured message in full on every run was most of what a run cost — the
 * lookback re-lists the same two days each time. Deliberately NOT skipped:
 * messages only flagged for review (gmail_reply_needs_review), since a later
 * run with a fresher sent-outreach snapshot is what resolves those.
 *
 * Best-effort: if the lookup fails, nothing is skipped and the RPC's own
 * dedupe keeps the run correct, just slower.
 */
async function alreadyCaptured(admin: SupabaseClient, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await admin
    .from("audit_log")
    .select("detail")
    .eq("action", "gmail_reply_captured")
    .in("detail->>provider_message_id", ids);
  if (error) {
    await reportError(error, { operation: "gmail.reply_sync.skip_captured" });
    return new Set();
  }
  return new Set(
    ((data ?? []) as { detail: { provider_message_id?: unknown } | null }[])
      .map((row) => row.detail?.provider_message_id)
      .filter((value): value is string => typeof value === "string"),
  );
}

export type ReplySyncOptions = {
  /**
   * Push-triggered runs (src/app/api/webhooks/gmail) look only at the last few
   * minutes of inbox instead of the full day lookback. Absent = the poll's
   * GMAIL_REPLY_LOOKBACK_DAYS window.
   */
  sinceMinutes?: number;
};

export async function syncGmailReplies(deps?: Dependencies, options: ReplySyncOptions = {}): Promise<ReplySyncResult> {
  const result: ReplySyncResult = { scanned: 0, captured: 0, duplicates: 0, ignored: 0, unmatched: 0, failed: 0 };
  const admin = deps?.admin ?? createAdminClient();
  const config = deps?.config ?? resolveGmailConfig();
  const sender = deps?.sender ?? resolveGmailSender();
  if (!admin || !config || !sender) throw new Error("Reply sync is not configured.");
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const sendNotification = deps?.sendNotification ?? sendNotificationEmail;

  try {
    const token = await (deps?.tokenProvider ? deps.tokenProvider() : getGmailAccessToken(config, fetchImpl));
    const listUrl = new URL(`${GMAIL_API}/messages`);
    if (options.sinceMinutes && options.sinceMinutes > 0) {
      // Gmail's `after:` accepts epoch seconds, which is what makes a
      // minutes-wide window possible (newer_than: only goes down to hours).
      const after = Math.floor((Date.now() - options.sinceMinutes * 60_000) / 1000);
      listUrl.searchParams.set("q", `in:inbox after:${after}`);
    } else {
      const lookbackDays = deps?.lookbackDays ?? resolveGmailReplyLookbackDays();
      listUrl.searchParams.set("q", `in:inbox newer_than:${lookbackDays}d`);
    }
    listUrl.searchParams.set("maxResults", String(MAX_MESSAGES));
    const listed = await gmailJson<{ messages?: { id: string }[] }>(listUrl.toString(), token, fetchImpl, "users.messages.list.replies");

    const { data: sentRows, error: sentError } = await admin
      .from("audit_log")
      .select("target_id, detail, created_at")
      .eq("action", "outreach_email_sent")
      .eq("target_table", "outreach_messages");
    if (sentError) throw sentError;
    const threads = (sentRows ?? []) as SentThreadReference[];

    const listedMessages = listed.messages ?? [];
    const captured = await alreadyCaptured(admin, listedMessages.map((item) => item.id));

    for (const item of listedMessages) {
      result.scanned += 1;
      if (captured.has(item.id)) {
        result.duplicates += 1;
        continue;
      }
      try {
        const message = await gmailJson<GmailInboundMessage>(
          `${GMAIL_API}/messages/${encodeURIComponent(item.id)}?format=full`,
          token,
          fetchImpl,
          "users.messages.get.reply",
        );
        const reply = parseInboundReply(message);
        if (!reply) { result.ignored += 1; continue; }
        if (!isPotentialCrmReply(reply, threads, sender)) {
          result.ignored += 1;
          continue;
        }
        const match = matchInboundReply(reply, threads, sender);
        if (!match || typeof match.detail.organisation_id !== "string") {
          const { data, error } = await admin.rpc("flag_unmatched_gmail_reply", {
            p_provider_message_id: reply.providerMessageId,
            p_provider_thread_id: reply.providerThreadId,
            p_sender_email: reply.from,
            p_subject: reply.subject,
            p_reply_body: reply.body,
            p_received_at: reply.receivedAt,
          });
          if (error) throw error;
          if (data === null) result.duplicates += 1;
          else result.unmatched += 1;
          continue;
        }
        const { data, error } = await admin.rpc("capture_gmail_reply", {
          p_provider_message_id: reply.providerMessageId,
          p_outreach_message_id: match.target_id,
          p_organisation_id: match.detail.organisation_id,
          p_reply_body: reply.body,
          p_received_at: reply.receivedAt,
          p_sender_email: reply.from,
        });
        if (error) throw error;
        if (data === null) {
          result.duplicates += 1;
        } else {
          result.captured += 1;
          // F179: best-effort, never allowed to affect the capture count
          // above or fail this message — see notifyReplyOwnerByEmail's own
          // try/catch.
          await notifyReplyOwnerByEmail(admin, match.detail.organisation_id, reply.body, sendNotification);
        }
      } catch (error) {
        result.failed += 1;
        await reportError(error, { operation: "gmail.reply_sync.message", providerMessageId: item.id });
      }
    }
    return result;
  } catch (error) {
    await reportError(error, { operation: "gmail.reply_sync.run" });
    throw error;
  }
}
