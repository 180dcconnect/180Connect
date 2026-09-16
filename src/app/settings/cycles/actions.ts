"use server";

import { revalidatePath } from "next/cache";

import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import {
  describeCycleWindow,
  findCycleOverlap,
  parseCycleInput,
  type OutreachCycle,
} from "@/lib/outreach-cycles.ts";
import { reportError } from "@/lib/error-logging";
import { createClient } from "@/lib/supabase/server";

const ROUTE = "/settings/cycles";

/**
 * Said where the reader is, not where Postgres was: the dates were free when
 * this screen read them, and somebody else's save landed first.
 */
const OVERLAP_RACE_MESSAGE =
  "Another cycle was saved at the same moment and covers those dates. Refresh the page, then pick dates outside it.";

export type CycleActionState = { ok: true; message: string } | { ok: false; message: string };

/** A second admin saving the same name at the same moment hits the unique index. */
function isUniqueViolation(error: unknown): boolean {
  return (
    !!error && typeof error === "object" && "code" in error && error.code === "23505"
  );
}

/**
 * The database's own non-overlap check refused the write
 * (`20261005140000_outreach_cycles_reject_overlap.sql`, errcode 23P01).
 *
 * Reachable when two admins save at once: both read the cycle list in
 * `readCycles` before either wrote, so both passed the check below, and the
 * trigger — which runs under an advisory lock, in the same transaction as the
 * write — was the first of the two to see the other one. Rare, and the honest
 * answer is to say so rather than "The cycle could not be saved": the dates were
 * free when this screen looked.
 */
function isOverlapViolation(error: unknown): boolean {
  return (
    !!error && typeof error === "object" && "code" in error && error.code === "23P01"
  );
}

type CycleRow = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
};

async function readCycles(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<OutreachCycle[]> {
  const { data, error } = await supabase
    .from("outreach_cycles")
    .select("id, name, starts_on, ends_on")
    .order("starts_on", { ascending: true })
    .returns<CycleRow[]>();
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    starts_on: row.starts_on,
    ends_on: row.ends_on,
  }));
}

function revalidateCycles() {
  revalidatePath(ROUTE);
  revalidatePath("/admin/analytics");
}

/**
 * Outreach cycle definitions — the named date ranges Team analytics compares.
 *
 * Admin-only (`platform-settings:manage`), enforced here for a friendly refusal
 * and re-enforced by the table's own RLS policies regardless: the writes below
 * run on the caller's RLS session (the booklet delete's pattern), so the
 * admin-only INSERT/UPDATE/DELETE policies decide what actually lands.
 *
 * The non-overlap rule is checked twice on purpose. Before the write, here, in
 * plain words — a clash names the cycle it clashes with and the days it covers,
 * so the fix is obvious and no database error text reaches a person. And in the
 * database, by the OUTREACH_CYCLES trigger under an advisory lock
 * (`20261005140000`), which is the only check two concurrent saves cannot both
 * pass.
 *
 * No audit_log row: a cycle is configuration, not ownership, status, role or
 * approval state — and `created_by_user_id` already records who defined each
 * one. Deleting a cycle removes the label only; no outreach row references a
 * cycle, so emails and numbers are untouched by definition.
 */
export async function createCycle(input: unknown): Promise<CycleActionState> {
  const authorization = await getCurrentActor("platform-settings:manage", { route: ROUTE });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }
  const parsed = parseCycleInput(input);
  if (!parsed.ok) return { ok: false, message: parsed.message };

  try {
    const supabase = await createClient();
    const existing = await readCycles(supabase);
    const clash = findCycleOverlap(existing, {
      starts_on: parsed.data.startsOn,
      ends_on: parsed.data.endsOn,
    });
    if (clash) {
      return {
        ok: false,
        message: `“${clash.name}” already covers ${describeCycleWindow(clash)} — cycles cannot overlap, so every email belongs to exactly one cycle. Pick dates outside it.`,
      };
    }
    const { error } = await supabase.from("outreach_cycles").insert({
      name: parsed.data.name,
      starts_on: parsed.data.startsOn,
      ends_on: parsed.data.endsOn,
      created_by_user_id: authorization.actor.id,
    });
    if (error) throw error;
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, message: "A cycle with that name already exists." };
    }
    if (isOverlapViolation(error)) {
      return { ok: false, message: OVERLAP_RACE_MESSAGE };
    }
    await reportError(error, { operation: "settings.cycles.create" });
    return { ok: false, message: "The cycle could not be saved. Try again." };
  }

  revalidateCycles();
  return { ok: true, message: `Saved “${parsed.data.name}”.` };
}

export async function updateCycle(input: unknown): Promise<CycleActionState> {
  const authorization = await getCurrentActor("platform-settings:manage", { route: ROUTE });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }
  const parsed = parseCycleInput(input);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  const id = (input as Record<string, unknown> | null)?.id;
  if (typeof id !== "string" || !id) {
    return { ok: false, message: "That cycle could not be identified." };
  }

  try {
    const supabase = await createClient();
    const existing = await readCycles(supabase);
    if (!existing.some((cycle) => cycle.id === id)) {
      return { ok: false, message: "That cycle is already gone. Refresh the page." };
    }
    const clash = findCycleOverlap(
      existing,
      { starts_on: parsed.data.startsOn, ends_on: parsed.data.endsOn },
      id,
    );
    if (clash) {
      return {
        ok: false,
        message: `“${clash.name}” already covers ${describeCycleWindow(clash)} — cycles cannot overlap, so every email belongs to exactly one cycle. Pick dates outside it.`,
      };
    }
    const { error } = await supabase
      .from("outreach_cycles")
      .update({
        name: parsed.data.name,
        starts_on: parsed.data.startsOn,
        ends_on: parsed.data.endsOn,
      })
      .eq("id", id);
    if (error) throw error;
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, message: "A cycle with that name already exists." };
    }
    if (isOverlapViolation(error)) {
      return { ok: false, message: OVERLAP_RACE_MESSAGE };
    }
    await reportError(error, { operation: "settings.cycles.update" });
    return { ok: false, message: "The cycle could not be saved. Try again." };
  }

  revalidateCycles();
  // Dates are labels, not stamps: moving them re-sorts history rather than
  // rewriting it — but any comparison already read used the old ones, so the
  // message says where the numbers went.
  return { ok: true, message: `Saved “${parsed.data.name}” — comparisons now use the new dates.` };
}

export async function deleteCycle(input: unknown): Promise<CycleActionState> {
  const authorization = await getCurrentActor("platform-settings:manage", { route: ROUTE });
  if (!authorization.ok) {
    return { ok: false, message: actorFailureMessage(authorization.reason) };
  }
  const id = (input as Record<string, unknown> | null)?.id;
  if (typeof id !== "string" || !id) {
    return { ok: false, message: "That cycle could not be identified." };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("outreach_cycles")
      .delete()
      .eq("id", id)
      .select("name")
      .maybeSingle<{ name: string }>();
    if (error) throw error;
    if (!data) return { ok: false, message: "That cycle is already gone. Refresh the page." };
    revalidateCycles();
    return {
      ok: true,
      message: `Deleted “${data.name}”. Emails and numbers are untouched — only the label is gone, and defining it again with the same dates puts it back.`,
    };
  } catch (error) {
    await reportError(error, { operation: "settings.cycles.delete" });
    return { ok: false, message: "The cycle could not be deleted. Try again." };
  }
}
