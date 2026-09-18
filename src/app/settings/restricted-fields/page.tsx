import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getViewingActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import { reportError } from "@/lib/error-logging";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Group, Rise, Stage } from "@/components/dashboard-stage";
import { VIEW_ONLY_CONTROL_NOTE } from "@/lib/auth/view-only";
import { isViewOnly } from "@/lib/auth/permissions";
import {
  KNOWN_RESTRICTABLE_FIELDS,
  type RestrictedFieldRow,
} from "@/lib/edit-suggestions";
import { RestrictedFieldsPanel } from "./restricted-fields-panel";

/**
 * Restricted fields (F020, #23): which parts of a client record a CAM cannot
 * change directly, only suggest a change to for an admin to approve.
 *
 * ── Who this is for ──
 *
 * An admin, not a developer (AGENTS.md, "Who will maintain this app"). So the
 * page never shows or asks for a column name: the fields that can be locked come
 * from the database as a list (`list_restrictable_edit_fields`) and are shown by
 * their plain-English names, and the words are "lock" / "unlock" rather than
 * restrict / retire.
 *
 * ── The layout ──
 *
 * The Data imports skeleton in the Filed Record language
 * (`docs/app-design-system.md`), as on Profile & account: a heading, one rail of
 * facts, then a card per job — what is locked now, and locking another field.
 */
export default async function RestrictedFieldsPage() {
  const authorization = await getViewingActor("approval:manage", {
    route: "/settings/restricted-fields",
  });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  const supabase = await createClient();

  const [rowsResult, optionsResult] = await Promise.all([
    supabase
      .from("restricted_edit_fields")
      .select("field_name, reason, active")
      // No active-first ordering: a field that is unlocked must stay where it
      // is in the list, so the order cannot depend on the toggle.
      .order("field_name")
      .overrideTypes<RestrictedFieldRow[], { merge: false }>(),
    supabase.rpc("list_restrictable_edit_fields"),
  ]);

  if (rowsResult.error) {
    await reportError(rowsResult.error, { operation: "admin.restricted_fields.page_list" });
  }

  // The dropdown degrades to the fields the app already knows how to describe
  // rather than disappearing: the add RPC re-checks whatever is chosen, so the
  // fallback can offer too much but never let a bad field through.
  let lockableFields: string[] = [...KNOWN_RESTRICTABLE_FIELDS];
  if (optionsResult.error) {
    await reportError(optionsResult.error, {
      operation: "admin.restricted_fields.list_restrictable",
    });
  } else if (Array.isArray(optionsResult.data)) {
    lockableFields = (optionsResult.data as Array<{ field_name: string }>).map(
      (row) => row.field_name,
    );
  }

  const rows = rowsResult.data ?? [];
  const lockedCount = rows.filter((row) => row.active).length;

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="w-full space-y-8">
        <Rise>
          <h1 className="font-body text-[clamp(2rem,4vw,2.75rem)] leading-[1] font-semibold tracking-[-0.03em] text-ink">
            Restricted fields
          </h1>
          <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-dim">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-lead" />
            <span>
              <span className="font-semibold text-ink">
                {lockedCount} {lockedCount === 1 ? "field" : "fields"} locked
              </span>
              {" · "}
              CAMs suggest changes to these, and an admin approves them
            </span>
          </p>
          {isViewOnly(authorization.actor.role) && (
            <p className="mt-2 text-sm text-dim">{VIEW_ONLY_CONTROL_NOTE}</p>
          )}
        </Rise>

        {rowsResult.error && (
          <Rise>
            <InlineAlert
              variant="page"
              message="The restricted fields could not be loaded. Refresh the page to try again."
            />
          </Rise>
        )}

        <Group className="space-y-4">
          <RestrictedFieldsPanel
            initialFields={rows}
            lockableFields={lockableFields}
            readOnly={isViewOnly(authorization.actor.role)}
          />
        </Group>
      </Stage>
    </div>
  );
}
