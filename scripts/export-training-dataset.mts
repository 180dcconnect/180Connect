/**
 * Exports the ML-ready training dataset (F098) to CSV.
 *
 *     npm run export:training-dataset                    # stdout
 *     npm run export:training-dataset -- --out data.csv  # file
 *     npm run export:training-dataset -- --labeled-only  # drop null labels
 *
 * Reads public.training_examples — the F098 view that joins SCORE_SNAPSHOTS'
 * send-time feature vectors to their OUTCOMES labels with an allowlist of
 * non-personal columns. This script adds no columns and transforms no values:
 * what lands in the CSV is exactly what the view exposes, which is exactly
 * what its migration's privacy block allowlists.
 *
 * Uses pg directly (same as backfill:scores) so RLS is not in the way and
 * there is no PostgREST row ceiling; reuses the seed config guard so pointing
 * it at production refuses loudly rather than exporting client data.
 */

import { Client } from "pg";
import {
  SeedConfigError,
  SeedRefusedError,
  resolveSeedConfig,
} from "../src/lib/seed/config.ts";

type TrainingExampleRow = Record<string, string | number | boolean | null>;

function parseArgs(argv: readonly string[]): {
  out?: string;
  labeledOnly: boolean;
} {
  const args = [...argv];
  const outIndex = args.indexOf("--out");
  const out = outIndex > -1 ? args[outIndex + 1] : undefined;
  if (outIndex > -1 && !out) {
    throw new Error("--out requires a file path argument.");
  }
  return { out, labeledOnly: args.includes("--labeled-only") };
}

/** RFC 4180: quote anything holding a comma, quote, or newline; double quotes. */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function main(): Promise<void> {
  const { out, labeledOnly } = parseArgs(process.argv.slice(2));

  // Throws against production, same guard as the seeder — an ML export is a
  // bulk read of client-derived data and deserves the same refusal.
  let config;
  try {
    config = resolveSeedConfig(process.env);
  } catch (error) {
    if (error instanceof SeedRefusedError || error instanceof SeedConfigError) {
      console.error(`[export:training] refused: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const client = new Client({ connectionString: config.databaseUrl });
  await client.connect();

  try {
    const { rows } = await client.query<TrainingExampleRow>(
      `
      select *
        from public.training_examples
       ${labeledOnly ? "where outcome_label is not null" : ""}
       order by snapshot_scored_at
      `,
    );

    if (rows.length === 0) {
      console.error("[export:training] no rows — nothing to export.");
      process.exitCode = 1;
      return;
    }

    const header = Object.keys(rows[0]);
    const csv = [
      header.join(","),
      ...rows.map((row) => header.map((key) => csvField(row[key])).join(",")),
    ].join("\r\n");

    if (out) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(out, csv + "\r\n");
      console.log(`[export:training] ${rows.length} rows -> ${out}`);
    } else {
      console.log(csv);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("[export:training] failed:", error);
  process.exitCode = 1;
});
