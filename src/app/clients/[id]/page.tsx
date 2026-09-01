import { BookOpen, ExternalLink, Globe, Mail, Tag } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/error-logging";
import { hasPermission } from "@/lib/auth/permissions";
import { validateClientEmail } from "@/lib/client-email-validation";
import { websiteHref } from "@/lib/website-validation";
import {
  formatOrganisationSources,
  type OrganisationSourceRow,
} from "@/lib/source-tracking";
import {
  EDIT_SUGGESTION_SELECT,
  type EditSuggestionRow,
  restrictedFieldLabel,
} from "@/lib/edit-suggestions";
import { Group, Rise, Stage } from "@/components/dashboard-stage";

import { BasicInfoPanel } from "./basic-info-panel";
import { ScoreBreakdownCard } from "./score-breakdown";
import { Pill, SectionCard } from "./section-card";
import { SuggestEditSection } from "./suggest-edit-section";
import { TagsSection } from "./tags-section";
import { loadClient, loadScore, loadWebsite, requireActor } from "./load-record";

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

  const [{ score, error: scoreError }, website, enrichmentResult, sourcesResult, clientTagsResult, allTagsResult] =
    await Promise.all([
      loadScore(id),
      loadWebsite(client.website),
      // ENRICHMENT_RESULTS is append-only, so the most recently enriched row is
      // "the" mission statement, not the only one.
      supabase
        .from("enrichment_results")
        .select("mission_statement, enriched_at")
        .eq("organisation_id", id)
        .order("enriched_at", { ascending: false })
        .limit(1)
        .maybeSingle<EnrichmentRow>(),
      // The generated Supabase types do not know about this branch's new RPC
      // until the remote schema is regenerated, so narrow it at this boundary.
      supabase.rpc("get_organisation_sources_with_actor", { p_organisation_id: id }),
      // F191/F192/F193: this client's assigned tags, and the full list for the
      // assign dropdown.
      supabase.from("org_tags").select("tag_id, tags(name, colour)").eq("organisation_id", id),
      supabase.from("tags").select("id, name, colour").order("name"),
    ]);

  for (const [operation, error] of [
    ["clients.detail_enrichment", enrichmentResult.error],
    ["clients.detail_sources", sourcesResult.error],
    ["clients.detail_tags", clientTagsResult.error],
    ["clients.detail_all_tags", allTagsResult.error],
  ] as const) {
    if (error) await reportError(error, { operation, organisationId: id });
  }

  const enrichment = enrichmentResult.data;
  const sources = formatOrganisationSources(
    (sourcesResult.data ?? []) as OrganisationSourceRow[],
  );
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
  if (actor.role === "cam") {
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
  }

  const sensitiveCurrentValues = Object.fromEntries(
    restrictedFields.map((field) => [
      field.field_name,
      client[field.field_name as keyof typeof client] as string | null,
    ]),
  ) as Record<string, string | null>;

  return (
    <Stage>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Group className="space-y-6">
          <Rise>
            <BasicInfoPanel
              organisation={client}
              missionStatement={enrichment?.mission_statement ?? null}
              missionEnrichedAt={enrichment?.enriched_at ?? null}
            />
          </Rise>

          {/* Directly under the values it governs, so "current vs proposed"
              reads in one glance. CAMs propose; admins decide inline. */}
          {!isViewer && (
            <Rise>
              <SuggestEditSection
                organisationId={client.id}
                actorId={actor.id}
                actorRole={actor.role}
                restrictedFields={restrictedFields}
                currentValues={sensitiveCurrentValues}
                suggestions={suggestions}
              />
            </Rise>
          )}

          {/* F095 — why this client ranks where it does. The header shows the
              number; this is the working behind it. */}
          <Rise>
            <ScoreBreakdownCard
              score={score?.priority_score ?? null}
              band={score?.priority_band ?? null}
              factors={score?.score_factors ?? null}
              error={scoreError}
            />
          </Rise>

          {/* Email and website were two near-identical cards — same
              heading-plus-validity-pill shape, same failure copy — so they read
              as one "can we actually reach them?" card instead. */}
          <Rise>
            <SectionCard headingId="contactability-heading" title="Contactability">
              <dl className="mt-4 space-y-3">
                <div className="flex flex-wrap items-start gap-x-4 gap-y-2 rounded-xl border border-black/[0.05] bg-black/[0.015] px-4 py-3.5">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-black/[0.06]"
                  >
                    <Mail className="size-4 text-foreground/50" />
                  </span>
                  <div className="min-w-[12rem] flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                      <dt className="text-[11px] font-bold tracking-[0.12em] text-foreground/35 uppercase">
                        Email
                      </dt>
                      <Pill tone={email.status === "valid" ? "brand" : "danger"}>
                        {email.status === "valid"
                          ? "Valid format"
                          : email.status === "invalid"
                            ? "Invalid format"
                            : "Missing"}
                      </Pill>
                    </div>
                    <dd
                      className={`mt-1.5 text-sm leading-[1.6] break-all ${
                        email.status === "invalid"
                          ? "font-bold text-destructive"
                          : email.value
                            ? "text-foreground/80"
                            : "text-foreground/35"
                      }`}
                    >
                      {email.value ?? "Not provided"}
                    </dd>
                    {email.message && (
                      <p
                        className="mt-1.5 text-[13px] leading-[1.6] text-destructive/80"
                        role="alert"
                      >
                        {email.message} The rest of this client record is still available.
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-start gap-x-4 gap-y-2 rounded-xl border border-black/[0.05] bg-black/[0.015] px-4 py-3.5">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-black/[0.06]"
                  >
                    <Globe className="size-4 text-foreground/50" />
                  </span>
                  <div className="min-w-[12rem] flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                      <dt className="text-[11px] font-bold tracking-[0.12em] text-foreground/35 uppercase">
                        Website
                      </dt>
                      <Pill tone={website.status === "reachable" ? "brand" : "danger"}>
                        {website.status === "reachable"
                          ? "Reachable"
                          : website.status === "invalid"
                            ? "Invalid URL"
                            : website.status === "missing"
                              ? "Missing"
                              : "Unreachable"}
                      </Pill>
                    </div>
                    <dd className="mt-1.5 text-sm leading-[1.6]">
                      {websiteLink ? (
                        <a
                          aria-label={`Tap to open website ${websiteLink} in new tab`}
                          className={`group inline-flex items-center gap-1.5 break-all underline decoration-1 underline-offset-2 transition-colors ${
                            website.status === "reachable"
                              ? "text-brand-hover hover:text-brand"
                              : "font-bold text-destructive"
                          }`}
                          href={websiteLink}
                          rel="noreferrer"
                          target="_blank"
                          title="Tap to open website in new tab"
                        >
                          <span className="break-all">{websiteLink}</span>
                          <ExternalLink
                            aria-hidden="true"
                            className="h-3.5 w-3.5 shrink-0 opacity-60 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                          />
                        </a>
                      ) : website.url ? (
                        // Malformed: show what is stored, as text. There is
                        // nowhere safe to send anyone.
                        <span className="font-bold break-all text-destructive">
                          {website.url}
                        </span>
                      ) : (
                        <span className="text-foreground/35">Not provided</span>
                      )}
                    </dd>
                    {websiteLink && (
                      <p className="mt-1 text-[11px] font-medium tracking-wide text-foreground/40">
                        Tap to open in new tab
                      </p>
                    )}
                    {website.message && (
                      <p
                        className="mt-1.5 text-[13px] leading-[1.6] text-destructive/80"
                        role="alert"
                      >
                        {website.message} Booklet generation may use unreliable or missing
                        website context.
                      </p>
                    )}
                  </div>
                </div>
              </dl>
            </SectionCard>
          </Rise>
        </Group>

        <Group className="space-y-6">
          <Rise>
            <SectionCard headingId="tags-heading" title="Tags" icon={<Tag />}>
              <TagsSection
                organisationId={client.id}
                initialClientTags={clientTags}
                availableTags={allTagsResult.data ?? []}
                canEdit={canEdit}
              />
            </SectionCard>
          </Rise>

          <Rise>
            <SectionCard
              headingId="source-heading"
              title="Record sources"
              hint="Where the information in this client record came from."
              icon={<BookOpen />}
            >
              {sourcesResult.error ? (
                <p className="mt-4 text-sm font-bold text-destructive" role="alert">
                  Source information could not be loaded. Refresh and try again.
                </p>
              ) : sources.length === 0 ? (
                <p className="mt-4 text-sm leading-[1.7] text-foreground/45">
                  No source information recorded.
                </p>
              ) : (
                <ul className="mt-4 flex flex-wrap gap-2">
                  {sources.map((source) => (
                    <li
                      key={source.source}
                      className="rounded-full bg-brand/10 px-3 py-1.5 text-[13px] font-bold text-brand-hover"
                      title={`First recorded ${new Date(source.first_seen_at).toLocaleDateString("en-GB")}`}
                    >
                      {source.label}
                      {source.source_actor_name ? ` · ${source.source_actor_name}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </Rise>
        </Group>
      </div>
    </Stage>
  );
}
