/**
 * Exports the Data Model spreadsheet to markdown under `docs/data-model/`.
 *
 *     npm run export:data-model
 *     npm run export:data-model -- "~/Downloads/Data Model.xlsx"
 *
 * The spreadsheet stays the single source of truth for the schema (SOP §7). This
 * script produces a *readable projection* of it that lives in the repository, so
 * that:
 *
 *   - a schema change shows up as a line diff in the pull request, which is what
 *     the SOP §7 approval record asks the reviewer to check;
 *   - anyone (or any AI assistant) working in the repo can grep the schema without
 *     opening Excel;
 *   - a new developer gets the schema by cloning.
 *
 * The .xlsx itself is deliberately not committed: it is ~1.3 MB, of which ~1.2 MB
 * is three System Map images, and being binary it cannot be diffed or merged —
 * two people editing it in the same week means one of them silently loses work.
 *
 * Generated files carry a "do not edit" banner. Edit the spreadsheet and re-run.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readWorkbook, type Sheet } from "./lib/xlsx.mts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = join(REPO_ROOT, "docs", "data-model");

/** Where the spreadsheet is looked for when no path is given. */
const DEFAULT_DIR = join(homedir(), "Downloads");
const DEFAULT_PATTERN = /^Data Model.*\.xlsx$/i;

const BANNER = (source: string) =>
  `<!--\n` +
  `  GENERATED FILE — DO NOT EDIT.\n` +
  `  Source: ${source} (the Data Model spreadsheet is the source of truth, per SOP §7).\n` +
  `  To change anything here: edit the spreadsheet, then run \`npm run export:data-model\`.\n` +
  `-->\n`;

/** Turns a sheet name into a stable file name: "04 Entities " -> "04-entities". */
export function slugifySheetName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Escapes a cell so it cannot break out of a markdown table row. */
function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>").trim();
}

function isRowEmpty(row: readonly string[]): boolean {
  return row.every((cell) => cell === "");
}

/** Drops trailing columns that are empty across the whole sheet. */
function trimColumns(rows: string[][]): string[][] {
  let width = 0;
  for (const row of rows) {
    for (let index = row.length - 1; index >= 0; index -= 1) {
      if (row[index] !== "") {
        width = Math.max(width, index + 1);
        break;
      }
    }
  }
  return rows.map((row) => row.slice(0, width));
}

/**
 * Renders a sheet as markdown.
 *
 * The Data Model tabs are not one flat table: each is a run of blocks, where a row
 * holding a single value (an entity name such as `ORGANISATIONS`) introduces the
 * block, the next row is that block's column header, and the rest are its fields.
 * That shape is reproduced here as a heading followed by a table.
 */
export function renderSheet(sheet: Sheet): string {
  const rows = trimColumns(sheet.rows.filter((row) => !isRowEmpty(row)));
  const lines: string[] = [`# ${sheet.name.trim()}`, ""];

  let pendingHeader = true;

  for (const row of rows) {
    const populated = row.filter((cell) => cell !== "");

    // A lone value on its own row introduces a new block.
    if (populated.length === 1 && row[0] !== "") {
      lines.push("", `## ${row[0]}`, "");
      pendingHeader = true;
      continue;
    }

    const cells = row.map(escapeCell);

    if (pendingHeader) {
      lines.push(`| ${cells.join(" | ")} |`);
      lines.push(`| ${cells.map(() => ":---").join(" | ")} |`);
      pendingHeader = false;
      continue;
    }

    lines.push(`| ${cells.join(" | ")} |`);
  }

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/** Builds the index that explains what the directory is and lists the tabs. */
function renderIndex(sheets: readonly Sheet[], source: string): string {
  const rows = sheets.map((sheet) => {
    const populated = sheet.rows.filter((row) => !isRowEmpty(row)).length;
    return `| [${sheet.name.trim()}](${slugifySheetName(sheet.name)}.md) | ${populated} |`;
  });

  return `# Data Model

Markdown export of the Data Model spreadsheet — the source of truth for the
180Connect schema (SOP §7).

**These files are generated. Do not edit them.** Change the spreadsheet, then:

\`\`\`bash
npm run export:data-model
\`\`\`

and commit the result alongside your migration. A schema change should be visible
as a line diff in the pull request, so the reviewer can check the migration against
it — that is what the SOP §7 approval record asks for.

The \`.xlsx\` itself is not committed. It is binary (no diff, no merge — two people
editing it in one week means one of them loses work silently) and ~1.3 MB, mostly
System Map images. Keep your copy wherever the team shares it; this export is the
version the repository and its tooling read.

| Tab | Rows |
| :--- | ---: |
${rows.join("\n")}

Source spreadsheet: \`${source}\`
`;
}

function resolveSourcePath(argument: string | undefined): string {
  const candidate = argument ?? process.env.DATA_MODEL_XLSX;

  if (candidate) {
    const expanded = candidate.startsWith("~")
      ? join(homedir(), candidate.slice(1))
      : candidate;
    if (!existsSync(expanded)) {
      throw new Error(`Spreadsheet not found: ${expanded}`);
    }
    return resolve(expanded);
  }

  const matches = existsSync(DEFAULT_DIR)
    ? readdirSync(DEFAULT_DIR)
        .filter((file) => DEFAULT_PATTERN.test(file))
        .sort()
    : [];

  const hint =
    "  Pass the path explicitly:\n" +
    '    npm run export:data-model -- "/path/to/Data Model.xlsx"\n' +
    "  or set DATA_MODEL_XLSX in your environment.";

  if (matches.length === 1) return join(DEFAULT_DIR, matches[0]);

  // Browsers name a re-download "Data Model-2.xlsx" and leave the original in
  // place. Picking one automatically would sooner or later export the stale copy
  // and make the repository disagree with the spreadsheet without anyone noticing.
  if (matches.length > 1) {
    const listed = matches
      .map((file) => {
        const modified = statSync(join(DEFAULT_DIR, file)).mtime.toISOString();
        return `    ${file}  (modified ${modified})`;
      })
      .join("\n");
    throw new Error(
      `Found ${matches.length} candidate spreadsheets in ${DEFAULT_DIR} and will not ` +
        `guess which is current:\n${listed}\n` +
        "  Delete the stale copies, or name the one you want.\n" +
        hint,
    );
  }

  throw new Error(
    `Could not find the Data Model spreadsheet in ${DEFAULT_DIR}.\n${hint}`,
  );
}

function main(): void {
  const sourcePath = resolveSourcePath(process.argv[2]);
  const sheets = readWorkbook(readFileSync(sourcePath));
  const sourceLabel = sourcePath.replace(homedir(), "~").replaceAll("\\", "/");

  mkdirSync(OUTPUT_DIR, { recursive: true });

  // Remove previously generated files first, so a tab deleted from the spreadsheet
  // does not linger in the repository as a stale, believable-looking document.
  for (const file of readdirSync(OUTPUT_DIR)) {
    if (file.endsWith(".md")) unlinkSync(join(OUTPUT_DIR, file));
  }

  const exported: Sheet[] = [];
  for (const sheet of sheets) {
    if (sheet.rows.every(isRowEmpty)) {
      console.log(`[data-model] skipped ${sheet.name.trim()} — no text content`);
      continue;
    }
    const file = `${slugifySheetName(sheet.name)}.md`;
    writeFileSync(
      join(OUTPUT_DIR, file),
      `${BANNER(sourceLabel)}\n${renderSheet(sheet)}`,
    );
    exported.push(sheet);
    console.log(`[data-model] wrote docs/data-model/${file}`);
  }

  writeFileSync(join(OUTPUT_DIR, "README.md"), renderIndex(exported, sourceLabel));
  console.log(`[data-model] wrote docs/data-model/README.md`);
  console.log(`[data-model] ${exported.length} tabs exported from ${sourceLabel}`);
}

// Only run when invoked directly, not when imported by the tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`\n[data-model] ${(error as Error).message}\n`);
    process.exit(1);
  }
}
