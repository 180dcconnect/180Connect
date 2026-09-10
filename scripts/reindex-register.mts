/**
 * Brings an existing register file's indexes up to date, in place.
 *
 *     npm run register:reindex
 *     npm run register:reindex -- --file /path/to/register.sqlite
 *
 * ── Why this exists rather than "just rebuild it" ──
 *
 * `npm run register:build` regenerates the whole file from the regulator's
 * extract and takes about twelve minutes, most of it spent parsing 2.3 million
 * rows that have not changed. Adding an index to 171,800 charities takes about
 * 200ms. When the only thing that has moved is `REGISTER_SCHEMA_INDEXES`, a
 * rebuild is twelve minutes spent to produce a byte-identical table set.
 *
 * So: download the published asset, run this, upload it back. The alternative
 * is leaving the deployed file un-indexed until the next scheduled rebuild,
 * during which every client profile view pays a full table scan.
 *
 * ── Safe to run more than once ──
 *
 * Every statement in `REGISTER_SCHEMA_INDEXES` is `create index if not exists`,
 * so running this against an already-current file does nothing and says so.
 * It never writes a row, only indexes, and it leaves `schema_version` alone —
 * indexes are not part of the shape the version guards, and bumping it would
 * make every deployed build reject the file it already has.
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync, statSync } from "node:fs";

import { REGISTER_SCHEMA_INDEXES } from "../src/lib/charity-register/sqlite-schema.ts";

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

const file = arg("file") ?? process.env.REGISTER_DB_PATH?.trim() ?? "data/register.sqlite";

if (!existsSync(file)) {
  console.error(`No register file at ${file}.`);
  console.error("Fetch it with `npm run register:fetch`, or pass --file <path>.");
  process.exit(1);
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

const before = statSync(file).size;
const db = new DatabaseSync(file);

const indexNames = () =>
  (db.prepare("select name from sqlite_master where type = 'index'").all() as { name: string }[])
    .map((row) => row.name)
    .filter((name) => !name.startsWith("sqlite_autoindex_"));

const had = new Set(indexNames());

const started = Date.now();
db.exec(REGISTER_SCHEMA_INDEXES);
const elapsed = Date.now() - started;

const added = indexNames().filter((name) => !had.has(name));
db.close();

const after = statSync(file).size;

if (added.length === 0) {
  console.log(`${file} already has every index in REGISTER_SCHEMA_INDEXES. Nothing to do.`);
} else {
  console.log(`Added ${added.length} index(es) to ${file} in ${elapsed}ms:`);
  for (const name of added) console.log(`  - ${name}`);
  console.log(`Size ${megabytes(before)} -> ${megabytes(after)}.`);
  console.log("Upload this file back to the `charity-register` release to deploy it.");
}
