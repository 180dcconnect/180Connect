/**
 * Builds the companies register as a single read-only SQLite file.
 *
 *     npm run companies-register:build
 *     npm run companies-register:build -- --dir /path/to/unzipped --out data/companies-register.sqlite
 *     npm run companies-register:build -- --month 2026-09 --out data/companies-register.sqlite
 *
 * This runs in CI (.github/workflows/refresh-companies-register.yml), not on
 * anyone's laptop. Nobody on the team should ever need to type this.
 *
 * ── Why a filtered file and not the whole register ──
 *
 * The Basic Company Data product holds ~5.2M live companies (~2GB of CSV).
 * Stored whole, the SQLite file would be ~1GB — unshippable inside the
 * deployment the way the 182MB charity file is. So the build keeps only
 * mission-plausible companies (see isCoveredCompany: Tier A legal forms,
 * CICs, Tier C legal forms, and any company whose SIC intersects the
 * build-time superset) — about 12% of the register, ~690k rows, ~180MB.
 * The import screen then does the actual choosing, over that subset.
 *
 * ── No redaction here, deliberately ──
 *
 * Same contract as the charity build: the file mirrors a public product, and
 * the data-handling rules (F246/F247) run when companies enter our store
 * (src/lib/companies-register/import.ts, Phase B). The CI job needs no
 * database credentials. The product carries no contact details anyway.
 *
 * ── New category wording ──
 *
 * A `CompanyCategory` the map has never seen is stored as slug "other" with
 * its raw wording preserved, counted loudly in the summary and recorded in
 * `meta.unmapped_categories`. Nothing is lost — a later rebuild with an
 * updated map recovers it — but a brand-new Tier A wording degrades to
 * review-routing rather than auto-include until someone looks. The unit test
 * on CATEGORY_TO_SLUG pins the last census so it breaks loudly first.
 */

import { DatabaseSync } from "node:sqlite";
import { createWriteStream, mkdirSync, rmSync, statSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Unzip, UnzipInflate } from "fflate";

import {
  CATEGORY_TO_SLUG,
  createCsvRecordStream,
  indexCsvHeader,
  isCoveredCompany,
  rowToExtractCompany,
  type CompaniesCsvHeader,
  type ExtractCompany,
} from "../src/lib/companies-register/csv-row.ts";
import { postcodeAreaOf } from "../src/lib/charity-register/extract-rows.ts";
import {
  COMPANIES_SCHEMA,
  COMPANIES_SCHEMA_INDEXES,
  COMPANIES_SCHEMA_VERSION,
} from "../src/lib/companies-register/sqlite-schema.ts";
import { TIER_C_SIC_ALLOWLIST } from "../src/lib/ingestion/sources/companies-house-criteria-config.ts";

const SIC_SUPERSET: ReadonlySet<string> = new Set(TIER_C_SIC_ALLOWLIST);

function flag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : "";
}

const OUT = flag("out") || "data/companies-register.sqlite";
const LOCAL_DIR = flag("dir") || null;
const MONTH_OVERRIDE = flag("month") || null;

const OUTPUT_PAGE = "https://download.companieshouse.gov.uk/en_output.html";
const DECODER_CHUNK = 64 * 1024;

type PartFile = { url: string; name: string };

/** The part ZIPs published for one month, read off the download index page. */
async function discoverParts(month: string): Promise<PartFile[]> {
  const response = await fetch(OUTPUT_PAGE, {
    signal: AbortSignal.timeout(30_000),
    headers: { "User-Agent": "180Connect register build" },
  });
  if (!response.ok) {
    throw new Error(`Companies House download index returned ${response.status}`);
  }
  const html = await response.text();
  const pattern = new RegExp(
    `BasicCompanyData-${month}-01-part(\\d+)_(\\d+)\\.zip`,
    "g",
  );
  const parts = new Map<string, PartFile>();
  for (const match of html.matchAll(pattern)) {
    const name = match[0];
    if (!parts.has(name)) {
      parts.set(name, { url: `https://download.companieshouse.gov.uk/${name}`, name });
    }
  }
  return [...parts.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function previousMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, mon - 1, 1));
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** Newest month with a published snapshot, trying back up to three months. */
async function resolveMonth(): Promise<{ month: string; parts: PartFile[] }> {
  if (MONTH_OVERRIDE) {
    if (!/^\d{4}-\d{2}$/.test(MONTH_OVERRIDE)) {
      throw new Error(`--month must be YYYY-MM, got ${JSON.stringify(MONTH_OVERRIDE)}`);
    }
    const parts = await discoverParts(MONTH_OVERRIDE);
    if (parts.length === 0) throw new Error(`No snapshot published for ${MONTH_OVERRIDE}`);
    return { month: MONTH_OVERRIDE, parts };
  }
  let month = currentMonth();
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = await discoverParts(month);
    if (parts.length > 0) return { month, parts };
    month = previousMonth(month);
  }
  throw new Error("No Companies House snapshot found for the last three months");
}

async function downloadToTemp(part: PartFile): Promise<string> {
  const path = join(tmpdir(), `companies-register-${part.name}`);
  const response = await fetch(part.url, {
    headers: { "User-Agent": "180Connect register build" },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download of ${part.name} returned ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(path));
  return path;
}

async function main(): Promise<void> {
  const started = Date.now();
  mkdirSync(dirname(OUT), { recursive: true });
  try {
    rmSync(OUT);
  } catch {
    // First run, or already gone.
  }

  const db = new DatabaseSync(OUT);
  // Safe because a failed build throws the file away and starts again: there
  // is no state here worth crash-protecting, and the difference is minutes.
  db.exec("pragma journal_mode = off; pragma synchronous = off;");
  db.exec(COMPANIES_SCHEMA);

  const insertCompany = db.prepare(
    `insert or replace into company (
      number, name, cat_slug, status_raw, status_norm,
      incorp_date, postcode, postcode_area, town, address_line_1, is_cic
    ) values (?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const insertSic = db.prepare("insert into company_sic (number, sic) values (?, ?)");
  const insertSicLabel = db.prepare(
    "insert or ignore into sic_label (sic, title) values (?, ?)",
  );

  let scanned = 0;
  let kept = 0;
  let sicLinks = 0;
  let sicLabels = 0;
  let replaced = 0;
  const unmapped = new Map<string, number>();
  const sources: { kind: "csv"; path: string }[] = [];
  let sourceMonth = "local";

  if (LOCAL_DIR) {
    for (const entry of readdirSync(LOCAL_DIR).sort()) {
      if (entry.endsWith(".csv")) sources.push({ kind: "csv", path: join(LOCAL_DIR, entry) });
    }
    if (sources.length === 0) throw new Error(`--dir ${LOCAL_DIR} holds no .csv files`);
  } else {
    const { month, parts } = await resolveMonth();
    sourceMonth = month;
    console.log(`[companies-register:build] snapshot ${month}, ${parts.length} parts`);
    for (const part of parts) {
      console.log(`[companies-register:build] downloading ${part.name}`);
      const zipPath = await downloadToTemp(part);
      try {
        await ingestZip(zipPath);
      } finally {
        rmSync(zipPath, { force: true });
      }
    }
  }

  for (const source of sources) {
    await ingestCsvFile(source.path);
  }

  async function ingestRecords(
    next: (push: (record: string[]) => void) => Promise<void> | void,
  ): Promise<void> {
    let header: CompaniesCsvHeader | null = null;
    let first = true;
    db.exec("begin");
    await next((record) => {
      if (first) {
        first = false;
        header = indexCsvHeader(record);
        return;
      }
      scanned += 1;
      const company = rowToExtractCompany(record, header as CompaniesCsvHeader, postcodeAreaOf);
      if (!company) return;
      if (!isCoveredCompany(company.categoryRaw, company.sicCodes, SIC_SUPERSET)) return;
      writeCompany(company);
      if (scanned % 500_000 === 0) {
        db.exec("commit");
        db.exec("begin");
        console.log(
          `[companies-register:build] ${scanned.toLocaleString()} scanned, ` +
            `${kept.toLocaleString()} kept`,
        );
      }
    });
    db.exec("commit");
  }

  function writeCompany(company: ExtractCompany): void {
    if (!(company.categoryRaw in CATEGORY_TO_SLUG)) {
      unmapped.set(company.categoryRaw, (unmapped.get(company.categoryRaw) ?? 0) + 1);
    }
    const before = db
      .prepare("select 1 from company where number = ?")
      .get(company.companyNumber);
    if (before) replaced += 1;
    insertCompany.run(
      company.companyNumber,
      company.companyName,
      company.categorySlug,
      company.statusRaw,
      company.statusNorm,
      company.incorporationDate,
      company.postcode,
      company.postcodeArea,
      company.town,
      company.addressLine1,
      company.isCic ? 1 : 0,
    );
    for (const sic of company.sicCodes) {
      insertSic.run(company.companyNumber, sic);
      sicLinks += 1;
    }
    // First-seen title wins; every part repeats the same "code - description"
    // text, and OR IGNORE keeps the earliest without a lookup round trip.
    // Codes with no description anywhere ("None Supplied" never reaches here,
    // but a bare code could) are labelled with the code itself below.
    for (const [sic, title] of Object.entries(company.sicTitles)) {
      if (!title) continue;
      const info = insertSicLabel.run(sic, title);
      if (Number(info.changes) > 0) sicLabels += 1;
    }
    kept += 1;
  }

  async function ingestZip(zipPath: string): Promise<void> {
    await ingestRecords(async (push) => {
      // Collect-then-push per zip would hold 400MB; instead the unzip pump
      // below pushes decompressed text straight into the record stream. The
      // indirection through `push` keeps one ingestion path for zips and
      // plain CSVs.
      const { open } = await import("node:fs/promises");
      const handle = await open(zipPath, "r");
      try {
        const stat = await handle.stat();
        const buffer = Buffer.alloc(DECODER_CHUNK);
        const decoder = new TextDecoder("utf-8");
        const stream = createCsvRecordStream(push);
        const unzip = new Unzip((entry) => {
          if (!entry.name.endsWith(".csv")) return;
          // fflate invokes ondata synchronously inside unzip.push, but a throw
          // there does not reliably unwind the pump — the charity bulk reader
          // learned this first. Failures are captured and rethrown after the
          // push loop instead, where they abort the build loudly.
          entry.ondata = (err, chunk, final) => {
            if (failure) return;
            try {
              if (err) throw err instanceof Error ? err : new Error(String(err));
              stream.push(decoder.decode(chunk, { stream: !final }));
              if (final) {
                stream.push(decoder.decode());
                stream.end();
              }
            } catch (error) {
              failure = error instanceof Error ? error : new Error(String(error));
            }
          };
          entry.start();
        });
        unzip.register(UnzipInflate);
        let failure: Error | null = null;
        let position = 0;
        while (position < stat.size) {
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
          if (bytesRead === 0) break;
          position += bytesRead;
          unzip.push(new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead), false);
          if (failure) throw failure;
        }
        unzip.push(new Uint8Array(0), true);
        if (failure) throw failure;
      } finally {
        await handle.close();
      }
    });
  }

  async function ingestCsvFile(path: string): Promise<void> {
    const { open } = await import("node:fs/promises");
    console.log(`[companies-register:build] reading ${path}`);
    await ingestRecords(async (push) => {
      const handle = await open(path, "r");
      try {
        const stat = await handle.stat();
        const buffer = Buffer.alloc(DECODER_CHUNK);
        const decoder = new TextDecoder("utf-8");
        const stream = createCsvRecordStream(push);
        let position = 0;
        while (position < stat.size) {
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
          if (bytesRead === 0) break;
          position += bytesRead;
          stream.push(decoder.decode(buffer.subarray(0, bytesRead), { stream: true }));
        }
        stream.push(decoder.decode());
        stream.end();
      } finally {
        await handle.close();
      }
    });
  }

  // Codes whose description never appeared (a bare code with no " - title"
  // anywhere in the file) are labelled with the code itself, so the SIC
  // picker always has text to show and never a blank row.
  const untitled = db
    .prepare("select distinct sic from company_sic where sic not in (select sic from sic_label)")
    .all() as { sic: string }[];
  for (const row of untitled) {
    insertSicLabel.run(row.sic, row.sic);
  }

  // Indexes last: building them once over a full table is far cheaper than
  // maintaining them across hundreds of thousands of inserts.
  db.exec(COMPANIES_SCHEMA_INDEXES);

  const builtOn = new Date().toISOString().slice(0, 10);
  const setMeta = db.prepare("insert or replace into meta (key, value) values (?, ?)");
  setMeta.run("built_on", builtOn);
  setMeta.run("source_month", sourceMonth);
  setMeta.run("companies", String(kept));
  setMeta.run("sic_links", String(sicLinks));
  setMeta.run("sic_labels", String(sicLabels + untitled.length));
  setMeta.run("sic_superset_count", String(SIC_SUPERSET.size));
  setMeta.run("replaced_duplicates", String(replaced));
  setMeta.run("unmapped_categories", JSON.stringify([...unmapped.entries()]));
  setMeta.run("schema_version", COMPANIES_SCHEMA_VERSION);

  // ANALYZE before VACUUM: without planner statistics SQLite guesses at the
  // SIC filter's `sic in (...)` and can pick a full scan. The stats table is
  // a few KB and is what keeps a filtered count in milliseconds.
  db.exec("analyze");
  db.exec("vacuum");
  db.close();

  const megabytes = statSync(OUT).size / 1_048_576;
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(
    `\n[companies-register:build] wrote ${OUT} — ${megabytes.toFixed(1)}MB in ${Math.floor(seconds / 60)}m ${seconds % 60}s\n` +
      `  source month      ${sourceMonth}\n` +
      `  scanned           ${scanned.toLocaleString()}\n` +
      `  companies kept    ${kept.toLocaleString()}\n` +
      `  sic links         ${sicLinks.toLocaleString()}\n` +
      `  replaced dups     ${replaced.toLocaleString()}\n` +
      `  unmapped          ${unmapped.size === 0 ? "none" : JSON.stringify([...unmapped.entries()])}\n\n` +
      `Only mission-plausible companies are stored. The import screen decides what to take from these.`,
  );
  if (unmapped.size > 0) {
    console.log(
      `[companies-register:build] WARNING: ${unmapped.size} unmapped categories stored as slug "other" — update CATEGORY_TO_SLUG and rebuild.`,
    );
  }
}

await main();
