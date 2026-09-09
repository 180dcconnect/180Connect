import { NextResponse } from "next/server";
import { z } from "zod";

import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { createClient } from "@/lib/supabase/server";
import {
  buildRealInboxThreads,
  contactName,
  hydrateInboxThread,
  type InboxContactRow,
  type InboxOrganisationRow,
  type InboxPendingRow,
} from "@/lib/inbox/real-threads";
import type { InboxMessageRow, InboxReplyRow } from "@/lib/outreach-inbox";

/** A thread is one organisation's whole outreach history, so the cap is on
    messages per client rather than per page — the same 500 the old thread page
    used, which no real client has ever come close to. */
const MESSAGE_LIMIT = 500;

/**
 * One thread's message bodies, fetched when the reading pane opens it.
 *
 * `/inbox` deliberately builds its list without selecting
 * `outreach_messages.body`: rendering subjects and one-line snippets does not
 * need email HTML, and pulling every body for every organisation would move
 * megabytes on every page load. This route is the other half of that trade —
 * bodies arrive for exactly the one thread somebody is reading.
 *
 * Read-only. Same `client:view` gate the inbox list holds, and RLS on
 * outreach_messages/reply_events is still the backstop underneath it.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const authorization = await getCurrentActor("client:view", {
    route: "/api/inbox/[orgId]/thread",
  });
  if (!authorization.ok) {
    return NextResponse.json(
      { error: actorFailureMessage(authorization.reason) },
      { status: authorization.reason === "unauthenticated" ? 401 : 403 },
    );
  }

  const { orgId } = await params;
  // Design-fill threads are keyed by a prefix, not a UUID, and arrive with
  // their conversation already attached — a request for one is a bug upstream,
  // not something to answer with an empty thread.
  if (!z.uuid().safeParse(orgId).success) {
    return NextResponse.json({ error: "That thread could not be found." }, { status: 404 });
  }

  const supabase = await createClient();

  const [messageResult, replyResult, orgResult, contactResult] = await Promise.all([
    supabase
      .from("outreach_messages")
      .select(
        "id, subject, body, send_status, sent_at, scheduled_at, updated_at, created_at, organisation_id, sender:users!outreach_messages_sent_by_user_id_fkey(full_name)",
      )
      .eq("organisation_id", orgId)
      .order("sent_at", { ascending: false })
      .limit(MESSAGE_LIMIT),
    supabase
      .from("reply_events")
      .select("id, reply_body, received_at, organisation_id, intent, contact_id")
      .eq("organisation_id", orgId)
      .order("received_at", { ascending: false })
      .limit(MESSAGE_LIMIT),
    supabase
      .from("organisations")
      .select(
        "id, legal_name, organisation_type, city, country_code, contact_email, sector, sub_sector, owner:users!organisations_owner_id_fkey(full_name, email)",
      )
      .eq("id", orgId)
      .maybeSingle<InboxOrganisationRow>(),
    supabase
      .from("contacts")
      .select("id, organisation_id, first_name, last_name, email, job_title, phone, is_primary")
      .eq("organisation_id", orgId),
  ]);

  for (const [operation, result] of [
    ["inbox.thread.messages", messageResult],
    ["inbox.thread.replies", replyResult],
    ["inbox.thread.organisation", orgResult],
    ["inbox.thread.contacts", contactResult],
  ] as const) {
    if (result.error) {
      await reportError(result.error, { operation, organisationId: orgId });
      return NextResponse.json(
        { error: "That thread could not be loaded. Try again." },
        { status: 503 },
      );
    }
  }

  const organisation = orgResult.data;
  if (!organisation) {
    return NextResponse.json({ error: "That thread could not be found." }, { status: 404 });
  }

  const rows = (messageResult.data ?? []) as unknown as (InboxMessageRow & {
    body?: string | null;
    scheduled_at?: string | null;
    updated_at?: string | null;
    created_at?: string | null;
  })[];
  const replies = (replyResult.data ?? []) as unknown as InboxReplyRow[];
  const contacts = (contactResult.data ?? []) as InboxContactRow[];

  const pending: InboxPendingRow[] = rows
    .filter((row) => row.send_status === "draft" || row.send_status === "scheduled")
    .map((row) => ({
      id: row.id,
      organisation_id: row.organisation_id,
      subject: row.subject,
      send_status: row.send_status as "draft" | "scheduled",
      scheduled_at: row.scheduled_at ?? null,
      updated_at: row.updated_at ?? null,
      created_at: row.created_at ?? null,
    }));

  // Rebuilt rather than trusted from the client: the browser's copy of the row
  // is only a render, and the sender/owner/contact facts the messages are
  // attributed to must come from the database on this request.
  const [thread] = buildRealInboxThreads({
    messages: rows,
    replies,
    pending,
    organisations: [organisation],
    contacts,
  });
  if (!thread) {
    return NextResponse.json({ error: "That thread could not be found." }, { status: 404 });
  }

  const contactNames = new Map(
    contacts
      .map((row) => [row.id, contactName(row)] as const)
      .filter(([, name]) => name.length > 0),
  );

  return NextResponse.json(hydrateInboxThread(thread, rows, replies, contactNames));
}
