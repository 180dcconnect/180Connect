import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { logSecurityEvent } from "@/lib/log-security-event";
import { reportError } from "@/lib/error-logging";
import { safeValidate } from "@/lib/validation";
import {
  MAX_BULK_TAG_CLIENTS,
  MAX_BULK_TAG_TAGS,
  buildBulkTagRows,
  bulkTagsInsertFailure,
  bulkTagsSummary,
} from "@/lib/bulk-tags";

/**
 * F063 (#65) — apply one or more existing tags to every selected client at
 * once, reached from the bulk bar on /clients.
 *
 * AC1 is the shape of the write: one or more tags across all selected clients
 * in a single action — the cross product of clients x tags inserted in one
 * statement. One statement is one transaction: either every selected client is
 * tagged or none is, with no half-tagged list for the CAM to reconcile.
 *
 * AC2 needs no code of its own here: org_tags_unique_assignment on
 * (organisation_id, tag_id) rejects duplicates, and ignoreDuplicates turns that
 * rejection into a per-row no-op instead of a batch failure (see
 * @/lib/bulk-tags for why this is a plain INSERT rather than an RPC).
 *
 * The outer gate is `tags:manage`, not `client:edit`, matching F191's single
 * assignment (@/lib/tags/assign-tag-core.ts): tagging is its own capability,
 * held by CAMs and admins. RLS still has the final word either way.
 */

const bodySchema = z.object({
  ids: z
    .array(z.uuid())
    // Bounds are the app's own (@/lib/bulk-tags explains why they cannot be the
    // database's). Rejecting at parse time keeps an absurd payload from being
    // expanded into row objects and shipped to Postgres at all.
    .min(1)
    .max(MAX_BULK_TAG_CLIENTS),
  tagIds: z.array(z.uuid()).min(1).max(MAX_BULK_TAG_TAGS),
});

function denied(reason: Parameters<typeof actorFailureMessage>[0]) {
  const status = reason === "unauthenticated" ? 401 : 403;
  return NextResponse.json({ error: actorFailureMessage(reason) }, { status });
}

export async function POST(request: Request) {
  const authorization = await getCurrentActor("tags:manage", {
    route: "/api/clients/bulk-tags",
  });
  if (!authorization.ok) return denied(authorization.reason);

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  // F222: validation goes through the shared wrapper so error shape stays
  // consistent with the rest of the app's routes and actions.
  const parsed = safeValidate(bodySchema, input);
  if (!parsed.success) {
    logSecurityEvent("validation.rejected", {
      route: "/api/clients/bulk-tags",
      fieldCount: Object.keys(parsed.fieldErrors).length,
    });
    return NextResponse.json(
      {
        error: `Select between 1 and ${MAX_BULK_TAG_CLIENTS} clients and choose between 1 and ${MAX_BULK_TAG_TAGS} tags.`,
      },
      { status: 400 },
    );
  }

  // Duplicates in either list would only inflate the cross product; deduping
  // keeps `requested` equal to the number of clients the summary talks about.
  const ids = [...new Set(parsed.data.ids)];
  const tagIds = [...new Set(parsed.data.tagIds)];
  const supabase = await createClient();

  const rows = buildBulkTagRows(ids, tagIds, authorization.actor.id);
  const { data, error } = await supabase
    .from("org_tags")
    .upsert(rows, {
      onConflict: "organisation_id,tag_id",
      // AC2: a client that already has a chosen tag contributes no row instead
      // of failing the batch.
      ignoreDuplicates: true,
    })
    .select("organisation_id");

  if (error) {
    await reportError(error, {
      operation: "clients.bulk_tags",
      // Counts, never ids or tag names: an error log is not the place for the
      // shape of someone's client work.
      selectedCount: ids.length,
      tagCount: tagIds.length,
    });
    const { status, error: message } = bulkTagsInsertFailure(error);
    return NextResponse.json({ error: message }, { status });
  }

  // A client counts as tagged when at least one new row was created for it;
  // clients whose every chosen pair was already assigned are the unchanged rest.
  const taggedClientIds = new Set((data ?? []).map((row) => row.organisation_id));
  const tagged = taggedClientIds.size;
  const result = { requested: ids.length, tagged, unchanged: ids.length - tagged };
  return NextResponse.json({ ...result, message: bulkTagsSummary(result) }, { status: 200 });
}
