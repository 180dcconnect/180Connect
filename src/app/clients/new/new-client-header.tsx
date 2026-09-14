import { DataImportsHeader } from "@/app/admin/data-imports-header";

/**
 * The heading block for "Add a client", which is a Data imports tab: it renders
 * that group's shared header — title on the ground, the group's tab row under
 * it — so switching tabs leaves the header pixel-identical.
 *
 * ── Why it looks like the import screens ──
 *
 * Adding a client by hand and importing a register are the same job with a
 * different starting point — one organisation, chosen by a person instead of by
 * a filter. Given that, the two screens should read as one system, and the
 * import screens have the better-established version of it: no uppercase
 * eyebrow and no card wrapped around the title.
 *
 * There used to be a rail under the tabs counting what the two register files
 * hold. It was dropped: nobody adding one client needs the size of the register,
 * and a missing file is reported where it matters — in the register search's
 * own result.
 */
export function NewClientHeader() {
  return <DataImportsHeader current="/clients/new" />;
}
