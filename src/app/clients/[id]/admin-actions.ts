"use server";

import { revalidatePath } from "next/cache";
import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ORGANISATION_TYPES } from "@/lib/organisation-format";
import {
  maxLengthFor,
  normaliseFieldValue,
  restrictedFieldLabel,
  summariseBatch,
  type EditBatchState,
  type FieldSubmissionResult,
} from "@/lib/edit-suggestions";

/**
 * Fields an admin may write straight onto the record, no proposal step.
 *
 * Mirrors restricted_edit_fields plus the enum-typed and descriptive columns
 * that can never be restricted (add_restricted_edit_field refuses them), which
 * is why this list is longer than the CAM's. `mission_statement` is not here: it
 * is not a column on organisations — it lives in enrichment_results, and is
 * handled separately below.
 */
const ADMIN_EDITABLE_FIELDS = new Set([
  "legal_name",
  "organisation_type",
  "city",
  "address_line_1",
  "postcode",
  "country_code",
  "contact_email",
  "website",
  "sector",
  "sub_sector",
  "geographic_reach",
]);

const MISSION_FIELDS = new Set(["mission_statement", "mission"]);

/**
 * Closed sets, checked here rather than left to Postgres.
 *
 * `organisation_type` is a Postgres enum, so a value outside the set comes back
 * as `22P02 invalid input value for enum` — an error the batch can only report
 * as "could not be saved", and one that aborts the whole UPDATE, taking the
 * other fields in the batch down with a value the caller controls. The panel
 * offers a select, but the select is the client's; this is the check.
 */
const ENUM_FIELD_VALUES: Record<string, readonly string[]> = {
  organisation_type: ORGANISATION_TYPES,
};

/**
 * The admin's side of the inline editor: several fields, applied directly.
 *
 * An admin's edit is not a proposal, so there is no RPC and no queue — but the
 * shape of the result is the CAM's, per-field, because the failures are just as
 * independent (one column rejects on length, the rest are fine) and the panel
 * renders both outcomes with the same code.
 *
 * Mission is not a column on `organisations`; it is the newest
 * `enrichment_results` row, so an admin editing it appends a hand-written
 * enrichment at full confidence rather than updating a field.
 */
export async function adminDirectEditsAction(input: {
  organisationId: string;
  changes: { fieldName: string; value: string }[];
}): Promise<EditBatchState> {
  const authorization = await getCurrentActor("client:edit", { route: "/clients/[id]" });
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason), results: [] };
  }
  if (authorization.actor.role !== "admin") {
    return { kind: "error", message: "Only an admin can edit directly.", results: [] };
  }
  if (input.changes.length === 0) {
    return { kind: "error", message: "Nothing has been changed yet.", results: [] };
  }

  const organisationId = input.organisationId.trim();
  const supabase = await createClient();
  const results: FieldSubmissionResult[] = [];

  // Column writes are batched into one UPDATE: they land on the same row, and a
  // single statement means the record is never briefly half-corrected.
  const columnUpdates: Record<string, string> = {};
  const columnFields: string[] = [];

  for (const change of input.changes) {
    const fieldName = change.fieldName.trim();
    const value = normaliseFieldValue(fieldName, change.value);
    const label = restrictedFieldLabel(fieldName);

    if (!value) {
      results.push({ fieldName, ok: false, message: `Enter a value for ${label.toLowerCase()}.` });
      continue;
    }
    if (value.length > maxLengthFor(fieldName)) {
      results.push({
        fieldName,
        ok: false,
        message: `${label} must be ${maxLengthFor(fieldName)} characters or fewer.`,
      });
      continue;
    }

    if (MISSION_FIELDS.has(fieldName)) {
      const admin = createAdminClient();
      if (!admin) {
        results.push({ fieldName, ok: false, message: "Database service unavailable." });
        continue;
      }
      const { error } = await admin.from("enrichment_results").insert({
        organisation_id: organisationId,
        mission_statement: value,
        confidence_score: 1,
        needs_review: false,
        enriched_at: new Date().toISOString(),
      });
      if (error) {
        await reportError(error, {
          operation: "clients.admin_direct_edit_mission",
          organisationId,
        });
        results.push({ fieldName, ok: false, message: "Could not save the mission." });
        continue;
      }
      results.push({ fieldName, ok: true, message: `${label} saved.` });
      continue;
    }

    if (!ADMIN_EDITABLE_FIELDS.has(fieldName)) {
      results.push({ fieldName, ok: false, message: `${label} cannot be edited here.` });
      continue;
    }

    const allowed = ENUM_FIELD_VALUES[fieldName];
    if (allowed && !allowed.includes(value)) {
      results.push({
        fieldName,
        ok: false,
        message: `${label} must be one of the listed options.`,
      });
      continue;
    }

    columnUpdates[fieldName] = value;
    columnFields.push(fieldName);
  }

  if (columnFields.length > 0) {
    const { error } = await supabase
      .from("organisations")
      .update(columnUpdates)
      .eq("id", organisationId);

    if (error) {
      await reportError(error, {
        operation: "clients.admin_direct_edits",
        organisationId,
        fieldName: columnFields.join(","),
      });
      for (const fieldName of columnFields) {
        results.push({
          fieldName,
          ok: false,
          message: "The change could not be saved. Refresh and try again.",
        });
      }
    } else {
      for (const fieldName of columnFields) {
        results.push({
          fieldName,
          ok: true,
          message: `${restrictedFieldLabel(fieldName)} saved.`,
        });
      }
    }
  }

  if (results.some((result) => result.ok)) {
    revalidatePath(`/clients/${organisationId}`, "layout");
  }

  return summariseBatch(results, "saved");
}
