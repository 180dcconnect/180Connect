import { NextResponse } from "next/server";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";

/**
 * F485 (#485) — @mention autocomplete directory. Active users with a display
 * name, oldest contract first: the composer offers people, not freehand
 * names, so a mention always resolves to exactly one user.
 *
 * Read-scoped, not write-scoped (`client:view`): the saved-note renderer
 * highlights `@Name` tokens for every role that can read the client
 * (viewers included — notes are shared-read), and it needs the same
 * directory to do it. No email addresses, no inactive accounts — a
 * deactivated user is never offered and therefore never notified.
 */

type CandidateRow = { id: string; full_name: string | null };

export async function GET() {
  const authorization = await getCurrentActor("client:view", {
    route: "/api/users/mention-candidates",
  });
  if (!authorization.ok) {
    const status = authorization.reason === "unauthenticated" ? 401 : 403;
    return NextResponse.json({ error: actorFailureMessage(authorization.reason) }, { status });
  }

  const supabase = await createClient();
  // No LIMIT: this is id + display name over the team table (tens of rows),
  // and a cap would silently unmentionable-ise everyone past it —
  // unselectable in both composers and unhighlighted in saved notes.
  const { data, error } = await supabase
    .from("users")
    .select("id, full_name")
    .eq("is_active", true)
    .not("full_name", "is", null)
    .order("full_name", { ascending: true })
    .returns<CandidateRow[]>();

  if (error) {
    await reportError(error, { operation: "users.mention_candidates" });
    return NextResponse.json({ error: "Team members could not be loaded." }, { status: 500 });
  }

  return NextResponse.json({
    users: (data ?? [])
      .filter((row) => row.full_name?.trim())
      .map((row) => ({ id: row.id, fullName: (row.full_name as string).trim() })),
  });
}
