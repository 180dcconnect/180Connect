import { NextResponse } from "next/server";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { FLYER_CONTENT_TYPE, FLYER_FILENAME, readFlyer } from "@/lib/outreach/flyer.ts";

/**
 * Serves the branch flyer PDF for in-app preview (the compose window's
 * attachment card links here). `client:contact`: seeing the flyer is part of
 * sending outreach, not of browsing records.
 *
 * The flyer ships with the code (see lib/outreach/flyer.ts) and is stapled
 * onto the MIME at send time — it has no Storage URL, so preview needs a
 * route that streams the repo asset. Inline disposition: browsers render it
 * in a tab rather than downloading it. Fixed path, no parameters, so there
 * is no traversal surface; a missing asset is a 500 with an error log, never
 * a stack trace to the caller.
 */
export async function GET() {
  const authorization = await getCurrentActor("client:contact", {
    route: "/api/outreach-flyer",
  });
  if (!authorization.ok) {
    const status = authorization.reason === "unauthenticated" ? 401 : 403;
    return NextResponse.json({ error: actorFailureMessage(authorization.reason) }, { status });
  }

  let content: Buffer;
  try {
    content = await readFlyer();
  } catch (error) {
    await reportError(error, {
      operation: "outreach.flyer_preview",
      actorUserId: authorization.actor.id,
    });
    return NextResponse.json({ error: "The flyer could not be loaded." }, { status: 500 });
  }

  return new NextResponse(new Uint8Array(content), {
    headers: {
      "Content-Type": FLYER_CONTENT_TYPE,
      "Content-Disposition": `inline; filename="${FLYER_FILENAME}"`,
      "Content-Length": String(content.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
