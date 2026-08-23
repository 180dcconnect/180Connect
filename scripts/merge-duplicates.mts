#!/usr/bin/env node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --env-file-if-exists=.env.local
// Offline merge for intra-batch duplicates created 2026-08-11
// Finds organisations with same normalised legal_name + postcode and
// suppresses all but the earliest created_at. Uses service_role to bypass RLS.
// Usage:
//   node --env-file-if-exists=.env.local scripts/merge-duplicates.mts          # dry-run
//   node --env-file-if-exists=.env.local scripts/merge-duplicates.mts --execute  # apply
//
// Requires SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)
// or SUPABASE_DB_URL for fallback admin lookup.

import { createClient } from "@supabase/supabase-js";

const EXECUTE = process.argv.includes("--execute");
const DRY_RUN = !EXECUTE;

function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,()]/g, "")
    .replace(/\b(ltd|limited)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function normalisePostcode(pc: string): string {
  return pc.toUpperCase().replace(/\s+/g, "");
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(url, key);

  console.log(`Mode: ${DRY_RUN ? "DRY-RUN (no writes) — add --execute to apply" : "EXECUTE"}`);

  // Find an admin to attribute suppressions to
  const { data: admin } = await supabase
    .from("users")
    .select("id, email")
    .eq("role", "admin")
    .eq("is_active", true)
    .limit(1)
    .single();
  const adminId = admin?.id;
  if (!adminId) {
    console.error("No active admin found to attribute suppressions");
    process.exit(1);
  }
  console.log(`Admin for attribution: ${admin.email} (${adminId})`);

  // Paginated fetch of organisations
  const all: { id: string; legal_name: string; postcode: string; created_at: string }[] = [];
  let from = 0;
  const step = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("organisations")
      .select("id, legal_name, postcode, created_at")
      .order("created_at", { ascending: true })
      .range(from, from + step - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as typeof all));
    if (data.length < step) break;
    from += step;
  }
  console.log(`Total organisations: ${all.length}`);

  const groups = new Map<string, typeof all>();
  for (const org of all) {
    const key = `${normaliseName(org.legal_name)}|${normalisePostcode(org.postcode ?? "")}`;
    if (!normaliseName(org.legal_name)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(org);
  }
  const dupGroups = [...groups.values()].filter((g) => g.length > 1);
  console.log(`Duplicate groups (same name+postcode): ${dupGroups.length}`);
  const dupRows = dupGroups.reduce((a, g) => a + g.length, 0);
  console.log(`Rows in duplicate groups: ${dupRows} — will keep ${dupGroups.length} canonical, suppress ${dupRows - dupGroups.length}`);

  // Preview first 5 groups
  for (const g of dupGroups.slice(0, 5)) {
    g.sort((a, b) => a.created_at.localeCompare(b.created_at));
    console.log(`\nGroup "${g[0].legal_name}" | ${g[0].postcode} — ${g.length} rows`);
    for (const org of g) {
      console.log(`  ${org.id} ${org.created_at} ${org.legal_name}`);
    }
  }

  if (DRY_RUN) {
    console.log(`\nDry-run complete. Re-run with --execute to insert ${dupRows - dupGroups.length} active suppressions.`);
    console.log(`After merge, dashboard metrics will drop by ~${dupRows - dupGroups.length} and recent-updates orgNames will be deduped.`);
    return;
  }

  // Check existing active suppressions to avoid duplicate unique violation
  const existing: Set<string> = new Set();
  let sFrom = 0;
  while (true) {
    const { data, error } = await supabase
      .from("suppressions")
      .select("organisation_id, status")
      .in("status", ["pending", "active"])
      .range(sFrom, sFrom + step - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) existing.add(r.organisation_id);
    if (data.length < step) break;
    sFrom += step;
  }

  let suppressed = 0;
  let skipped = 0;
  for (const g of dupGroups) {
    g.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const canonical = g[0];
    const duplicates = g.slice(1);
    for (const dup of duplicates) {
      if (existing.has(dup.id)) {
        skipped++;
        continue;
      }
      const { error } = await supabase.from("suppressions").insert({
        organisation_id: dup.id,
        status: "active",
        reason: `Duplicate of "${canonical.legal_name}" (${canonical.id}) — auto-merged offline (intra-batch dedup bug 2026-08-11, matched on name+postcode)`,
        requested_by: adminId,
        decided_by: adminId,
        decided_at: new Date().toISOString(),
      });
      if (error) {
        console.error(`Failed to suppress ${dup.id}: ${error.message}`);
        skipped++;
      } else {
        suppressed++;
      }
    }
  }
  console.log(`\nDone. Suppressed ${suppressed} duplicates, skipped ${skipped} (already suppressed/error).`);
  console.log(`Verify: SELECT count(*) FROM suppressions WHERE status='active'; and re-check dashboard total.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
