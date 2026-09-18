import { NextResponse } from "next/server";

import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { INBOX_CONTACT_SELECT, INBOX_ORG_SELECT } from "@/lib/inbox/inbox-selects";
import {
  buildAddressableClients,
  type InboxContactRow,
  type InboxOrganisationRow,
} from "@/lib/inbox/real-threads";
import { fetchPaged } from "@/lib/supabase/fetch-paged";
import { createClient } from "@/lib/supabase/server";

/**
 * Every client Compose may address — the recipient directory — fetched when a
 * compose window first opens.
 *
 * /inbox used to read every organisation and every contact on each load, and
 * again on every realtime refresh, to build this list up front. The mailbox
 * itself only needs the organisations that have outreach on them; the full
 * directory (thousands of clients) is only needed once somebody starts writing.
 * So the page now reads the small set, and this route is the other half of the
 * trade: the whole directory, once per compose session.
 *
 * Read-only. Same `client:view` gate the inbox list holds, and RLS on
 * organisations/contacts is still the backstop underneath it.
 */
export async function GET() {
  const authorization = await getCurrentActor("client:view", {
    route: "/api/inbox/directory",
  });
  if (!authorization.ok) {
    return NextResponse.json(
      { error: actorFailureMessage(authorization.reason) },
      { status: authorization.reason === "unauthenticated" ? 401 : 403 },
    );
  }

  const supabase = await createClient();

  const [orgResult, contactResult] = await Promise.all([
    fetchPaged<InboxOrganisationRow>(
      (from, to) =>
        supabase
          .from("organisations")
          .select(INBOX_ORG_SELECT)
          // Real data only — seed/demo rows are never recipients a CAM can
          // search for (see buildAddressableClients).
          .eq("is_seed", false)
          .order("id", { ascending: true })
          .range(from, to)
          .overrideTypes<InboxOrganisationRow[], { merge: false }>(),
      { pagesPerRound: 3 },
    ),
    fetchPaged<InboxContactRow>((from, to) =>
      supabase
        .from("contacts")
        .select(INBOX_CONTACT_SELECT)
        .order("id", { ascending: true })
        .range(from, to)
        .overrideTypes<InboxContactRow[], { merge: false }>(),
    ),
  ]);

  for (const [operation, result] of [
    ["inbox.directory.organisations", orgResult],
    ["inbox.directory.contacts", contactResult],
  ] as const) {
    if (result.error) {
      await reportError(result.error, { operation });
      return NextResponse.json(
        { error: "The client list could not be loaded. Close this window and try again." },
        { status: 503 },
      );
    }
  }

  const clients = buildAddressableClients({
    organisations: orgResult.data ?? [],
    contacts: contactResult.data ?? [],
  });

  return NextResponse.json(
    { clients },
    // Per-user data (RLS-scoped), so never shared; never cached either, so a
    // client added a moment ago is findable the next time Compose opens.
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
