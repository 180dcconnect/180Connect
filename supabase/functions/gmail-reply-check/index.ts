/**
 * gmail-reply-check — the cheap, frequent half of reply sync.
 *
 * pg_cron calls this every 30 seconds (gmail_reply_check). It asks Gmail for
 * the last couple of minutes of inbox, drops ids the app has already recorded,
 * and only if something is left calls the Vercel reply sync, which does the
 * real parsing, matching and capture. Almost every tick ends after one Gmail
 * list and one indexed-size audit_log read, without touching Vercel — that is
 * the point: Vercel Hobby's CPU allowance cannot absorb a 30-second poll, and
 * Supabase's Edge Function allowance is separate. Why not Gmail push: it needs
 * Pub/Sub IAM grants in a Google Cloud project we do not administer.
 *
 * Secrets (supabase secrets set): GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET,
 * GMAIL_REFRESH_TOKEN, CRON_SECRET. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 * are provided by the platform. The Vercel base URL and protection bypass
 * arrive in the request body from pg_cron's vault. Setup:
 * docs/gmail-reply-check.md.
 */
import {
  inboxQuery,
  knownIdsUrl,
  syncUrl,
  tokenCacheFrom,
  unseenIds,
  usableToken,
  type TokenCache,
} from "./logic.ts";

const GMAIL_LIST = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const TIMEOUT_MS = 10_000;

// Module scope survives between invocations while the worker stays warm, so a
// warm worker refreshes the Gmail token about once an hour, not every tick.
let tokenCache: TokenCache = null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function accessToken(): Promise<string> {
  const cached = usableToken(tokenCache, Date.now());
  if (cached) return cached;
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GMAIL_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("GMAIL_CLIENT_SECRET") ?? "",
      refresh_token: Deno.env.get("GMAIL_REFRESH_TOKEN") ?? "",
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await response.json().catch(() => ({}));
  tokenCache = response.ok ? tokenCacheFrom(body, Date.now()) : null;
  if (!tokenCache) throw new Error(`Gmail OAuth refresh failed (${response.status}).`);
  return tokenCache.token;
}

async function knownIds(ids: string[]): Promise<string[] | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return null;
  const response = await fetch(knownIdsUrl(supabaseUrl, ids), {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const rows = (await response.json()) as { provider_message_id?: unknown }[];
  return rows.map((row) => row.provider_message_id).filter((id): id is string => typeof id === "string");
}

Deno.serve(async (request) => {
  const secret = Deno.env.get("CRON_SECRET")?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return json({ error: "Unauthorised." }, 401);
  }

  const input = (await request.json().catch(() => ({}))) as { appBaseUrl?: unknown; vercelProtectionBypass?: unknown };
  const target = syncUrl(input.appBaseUrl, input.vercelProtectionBypass);
  if (!target) return json({ error: "appBaseUrl missing or not https." }, 400);

  try {
    const listUrl = new URL(GMAIL_LIST);
    listUrl.searchParams.set("q", inboxQuery(Date.now()));
    listUrl.searchParams.set("maxResults", "50");
    const listed = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${await accessToken()}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (listed.status === 401) tokenCache = null;
    if (!listed.ok) return json({ error: `Gmail list failed (${listed.status}).` }, 502);

    const ids = (((await listed.json()) as { messages?: { id: string }[] }).messages ?? []).map((m) => m.id);
    if (ids.length === 0) return json({ listed: 0, new: 0 });

    // A failed lookup triggers the sync anyway: capture is idempotent, so the
    // cost of guessing wrong is one extra Vercel run, never a missed reply.
    const known = await knownIds(ids);
    const fresh = known ? unseenIds(ids, known) : ids;
    if (fresh.length === 0) return json({ listed: ids.length, new: 0 });

    const synced = await fetch(target, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(25_000),
    });
    return json({ listed: ids.length, new: fresh.length, syncStatus: synced.status }, synced.ok ? 200 : 502);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Reply check failed." }, 502);
  }
});
