import { ExternalLink, Globe, Mail } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { hasPermission } from "@/lib/auth/permissions";
import { validateClientEmail } from "@/lib/client-email-validation";
import { websiteHref } from "@/lib/website-validation";
import {
  EDIT_SUGGESTION_SELECT,
  type EditSuggestionRow,
  restrictedFieldLabel,
} from "@/lib/edit-suggestions";
import { Group, Rise, Stage } from "@/components/dashboard-stage";

import { BasicInfoPanel } from "./basic-info-panel";
import { OperatingAreasCard } from "./operating-areas-card";
import { ScoreBreakdownCard } from "./score-breakdown";
import { Pill, SectionCard } from "./section-card";
import { FinancialScaleCard } from "./financial-scale-card";
import { SuggestEditSection } from "./suggest-edit-section";
import { TagsCard } from "./tags-card";
import { SourcesCard } from "./sources-card";
import { loadOperatingGeography } from "@/lib/operating-geography";
import {
  loadClient,
  loadFieldHistory,
  loadIdentifiers,
  loadLatestFinancial,
  loadScore,
  loadSources,
  loadWebsite,
  requireActor,
} from "./load-record";

type EnrichmentRow = { mission_statement: string | null; enriched_at: string };

/**
 * F067 (#69) Client Detail Page / F068 (#70) View Client Basic Info — the
 * **Overview** tab, and the record's default route.
 *
 * This is what is left of the old single-page client record after the split:
 * who this client is, why it ranks where it does, whether we can actually reach
 * it, where the data came from, and how it is tagged. Grants and filings moved
 * to `financials/`, everything outreach to `outreach/`, and notes, files and the
 * timeline to `activity/`. Ownership, pipeline status and do-not-contact are
 * controls in the shared header (`record-header.tsx`) rather than cards.
 *
 * Identity, score and website reachability come from the `cache()`d loaders in
 * `load-record.ts`, so this tab and the header above it share one round trip for
 * each rather than repeating them.
 *
 * Every query below is independent: a failure is reported and degrades that one
 * card, never the tab.
 */
export default async function ClientOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireActor();
  const client = await loadClient(id);
  const supabase = await createClient();

  const canEdit = hasPermission(actor.role, "client:edit");
  const isViewer = actor.role === "viewer";

  const [
    { score, error: scoreError },
    website,
    latestFinancial,
    sourcesResult,
    fieldHistory,
    enrichmentResult,
    clientTagsResult,
    allTagsResult,
    identifiers,
  ] = await Promise.all([
      loadScore(id),
      loadWebsite(client.website),
      loadLatestFinancial(id),
      // cache()d, so the header's provenance line and this card's list are one
      // round trip between them.
      loadSources(id),
      // cache()d with loadFieldHistory: shared with the Activity tab if this
      // session visits it. Here only the Manual Input answer is consumed.
      loadFieldHistory(id),
      // ENRICHMENT_RESULTS is append-only, so the most recently enriched row is
      // "the" mission statement, not the only one.
      supabase
        .from("enrichment_results")
        .select("mission_statement, enriched_at")
        .eq("organisation_id", id)
        .order("enriched_at", { ascending: false })
        .limit(1)
        .maybeSingle<EnrichmentRow>(),
      // F191/F192/F193: this client's assigned tags, and the full list for the
      // assign dropdown.
      supabase.from("org_tags").select("tag_id, tags(name, colour)").eq("organisation_id", id),
      supabase.from("tags").select("id, name, colour").order("name"),
      loadIdentifiers(id),
    ]);

  for (const [operation, error] of [
    ["clients.detail_enrichment", enrichmentResult.error],
    ["clients.detail_tags", clientTagsResult.error],
    ["clients.detail_all_tags", allTagsResult.error],
  ] as const) {
    if (error) await reportError(error, { operation, organisationId: id });
  }

  const { sources, error: sourcesError } = sourcesResult;
  const operatingGeography = loadOperatingGeography(
    client,
    identifiers,
    sources,
  );
  const enrichment = enrichmentResult.data;
  const clientTags = (clientTagsResult.data ?? [])
    .filter((row) => row.tags)
    .map((row) => ({
      id: row.tag_id,
      name: (row.tags as unknown as { name: string }).name,
      colour: (row.tags as unknown as { colour: string | null }).colour ?? null,
    }));

  // Never `href={website.url}`: on the invalid branch that field is the raw
  // stored text, and a browser resolves a scheme-less string as a path — the
  // "link" to `1-1coco.org` navigated to /clients/1-1coco.org.
  const websiteLink = websiteHref(website);
  const email = validateClientEmail(client.contact_email);
  // A redacted address is neither on file nor malformed, so it gets its own line
  // and its own pill. "Invalid" in red described a broken import that never
  // happened — the register published a personal address and the pipeline did
  // exactly what it is supposed to do with one.
  const emailDisplay =
    email.status === "redacted"
      ? "Removed — personal address"
      : (email.value ?? "Not on file");
  const emailPillLabel =
    email.status === "valid"
      ? "Valid"
      : email.status === "invalid"
        ? "Invalid"
        : email.status === "redacted"
          ? "Redacted"
          : "Missing";

  // #79/#80/#81 (F077/F078/F079): fetched without a status filter and filtered
  // in the component — RLS already scopes what each role may see. Viewers have
  // no write access at all, so the section is not rendered for them.
  let suggestions: EditSuggestionRow[] = [];
  if (!isViewer) {
    const { data, error } = await supabase
      .from("edit_suggestions")
      .select(EDIT_SUGGESTION_SELECT)
      .eq("organisation_id", id)
      .order("created_at", { ascending: false });
    if (error) {
      await reportError(error, {
        operation: "clients.detail_edit_suggestions",
        organisationId: id,
      });
    }
    suggestions = (data ?? []) as unknown as EditSuggestionRow[];
  }

  // #23 (F020): the restricted fields are configuration, not a compile-time
  // list — the proposal form offers exactly what RESTRICTED_EDIT_FIELDS says is
  // active. Current values come off the client row already in scope, so
  // "current vs proposed" reads in one glance.
  let restrictedFields: { field_name: string; label: string }[] = [];
  if (actor.role === "cam" || actor.role === "admin") {
    const { data, error } = await supabase
      .from("restricted_edit_fields")
      .select("field_name")
      .eq("active", true)
      .order("field_name");
    if (error) {
      await reportError(error, {
        operation: "clients.detail_restricted_fields",
        organisationId: id,
      });
    }
    restrictedFields = (data ?? []).map((row) => ({
      field_name: row.field_name,
      label: restrictedFieldLabel(row.field_name),
    }));

    if (!restrictedFields.some((f) => f.field_name === "mission_statement")) {
      restrictedFields.unshift({
        field_name: "mission_statement",
        label: "Mission",
      });
    }
  }


  return (
    <Stage>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Group className="space-y-6">
          <Rise className="relative z-20">
            <BasicInfoPanel
              organisation={client}
              missionStatement={enrichment?.mission_statement ?? null}
              missionEnrichedAt={enrichment?.enriched_at ?? null}
              editableFields={restrictedFields.map((field) => field.field_name)}
              actorId={actor.id}
              actorRole={actor.role}
              suggestions={suggestions}
            />
          </Rise>

          <Rise>
            <OperatingAreasCard geography={operatingGeography} />
          </Rise>

          {/* Proposing is a control on the card above ("Suggest an edit");
              this is only the state — pending and decided corrections. Renders
              nothing when there are none. CAMs see their own; admins decide. */}
          {!isViewer && (
            <SuggestEditSection
              actorId={actor.id}
              actorRole={actor.role}
              suggestions={suggestions}
            />
          )}

          <Rise>
            <FinancialScaleCard
              financial={latestFinancial}
              organisationId={client.id}
            />
          </Rise>

          {/* Email and website were two near-identical cards — same
              heading-plus-validity-pill shape, same failure copy — so they read
              as one "can we actually reach them?" card instead. */}
          <Rise>
            <SectionCard
              headingId="contactability-heading"
              title="Contactability"
            >
              <div className="mt-3.5 flex flex-col">
                <div className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 py-3">
                  <Mail aria-hidden="true" className="mt-0.5 size-4 text-faint" />
                  <div className="min-w-0">
                    <p className="text-[12.5px] text-dim">Email</p>
                    <p
                      className={`mt-0.5 text-sm leading-[1.55] break-words ${
                        email.status === "invalid"
                          ? "font-semibold text-stop"
                          : email.status === "valid"
                            ? "text-ink"
                            : "text-faint"
                      }`}
                    >
                      {emailDisplay}
                    </p>
                    {email.message && (
                      <p
                        className={`mt-1 text-[12.5px] leading-[1.5] ${
                          email.status === "redacted" ? "text-dim" : "text-stop"
                        }`}
                        role="alert"
                      >
                        {email.message} 
                      </p>
                    )}
                  </div>
                  {/* `hold`, not `stop`: outreach is blocked either way, but this
                      one is the policy working rather than the data being wrong. */}
                  <Pill
                    tone={
                      email.status === "valid"
                        ? "go"
                        : email.status === "redacted"
                          ? "hold"
                          : "stop"
                    }
                  >
                    {emailPillLabel}
                  </Pill>
                </div>

                <div className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border-t border-rule-soft py-3">
                  <Globe aria-hidden="true" className="mt-0.5 size-4 text-faint" />
                  <div className="min-w-0">
                    <p className="text-[12.5px] text-dim">Website</p>
                    <p className="mt-0.5 text-sm leading-[1.55]">
                      {websiteLink ? (
                        <a
                          className={`group inline-flex items-center gap-1.5 break-all border-b transition-colors ${
                            website.status === "reachable"
                              ? "border-lead-wash text-lead hover:border-lead"
                              : "border-stop/30 font-semibold text-stop"
                          }`}
                          href={websiteLink}
                          rel="noreferrer"
                          target="_blank"
                          title="Opens in a new tab"
                        >
                          <span className="break-all">{websiteLink}</span>
                          <ExternalLink
                            aria-hidden="true"
                            className="size-3 shrink-0 opacity-60 transition-opacity group-hover:opacity-100"
                          />
                        </a>
                      ) : website.url ? (
                        // Malformed: show what is stored, as text. There is
                        // nowhere safe to send anyone.
                        <span className="font-semibold break-all text-stop">{website.url}</span>
                      ) : (
                        <span className="text-faint">Not on file</span>
                      )}
                    </p>
                    {website.message && (
                      <p className="mt-1 text-[12.5px] leading-[1.5] text-stop" role="alert">
                        {website.message} Booklet generation will run without website context.
                      </p>
                    )}
                  </div>
                  <Pill tone={website.status === "reachable" ? "go" : "stop"}>
                    {website.status === "reachable"
                      ? "Reachable"
                      : website.status === "invalid"
                        ? "Invalid URL"
                        : website.status === "missing"
                          ? "Missing"
                          : "Unreachable"}
                  </Pill>
                </div>
              </div>
            </SectionCard>
          </Rise>
        </Group>

        <Group className="space-y-6">
          <Rise>
            <ScoreBreakdownCard
              score={score?.priority_score ?? null}
              factors={score?.score_factors ?? null}
              error={scoreError}
            />
          </Rise>

          {/* The Tags card's picker has to paint over the cards after it, and
              each Rise is a `filter` animation — its own stacking context — so
              a z-index inside the card cannot reach past its Rise. It goes
              here, on the wrapper, where it can. */}
          <Rise className="relative z-10">
            <TagsCard
              organisationId={client.id}
              initialClientTags={clientTags}
              availableTags={allTagsResult.data ?? []}
              canEdit={canEdit}
            />
          </Rise>

          <Rise>
            <SourcesCard
              error={sourcesError}
              sources={sources}
              hasManualFields={fieldHistory.hasManual}
            />
          </Rise>
        </Group>
      </div>
    </Stage>
  );
}
