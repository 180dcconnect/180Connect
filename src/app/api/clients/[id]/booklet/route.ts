import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { isUuid } from "@/lib/validation";
import { logApiHealth } from "@/lib/api-health-log";
import {
  createDefaultGenerateBookletDeps,
  generateBooklet,
} from "@/lib/booklet/generate-booklet";
import type {
  BookletEnrichmentInput,
  BookletOrganisationInput,
} from "@/lib/booklet/build-prompt";
import {
  createDefaultScrapeDependencies,
  fetchWebsiteContext,
} from "@/lib/booklet/scrape-website";

// F084 — Use Website URL in Booklet: an optional URL the CAM pastes in, separate
// from the stored organisation.website (which is always sent as a plain field
// regardless — see build-prompt.ts). Malformed/unreachable/unscrapable is never a
// 400 here — AC3 says generation still proceeds without it, so this is reported
// back to the CAM as a status, not a request-rejecting validation error.
const RequestBodySchema = z.object({
  websiteUrl: z.string().trim().max(2048).optional(),
});

type WebsiteContextResult =
  | { status: "not_provided" }
  | { status: "used"; hostname: string }
  | { status: "skipped"; reason: string };

/**
 * F082 — Generate Client Booklet, extended by F084 — Use Website URL in Booklet.
 * Every call generates fresh from Gemini (F085's saved-booklet read/write is
 * separate, #382). After a successful generation the exact prompt and output are
 * written to booklet_generations — F082 AC5 / F112's audit requirement. See
 * generate-booklet.ts for the Gemini call and scrape-website.ts for the optional
 * website-context fetch this route does first.
 *
 * client:contact, not client:view — this calls a paid external API on every click,
 * same reasoning as gating the Outreach section on the client detail page.
 *
 * generate-booklet.ts's own upstream timeout is 90s (PRD hard timeout for Client
 * Booklet generation). maxDuration must stay comfortably above that or the hosting
 * platform kills the request before the upstream timeout gets the chance to return
 * its own clear error — 120s here; confirm against the actual Vercel plan this
 * deploys to, since some tiers cap function duration below that regardless of what
 * this value asks for.
 */
export const maxDuration = 120;

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  const status = reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json({ error: actorFailureMessage(reason) }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authorization = await getCurrentActor("client:contact", { route: "/clients/[id]" });
  if (!authorization.ok) return denied(authorization.reason);

  const { id: organisationId } = await params;
  if (!isUuid(organisationId)) {
    return NextResponse.json({ error: "That client could not be found." }, { status: 400 });
  }

  // Body is optional (a plain click, no URL) — default to {} so an empty request
  // still parses cleanly against the all-optional schema instead of failing on `null`.
  const parsedBody = RequestBodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsedBody.success) {
    return NextResponse.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }
  const { websiteUrl } = parsedBody.data;

  const supabase = await createClient();

  const { data: organisation, error: organisationError } = await supabase
    .from("organisations")
    .select("legal_name, organisation_type, website, city, country_code")
    .eq("id", organisationId)
    .maybeSingle<BookletOrganisationInput>();

  if (organisationError) {
    await reportError(organisationError, {
      operation: "clients.generate_booklet.load_organisation",
      organisationId,
    });
    return NextResponse.json(
      { error: "The booklet could not be generated. Try again." },
      { status: 500 },
    );
  }
  if (!organisation) {
    return NextResponse.json({ error: "That client could not be found." }, { status: 404 });
  }

  // Same tolerant pattern as the client detail page: a missing/errored enrichment
  // row is not fatal, the prompt just shows those fields as not provided.
  const { data: enrichment, error: enrichmentError } = await supabase
    .from("enrichment_results")
    .select("mission_statement, mission_keywords, sector, sub_sector")
    .eq("organisation_id", organisationId)
    .order("enriched_at", { ascending: false })
    .limit(1)
    .maybeSingle<BookletEnrichmentInput>();

  if (enrichmentError) {
    await reportError(enrichmentError, {
      operation: "clients.generate_booklet.load_enrichment",
      organisationId,
    });
  }

  // F084: an optional CAM-pasted URL, scraped up front here (a route-level
  // concern, same as the two DB reads above) so generateBooklet's own job stays
  // limited to building the prompt and calling Gemini. fetchImportPage already
  // reports its own failures to ERROR_LOG, so only the API_HEALTH_LOGS entry is
  // recorded here.
  let websiteContext: { text: string; hostname: string } | null = null;
  let websiteContextResult: WebsiteContextResult = { status: "not_provided" };

  if (websiteUrl) {
    const scrapeStartedAt = Date.now();
    const scraped = await fetchWebsiteContext(websiteUrl, createDefaultScrapeDependencies());
    logApiHealth("website", "booklet.scrape_context", scraped.status === "used", scrapeStartedAt, {
      organisationId,
    });
    if (scraped.status === "used") {
      websiteContext = { text: scraped.text, hostname: scraped.hostname };
      websiteContextResult = { status: "used", hostname: scraped.hostname };
    } else {
      websiteContextResult = { status: "skipped", reason: scraped.reason };
    }
  }

  const result = await generateBooklet(
    { organisationId, organisation, enrichment: enrichment ?? null, websiteContext },
    createDefaultGenerateBookletDeps(),
  );

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  // F082 AC5 / F112 — the exact prompt and output are stored per generation
  // (booklet_generations). A failed audit insert does not fail the request:
  // the CAM just waited up to 90s and losing the booklet over an audit write
  // would trade a compliance nicety for a user-visible failure. It is reported
  // to ERROR_LOG so the gap is visible, not silent.
  const { error: auditError } = await supabase.from("booklet_generations").insert({
    organisation_id: organisationId,
    generated_by: authorization.actor.id,
    prompt_system: result.systemPrompt,
    prompt_user: result.userPrompt,
    output: result.booklet,
    model: result.model,
  });
  if (auditError) {
    await reportError(auditError, {
      operation: "clients.generate_booklet.audit_insert",
      organisationId,
    });
  }

  return NextResponse.json({ booklet: result.booklet, websiteContext: websiteContextResult });
}
