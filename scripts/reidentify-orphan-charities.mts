// Re-identifies the orphan charities: rows imported by the retired API
// discovery path that carry no uk_charity identifier and no linked raw
// record, so no import annotator and no backfill can reach them.
//
//   npm run reidentify:orphans            # dry run: report matches, write nothing
//   npm run reidentify:orphans -- --apply # write identifiers + register profile
//
// Matching runs three passes against data/register.sqlite (see
// src/lib/charity-register/orphan-match.ts, which documents each): exact
// name+postcode; the older-registration tie-break for a pair that is one
// charity holding two registrations; and a unique-name fallback for a postcode
// that has drifted. A pair hitting zero rows, several rows it cannot separate,
// or a row already claimed by another orphan is reported for a human rather
// than guessed at. Every tie-broken choice is printed with the candidates it
// considered, and re-running is a no-op; interrupting is resumable.
//
// A write is an identifier row (verified = false) plus the four
// register-profile columns, gap-only — a column already holding a value is
// never restated, and an organisation that gained an identifier since the load
// is skipped.
//
// Refuses production via the seed config guard, like every other writer here.
// Needs data/register.sqlite present (npm run register:fetch).

import { existsSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

import { bulkSector } from "../src/lib/standardize/charity-commission-bulk.ts";
import {
  indexRegisterByName,
  indexRegisterByPostcode,
  matchOrphans,
  type OrphanRow,
  type RegisterRow,
} from "../src/lib/charity-register/orphan-match.ts";
import { reportError } from "../src/lib/error-logging.ts";
import {
  DB_URL_VAR,
  SeedConfigError,
  SeedRefusedError,
  resolveSeedConfig,
} from "../src/lib/seed/config.ts";

function openRegister(): {
  all: <T>(sql: string, ...params: unknown[]) => T[];
  close: () => void;
} | null {
  const candidates = [
    process.env.REGISTER_DB_PATH?.trim(),
    join(process.cwd(), "data", "register.sqlite"),
    "/tmp/register.sqlite",
  ].filter((candidate): candidate is string => Boolean(candidate));
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) return null;
  const getBuiltin = (process as { getBuiltinModule?: (name: string) => unknown }).getBuiltinModule;
  if (typeof getBuiltin !== "function") return null;
  const mod = getBuiltin.call(process, "node:sqlite") as {
    DatabaseSync?: new (path: string, options?: { readOnly?: boolean }) => {
      prepare: (sql: string) => { all: (...params: unknown[]) => unknown[] };
      close: () => void;
    };
  };
  if (!mod?.DatabaseSync) return null;
  const db = new mod.DatabaseSync(path, { readOnly: true });
  return {
    all: <T,>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...params) as T[],
    close: () => db.close(),
  };
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const config = resolveSeedConfig(process.env);
  console.log(`[reidentify:orphans] target: ${config.target}${apply ? "" : " (dry run — nothing will be written)"}`);

  const register = openRegister();
  if (!register) {
    throw new SeedConfigError("data/register.sqlite is not present — run npm run register:fetch.");
  }

  const client = new Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    const { rows: orphans } = await client.query<OrphanRow>(`
      select o.id, o.legal_name, o.postcode
        from public.organisations as o
       where not o.is_seed
         and o.organisation_type = 'charity'
         and o.registered_on is null
         and not exists (
           select 1 from public.organisation_identifiers as i
            where i.organisation_id = o.id
              and i.identifier_type = 'uk_charity'
         )
    `);
    console.log(`Orphan charities (no charity number, never annotated): ${orphans.length}`);

    // is_cio and date_of_registration are what the older-registration tie-break
    // reads; without them that pass cannot fire and a name+postcode collision
    // stays unresolved.
    const registerRows = register.all<RegisterRow>(
      "select organisation_number, registered_charity_number, charity_name, postcode, " +
        "is_cio, date_of_registration from charity",
    );
    const matches = matchOrphans(
      orphans,
      indexRegisterByPostcode(registerRows),
      indexRegisterByName(registerRows),
    );

    const confident = matches.filter((match) => match.kind === "confident");
    const tieBroken = matches.filter((match) => match.kind === "tie-broken");
    const ambiguous = matches.filter((match) => match.kind === "ambiguous");
    const unmatched = matches.filter((match) => match.kind === "unmatched");
    console.log(`  confident matches: ${confident.length}`);
    console.log(`  tie-broken, older registration preferred: ${tieBroken.length}`);
    console.log(`  ambiguous (held for a human): ${ambiguous.length}`);
    console.log(`  unmatched: ${unmatched.length}`);
    const orphanName = new Map(orphans.map((row) => [row.id, row.legal_name]));
    for (const match of tieBroken) {
      if (match.kind !== "tie-broken") continue;
      console.log(`    chose ${match.registeredCharityNumber} for ${orphanName.get(match.orphanId) ?? match.orphanId}`);
      for (const candidate of match.candidates) {
        console.log(
          `      ${candidate.organisationNumber === match.organisationNumber ? "->" : "  "} ${candidate.registeredCharityNumber ?? "—"}` +
            ` registered ${candidate.dateOfRegistration ?? "?"}${candidate.isCio ? " (CIO)" : ""}`,
        );
      }
    }
    const unmatchedReasons = new Map<string, number>();
    for (const match of unmatched) {
      if (match.kind === "unmatched") {
        unmatchedReasons.set(match.reason, (unmatchedReasons.get(match.reason) ?? 0) + 1);
      }
    }
    for (const [reason, count] of [...unmatchedReasons].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${count.toString().padStart(5)}  ${reason}`);
    }
    for (const match of ambiguous.slice(0, 15)) {
      if (match.kind === "ambiguous") {
        console.log(`    ambiguous: ${match.legalName} (${match.candidates} candidates)`);
      }
    }
    if (ambiguous.length > 15) console.log(`    …and ${ambiguous.length - 15} more`);
    for (const match of unmatched.filter((m) => m.kind === "unmatched" && m.reason === "no-name-match").slice(0, 10)) {
      if (match.kind === "unmatched") console.log(`    no-name-match: ${match.legalName}`);
    }

    if (!apply) {
      console.log("\nDry run — nothing was written. Re-run with --apply to write.");
      return;
    }
    const chosen = matches.filter(
      (match) => match.kind === "confident" || match.kind === "tie-broken",
    );
    if (chosen.length === 0) {
      console.log("\nNothing to write.");
      return;
    }

    // Profile facts for the matched rows: the filed description,
    // registration date, reporting status, and the "what" labels the sector
    // mapping reads.
    const numbers = chosen.map((match) =>
      match.kind === "confident" || match.kind === "tie-broken" ? match.organisationNumber : 0,
    );
    const profiles = new Map<number, { activities: string | null; dateOfRegistration: string | null; reportingStatus: string | null; sector: string | null }>();
    for (const organisationNumber of numbers) {
      const [row] = register.all<{
        activities: string | null;
        date_of_registration: string | null;
        reporting_status: string | null;
      }>(
        "select activities, date_of_registration, reporting_status from charity where organisation_number = ?",
        organisationNumber,
      );
      const labels = register.all<{ value: string }>(
        "select l.value from label as l join charity_label as cl on cl.label_id = l.id " +
          "where cl.organisation_number = ? and l.kind = 'what'",
        organisationNumber,
      );
      profiles.set(organisationNumber, {
        activities: row?.activities?.trim() || null,
        dateOfRegistration: row?.date_of_registration?.slice(0, 10) || null,
        reportingStatus: row?.reporting_status?.trim() || null,
        sector: bulkSector(labels.map((label) => label.value)),
      });
    }

    await client.query("begin");
    try {
      // Re-check inside the transaction: skip anything that gained an
      // identifier or a profile value since the load.
      const { rows: stillOrphan } = await client.query<{ id: string }>(`
        select o.id from public.organisations as o
         where o.id = any($1)
           and o.charity_activities is null
           and o.registered_on is null
           and o.charity_reporting_status is null
           and not exists (
             select 1 from public.organisation_identifiers as i
              where i.organisation_id = o.id
                and i.identifier_type = 'uk_charity'
           )
      `, [chosen.map((match) => match.orphanId)]);
      const writable = new Set(stillOrphan.map((row) => row.id));

      let identifiers = 0;
      let profilesWritten = 0;
      for (const match of chosen) {
        if (!writable.has(match.orphanId)) continue;
        if (match.kind !== "confident" && match.kind !== "tie-broken") continue;
        const profile = profiles.get(match.organisationNumber);
        await client.query(
          `insert into public.organisation_identifiers
             (organisation_id, identifier_type, identifier_value, registry_country, is_primary, verified, created_at)
           values ($1, 'uk_charity', $2, 'GB', true, false, now())`,
          [match.orphanId, String(match.registeredCharityNumber)],
        );
        identifiers++;
        if (profile && (profile.activities || profile.dateOfRegistration || profile.reportingStatus || profile.sector)) {
          await client.query(
            `update public.organisations set
               charity_activities = coalesce(charity_activities, $2),
               registered_on = coalesce(registered_on, $3::date),
               charity_reporting_status = coalesce(charity_reporting_status, $4),
               sector = coalesce(sector, $5)
             where id = $1`,
            [match.orphanId, profile.activities, profile.dateOfRegistration, profile.reportingStatus, profile.sector],
          );
          profilesWritten++;
        }
      }
      await client.query("commit");
      console.log(`\nDone. Wrote ${identifiers} identifiers and register profiles for ${profilesWritten} charities.`);
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    }
  } finally {
    register.close();
    await client.end();
  }
}

main().catch(async (error: unknown) => {
  if (error instanceof SeedRefusedError) {
    console.error(`\n[reidentify:orphans] ${error.message}\n`);
    process.exit(1);
  }
  if (error instanceof SeedConfigError) {
    console.error(`\n[reidentify:orphans] Not configured: ${error.message} (${DB_URL_VAR})\n`);
    process.exit(1);
  }
  console.error("\n[reidentify:orphans] failed — no rows were written.");
  console.error(error);
  await reportError(error, { script: "reidentify-orphans", env: DB_URL_VAR });
  process.exit(1);
});
