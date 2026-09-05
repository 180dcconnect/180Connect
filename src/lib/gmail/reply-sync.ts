import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logApiHealth } from "../api-health-log.ts";
import { reportError } from "../error-logging.ts";
import { createAdminClient } from "../supabase/admin.ts";
import { getGmailAccessToken, resolveGmailConfig, resolveGmailSender, type GmailConfig } from "./client.ts";
import { isPotentialCrmReply, matchInboundReply, parseInboundReply, type GmailInboundMessage, type SentThreadReference } from "./reply-message.ts";

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
};

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

export async function syncGmailReplies(deps?: Dependencies): Promise<ReplySyncResult> {
  const result: ReplySyncResult = { scanned: 0, captured: 0, duplicates: 0, ignored: 0, unmatched: 0, failed: 0 };
  const admin = deps?.admin ?? createAdminClient();
  const config = deps?.config ?? resolveGmailConfig();
  const sender = deps?.sender ?? resolveGmailSender();
  if (!admin || !config || !sender) throw new Error("Reply sync is not configured.");
  const fetchImpl = deps?.fetchImpl ?? fetch;

  try {
    const token = await (deps?.tokenProvider ? deps.tokenProvider() : getGmailAccessToken(config, fetchImpl));
    const listUrl = new URL(`${GMAIL_API}/messages`);
    const lookbackDays = deps?.lookbackDays ?? resolveGmailReplyLookbackDays();
    listUrl.searchParams.set("q", `in:inbox newer_than:${lookbackDays}d`);
    listUrl.searchParams.set("maxResults", String(MAX_MESSAGES));
    const listed = await gmailJson<{ messages?: { id: string }[] }>(listUrl.toString(), token, fetchImpl, "users.messages.list.replies");

    const { data: sentRows, error: sentError } = await admin
      .from("audit_log")
      .select("target_id, detail, created_at")
      .eq("action", "outreach_email_sent")
      .eq("target_table", "outreach_messages");
    if (sentError) throw sentError;
    const threads = (sentRows ?? []) as SentThreadReference[];

    for (const item of listed.messages ?? []) {
      result.scanned += 1;
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
        if (data === null) result.duplicates += 1;
        else result.captured += 1;
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
