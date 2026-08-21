import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import {
  createDefaultGenerateBookletDeps,
  generateBooklet,
  type GenerateBookletDeps,
} from "@/lib/booklet/generate-booklet";
import type {
  BookletEnrichmentInput,
  BookletOrganisationInput,
} from "@/lib/booklet/build-prompt";

/**
 * F082 — Generate Client Booklet. Generate-and-display only this pass: F085 (save to
 * the client record) and F112 (store prompt/output for audit) are both deferred, so
 * every call here re-generates from Gemini fresh rather than reading/writing a saved
 * booklet. See generate-booklet.ts for the Gemini call itself.
 *
 * client:contact, not client:view — this calls a paid external API on every click,
 * same reasoning as gating the Outreach section on the client detail page.
 *
 * Vercel's default function timeout can be shorter than generate-booklet.ts's own
 * 30s upstream timeout on some hosting tiers — raise this if a real generation gets
 * cut off before the upstream timeout has a chance to return its own clear error.
 */
export const maxDuration = 60;

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  const status = reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json({ error: actorFailureMessage(reason) }, { status });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authorization = await getCurrentActor("client:contact", { route: "/clients/[id]" });
  if (!authorization.ok) return denied(authorization.reason);

  const { id: organisationId } = await params;
  if (!z.uuid().safeParse(organisationId).success) {
    return NextResponse.json({ error: "That client could not be found." }, { status: 400 });
  }

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

  // createDefaultGenerateBookletDeps throws synchronously when the Gemini env
  // vars are missing — catch it here so the route answers with a clear 503
  // instead of the error escaping unhandled (same pattern as the stage-one
  // outreach route).
  let deps: GenerateBookletDeps;
  try {
    deps = createDefaultGenerateBookletDeps();
  } catch (error) {
    await reportError(error, {
      operation: "clients.generate_booklet.configure",
      organisationId,
    });
    return NextResponse.json(
      { error: "Booklet generation is not configured. Contact an administrator." },
      { status: 503 },
    );
  }

  const result = await generateBooklet(
    { organisationId, organisation, enrichment: enrichment ?? null },
    deps,
  );

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({ booklet: result.booklet });
}
