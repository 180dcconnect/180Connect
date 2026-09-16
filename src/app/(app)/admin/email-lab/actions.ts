"use server";

import { z } from "zod";
import { actorFailureMessage, getCurrentActor, getViewingActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { safeValidate } from "@/lib/validation";
import { consumeAiGenerationAllowance } from "@/lib/ai/rate-limit";
import { loadModelRate } from "@/lib/ai/model-rate";
import { computeCostUsd } from "@/lib/outreach/generation-cost";
import {
  createStageOneModelCall,
  parseDraftJson,
} from "@/lib/outreach/stage-one-generation";
import {
  createStageTwoModelCall,
  parseReplyDraftJson,
} from "@/lib/outreach/stage-two-generation";
import {
  buildStageTwoPrompt,
  REPLY_INTENTS,
  REPLY_SENTIMENTS,
  STAGE_TWO_CLOSINGS,
} from "@/lib/outreach/stage-two-prompt";
import { lookupLiveNewsHook, resolveNewsProvider } from "@/lib/outreach/news-hook";
import { emailHtmlToPlainText } from "@/lib/outreach/email-html";
import { stripQuotedReply } from "@/lib/gmail/reply-message";
import {
  loadStageOneExtras,
  STAGE_ONE_ORGANISATION_COLUMNS,
  toStageOneContext,
  type StageOneOrganisationRow,
} from "@/lib/outreach/stage-one-context";
import {
  buildStageOnePrompt,
  CLOSING_APPROACHES,
  EMAIL_LENGTHS,
  EMAIL_REGISTERS,
  OPENING_APPROACHES,
  SIZE_TONE_LABELS,
  type SizeTemplate,
} from "@/lib/outreach/stage-one-prompt";

/**
 * The two things the prompt lab (`page.tsx`) asks the server for: build the
 * prompt for a chosen client, and run a prompt through the model.
 *
 * They are deliberately separate calls. Building costs nothing, so the page
 * rebuilds the preview on every dial change; running costs a real Gemini call,
 * so it happens only when the admin presses the button. Nothing here is saved:
 * a lab run writes no draft, no ai_generations row and no audit entry, and the
 * prompt an admin types here changes nothing about what a CAM's Compose button
 * sends. The lab is a place to find out, not a place to configure.
 */

const DIALS = {
  length: z.enum(EMAIL_LENGTHS).default("standard"),
  register: z.enum(EMAIL_REGISTERS).default("professional"),
  opening: z.enum(OPENING_APPROACHES).default("mission_led"),
  closing: z.enum(CLOSING_APPROACHES).default("soft_cta"),
  attachFlyer: z.boolean().default(false),
};

const buildSchema = z.object({
  organisationId: z.uuid(),
  ...DIALS,
  /** A hook already looked up on this page, or nothing. The lookup is its own call. */
  newsHook: z.string().max(2_000).default(""),
  newsUrl: z.string().max(2_000).default(""),
});

/**
 * Cap on a hand-edited prompt. Generous — the built system prompt with a full
 * booklet already runs to several thousand characters — but not unbounded: the
 * cost of a call scales with what is in the box.
 */
const MAX_PROMPT_CHARS = 60_000;

const runSchema = z.object({
  system: z.string().trim().min(1, "The system prompt cannot be empty.").max(MAX_PROMPT_CHARS),
  user: z.string().trim().min(1, "The message to the model cannot be empty.").max(MAX_PROMPT_CHARS),
});

export type LabPrompt = {
  system: string;
  user: string;
  /** Plain-English summary of the income-band tone the client's accounts selected. */
  sizeToneLabel: string;
  sizeTemplate: SizeTemplate;
};

export type BuildPromptResult = { ok: true; prompt: LabPrompt } | { ok: false; error: string };

/**
 * The exact prompt a real Stage 1 generation would send for this client, right
 * now, with these dials. A read — a viewer may see it.
 */
export async function buildLabPrompt(input: unknown): Promise<BuildPromptResult> {
  const authorization = await getViewingActor("platform-settings:manage", { route: "/admin/email-lab" });
  if (!authorization.ok) return { ok: false, error: actorFailureMessage(authorization.reason) };

  const parsed = safeValidate(buildSchema, input);
  if (!parsed.success) return { ok: false, error: "Choose a client and a valid set of options, then try again." };
  const { organisationId, attachFlyer, newsHook, newsUrl, ...dials } = parsed.data;

  const supabase = await createClient();
  const { data: organisation, error } = await supabase
    .from("organisations")
    .select(STAGE_ONE_ORGANISATION_COLUMNS)
    .eq("id", organisationId)
    .maybeSingle<StageOneOrganisationRow>();
  if (error || !organisation) {
    if (error) await reportError(error, { operation: "admin.email_lab.load_client", organisationId });
    return { ok: false, error: "That client could not be loaded. Pick another one, or refresh the page." };
  }

  const extras = await loadStageOneExtras(supabase, organisationId, "admin.email_lab");
  // Same composition the real route does, except that the lookup itself is a
  // button here rather than automatic — the preview rebuilds on every option
  // change, and a paid third-party lookup behind that would bill for flicking
  // through the dials.
  const newsHooks = newsHook.trim()
    ? [newsUrl.trim() ? `${newsHook.trim()}\nSource: ${newsUrl.trim()}` : newsHook.trim()]
    : (extras.enrichment?.news_hooks?.filter(Boolean) ?? []);
  const built = buildStageOnePrompt(
    {
      ...toStageOneContext({
        organisation,
        extras,
        // The lab previews what *this* admin sending would produce, which is the
        // same thing the real route does with the signed-in CAM's name.
        senderName: authorization.actor.fullName,
        attachFlyer,
      }),
      newsHooks,
    },
    dials,
  );

  return {
    ok: true,
    prompt: {
      system: built.system,
      user: built.prompt,
      sizeTemplate: built.sizeTemplate,
      sizeToneLabel: SIZE_TONE_LABELS[built.sizeTemplate],
    },
  };
}

export type LabRunResult =
  | {
      ok: true;
      subject: string;
      body: string;
      model: string;
      inputTokens: number | null;
      outputTokens: number | null;
      totalTokens: number | null;
      costUsd: number | null;
      elapsedMs: number;
    }
  | { ok: false; error: string };

/**
 * Sends whatever is in the two boxes to the same model, with the same options,
 * that a real generation uses — so a prompt that works here works there.
 *
 * Gated with `getCurrentActor`, not a role literal: this spends money, so a
 * viewer is refused here and gets the standard view-only notice, exactly as
 * they would on any other write.
 */
export async function runLabGeneration(input: unknown): Promise<LabRunResult> {
  const authorization = await getCurrentActor("platform-settings:manage", { route: "/admin/email-lab" });
  if (!authorization.ok) return { ok: false, error: actorFailureMessage(authorization.reason) };

  const parsed = safeValidate(runSchema, input);
  if (!parsed.success) {
    const first = Object.values(parsed.fieldErrors).flat().find(Boolean);
    return { ok: false, error: first ?? "The prompt could not be sent. Check both boxes and try again." };
  }

  const admin = createAdminClient();
  if (!admin) {
    return { ok: false, error: "Email generation is not set up on this environment. Contact a developer." };
  }

  let callModel;
  let model: string;
  try {
    ({ callModel, model } = createStageOneModelCall());
  } catch (error) {
    await reportError(error, { operation: "admin.email_lab.configure" });
    return { ok: false, error: "Email generation is not set up on this environment. Contact a developer." };
  }

  // The lab shares the hourly generation allowance with real drafting on
  // purpose: a stuck retry loop in here must not be able to spend more than a
  // CAM at work could, and the two really are the same cost.
  const allowance = await consumeAiGenerationAllowance(admin, authorization.actor.id);
  if (!allowance.allowed) return { ok: false, error: allowance.message };

  const startedAt = Date.now();
  let text: string;
  let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  try {
    const result = await callModel({ system: parsed.data.system, prompt: parsed.data.user });
    text = result.text;
    usage = result.usage;
  } catch (error) {
    await reportError(error, { operation: "admin.email_lab.generate" });
    return { ok: false, error: "The model did not answer. Wait a moment and try again." };
  }
  const elapsedMs = Date.now() - startedAt;

  let draft;
  try {
    draft = parseDraftJson(text);
  } catch {
    // Unlike real generation, this is useful information rather than a failure
    // to hide: an edited prompt that stops asking for JSON is the most likely
    // reason to land here, and the person who edited it needs to see that.
    return {
      ok: false,
      error:
        "The model replied, but not with a subject and a body it could read back. Keep the last paragraph of the system prompt — the one asking for a JSON object with \"subject\" and \"body\" — and try again.",
    };
  }

  const pricing = await loadModelRate(
    () =>
      admin
        .from("model_pricing")
        .select("input_usd_per_1k_tokens, output_usd_per_1k_tokens")
        .eq("model", model)
        .maybeSingle(),
    model,
    "admin.email_lab.load_pricing",
  );

  return {
    ok: true,
    subject: draft.subject,
    body: draft.body,
    model,
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    totalTokens: usage.totalTokens ?? null,
    costUsd: computeCostUsd(
      { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
      pricing,
    ),
    elapsedMs,
  };
}

/* ────────────────────────── Stage 2: follow-ups and replies ───────────────────────── */

const stageTwoBuildSchema = z.object({
  organisationId: z.uuid(),
  length: DIALS.length,
  register: DIALS.register,
  attachFlyer: DIALS.attachFlyer,
  closing: z.enum(STAGE_TWO_CLOSINGS).default("soft_cta"),
  previousSubject: z.string().max(MAX_PROMPT_CHARS).default(""),
  previousBody: z.string().max(MAX_PROMPT_CHARS).default(""),
  /** Empty means "they never replied" — the chase-up shape rather than the answer shape. */
  replyBody: z.string().max(MAX_PROMPT_CHARS).default(""),
  replyAuthorName: z.string().max(200).default(""),
  replySentiment: z.enum(REPLY_SENTIMENTS).nullable().default(null),
  replyIntent: z.enum(REPLY_INTENTS).nullable().default(null),
  /** A hook already looked up on this page, or nothing. The lookup is its own call. */
  newsHook: z.string().max(2_000).default(""),
  newsUrl: z.string().max(2_000).default(""),
});

export type StageTwoBuildResult = { ok: true; prompt: LabPrompt } | { ok: false; error: string };

/**
 * The Stage 2 twin of `buildLabPrompt`.
 *
 * The conversation — the email that went out, and the reply if there was one —
 * is supplied by the page rather than read here. On a real send both come out
 * of the thread; in the lab a client with no sent email and no reply is the
 * normal case, so the page prefills what exists and lets the admin type the
 * rest. That is the only way to try a reply shape at all on a branch whose
 * clients have never been written to.
 */
export async function buildLabStageTwoPrompt(input: unknown): Promise<StageTwoBuildResult> {
  const authorization = await getViewingActor("platform-settings:manage", { route: "/admin/email-lab" });
  if (!authorization.ok) return { ok: false, error: actorFailureMessage(authorization.reason) };

  const parsed = safeValidate(stageTwoBuildSchema, input);
  if (!parsed.success) return { ok: false, error: "Choose a client and a valid set of options, then try again." };
  const data = parsed.data;

  const supabase = await createClient();
  const { data: organisation, error } = await supabase
    .from("organisations")
    .select(STAGE_ONE_ORGANISATION_COLUMNS)
    .eq("id", data.organisationId)
    .maybeSingle<StageOneOrganisationRow>();
  if (error || !organisation) {
    if (error) await reportError(error, { operation: "admin.email_lab.load_client", organisationId: data.organisationId });
    return { ok: false, error: "That client could not be loaded. Pick another one, or refresh the page." };
  }

  const extras = await loadStageOneExtras(supabase, data.organisationId, "admin.email_lab");
  const base = toStageOneContext({
    organisation,
    extras,
    senderName: authorization.actor.fullName,
    attachFlyer: data.attachFlyer,
  });

  // Same composition the real route does: a live hook wins and carries its
  // Source line; otherwise the stored enrichment hooks stand (in practice
  // always empty — nothing writes that column).
  const newsHooks = data.newsHook.trim()
    ? [data.newsUrl.trim() ? `${data.newsHook.trim()}\nSource: ${data.newsUrl.trim()}` : data.newsHook.trim()]
    : (extras.enrichment?.news_hooks?.filter(Boolean) ?? []);

  const built = buildStageTwoPrompt(
    {
      ...base,
      newsHooks,
      previousSubject: data.previousSubject.trim() || null,
      previousBody: data.previousBody.trim() || null,
      // Stripped exactly as the route strips it, so a reply pasted with our own
      // quoted email underneath behaves here the way it would in production.
      replyBody: data.replyBody.trim() ? stripQuotedReply(data.replyBody.trim()) : null,
      replyAuthorName: data.replyAuthorName.trim() || null,
      replyReceivedAt: data.replyBody.trim() ? new Date().toISOString() : null,
      replySentiment: data.replySentiment,
      replyIntent: data.replyIntent,
    },
    {
      length: data.length,
      register: data.register,
      closing: data.closing,
      newsEnabled: newsHooks.length > 0,
    },
  );

  return {
    ok: true,
    prompt: {
      system: built.system,
      user: built.prompt,
      sizeTemplate: base.incomeBand ?? "default",
      sizeToneLabel: SIZE_TONE_LABELS[base.incomeBand ?? "default"],
    },
  };
}

export type PreviousEmail = { subject: string; body: string } | null;

/**
 * The client's most recent sent email, to start a follow-up from.
 *
 * Null is ordinary, not an error: most clients have never been written to.
 * The page says so and lets the admin type one instead.
 */
export async function loadLabPreviousEmail(
  organisationId: unknown,
): Promise<{ ok: true; previous: PreviousEmail } | { ok: false; error: string }> {
  const authorization = await getViewingActor("platform-settings:manage", { route: "/admin/email-lab" });
  if (!authorization.ok) return { ok: false, error: actorFailureMessage(authorization.reason) };

  const parsed = safeValidate(z.uuid(), organisationId);
  if (!parsed.success) return { ok: false, error: "That client could not be found." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("outreach_messages")
    .select("subject, body")
    .eq("organisation_id", parsed.data)
    .eq("send_status", "sent")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ subject: string | null; body: string | null }>();
  if (error) {
    await reportError(error, { operation: "admin.email_lab.load_previous_email", organisationId: parsed.data });
    return { ok: false, error: "The last email sent to this client could not be read. Type one in instead." };
  }
  if (!data) return { ok: true, previous: null };
  return {
    ok: true,
    previous: {
      subject: data.subject ?? "",
      // The stored body may be HTML (newer sends) or plain text (older ones);
      // the prompt wants readable text either way, same as the real route.
      body: data.body ? emailHtmlToPlainText(data.body) : "",
    },
  };
}

export type NewsLookupResult =
  | { ok: true; hook: { text: string; url: string | null } | null }
  | { ok: false; error: string };

/**
 * One live news lookup, on demand.
 *
 * A real Stage 2 generation does this automatically on every draft. The lab
 * makes it a button instead, for one reason: the prompt preview rebuilds on
 * every option change, and a paid third-party lookup behind that would bill
 * for flicking through the dials.
 */
export async function lookupLabNewsHook(organisationId: unknown): Promise<NewsLookupResult> {
  const authorization = await getCurrentActor("platform-settings:manage", { route: "/admin/email-lab" });
  if (!authorization.ok) return { ok: false, error: actorFailureMessage(authorization.reason) };

  const parsed = safeValidate(z.uuid(), organisationId);
  if (!parsed.success) return { ok: false, error: "That client could not be found." };

  if (resolveNewsProvider() === "none") {
    return {
      ok: false,
      error:
        "News lookups are switched off on this environment, so a real follow-up here would never carry one either. A developer turns them on.",
    };
  }

  const supabase = await createClient();
  const { data: organisation, error } = await supabase
    .from("organisations")
    .select("legal_name, trading_name, website, city, country_code, geographic_reach, sector")
    .eq("id", parsed.data)
    .maybeSingle<{
      legal_name: string;
      trading_name: string | null;
      website: string | null;
      city: string | null;
      country_code: string | null;
      geographic_reach: string | null;
      sector: string | null;
    }>();
  if (error || !organisation) {
    if (error) await reportError(error, { operation: "admin.email_lab.news_lookup_client", organisationId: parsed.data });
    return { ok: false, error: "That client could not be loaded. Pick another one, or refresh the page." };
  }

  // Fail-open like everywhere else: a miss and a provider outage both land as
  // `null`, and the page says "nothing recent found" rather than an error.
  const hook = await lookupLiveNewsHook({
    organisationId: parsed.data,
    organisationName: organisation.legal_name,
    tradingName: organisation.trading_name,
    website: organisation.website,
    city: organisation.city,
    countryCode: organisation.country_code,
    geographicReach: organisation.geographic_reach,
    sector: organisation.sector,
  });
  return { ok: true, hook };
}

export type StageTwoRunResult =
  | (Omit<Extract<LabRunResult, { ok: true }>, "subject"> & { subject: null })
  | { ok: false; error: string };

/**
 * Sends an edited Stage 2 prompt. Same model and options as a real follow-up;
 * the only difference is the contract, which is a body with no subject (a
 * reply keeps the thread's).
 */
export async function runLabStageTwoGeneration(input: unknown): Promise<StageTwoRunResult> {
  const authorization = await getCurrentActor("platform-settings:manage", { route: "/admin/email-lab" });
  if (!authorization.ok) return { ok: false, error: actorFailureMessage(authorization.reason) };

  const parsed = safeValidate(runSchema, input);
  if (!parsed.success) {
    const first = Object.values(parsed.fieldErrors).flat().find(Boolean);
    return { ok: false, error: first ?? "The prompt could not be sent. Check both boxes and try again." };
  }

  const admin = createAdminClient();
  if (!admin) {
    return { ok: false, error: "Email generation is not set up on this environment. Contact a developer." };
  }

  let callModel;
  let model: string;
  try {
    ({ callModel, model } = createStageTwoModelCall());
  } catch (error) {
    await reportError(error, { operation: "admin.email_lab.stage_two.configure" });
    return { ok: false, error: "Email generation is not set up on this environment. Contact a developer." };
  }

  const allowance = await consumeAiGenerationAllowance(admin, authorization.actor.id);
  if (!allowance.allowed) return { ok: false, error: allowance.message };

  const startedAt = Date.now();
  let text: string;
  let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  try {
    const result = await callModel({ system: parsed.data.system, prompt: parsed.data.user });
    text = result.text;
    usage = result.usage;
  } catch (error) {
    await reportError(error, { operation: "admin.email_lab.stage_two.generate" });
    return { ok: false, error: "The model did not answer. Wait a moment and try again." };
  }
  const elapsedMs = Date.now() - startedAt;

  let draft;
  try {
    draft = parseReplyDraftJson(text);
  } catch {
    return {
      ok: false,
      error:
        "The model replied, but not with a message it could read back. Keep the last paragraph of the system prompt — the one asking for a JSON object with a \"body\" — and try again.",
    };
  }

  const pricing = await loadModelRate(
    () =>
      admin
        .from("model_pricing")
        .select("input_usd_per_1k_tokens, output_usd_per_1k_tokens")
        .eq("model", model)
        .maybeSingle(),
    model,
    "admin.email_lab.stage_two.load_pricing",
  );

  return {
    ok: true,
    subject: null,
    body: draft.body,
    model,
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    totalTokens: usage.totalTokens ?? null,
    costUsd: computeCostUsd(
      { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
      pricing,
    ),
    elapsedMs,
  };
}
