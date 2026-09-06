import { redirect } from "next/navigation";

/**
 * Legacy edit suggestions route (#80/#81).
 *
 * F181 folds suggested client edits into the dedicated Approvals workspace
 * at `/admin/approvals`.
 */
export default function EditSuggestionsPage() {
  redirect("/admin/approvals");
}
