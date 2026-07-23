/**
 * Minimal .xlsx reader — enough to pull text out of a spreadsheet, nothing more.
 *
 * An .xlsx file is a zip archive of XML documents. Everything needed to read one
 * is already in Node: `zlib` inflates the entries, and the XML we care about is
 * regular enough to match with expressions rather than a parser.
 *
 * This exists instead of a dependency on purpose. The alternatives each pull a
 * transitive tree (the popular one currently carries a flagged `uuid`) to do a
 * job this file does in a couple of hundred lines, for a script that only ever
 * runs on a developer's machine.
 *
 * Scope, deliberately narrow:
 *   - cell *text* only — numbers come back as their stored string form, and dates
 *     as the underlying serial number. The Data Model is prose and identifiers,
 *     so nothing in it needs more.
 *   - no formulas (cached values are read), no styles, no merged-cell expansion.
 *   - zip64 archives are rejected rather than mis-read.
 *
 * If a future spreadsheet needs more than this, that is the point to reach for a
 * real library — not to keep growing this one.
 */

import { inflateRawSync } from "node:zlib";

/** A worksheet as a rectangular grid of trimmed cell strings. */
export type Sheet = {
  name: string;
  /** Row-major. Short rows are padded so every row has the same length. */
  rows: string[][];
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;

const STORED = 0;
const DEFLATED = 8;

/** Reads a zip archive into a map of entry name to uncompressed bytes. */
function readZipEntries(archive: Buffer): Map<string, Buffer> {
  // The end-of-central-directory record sits at the very end, after a comment of
  // unknown length, so it has to be found by scanning backwards for its signature.
  // The comment is capped at 64 KiB by the format, which bounds the scan.
  const maxCommentLength = 0xffff;
  const scanFrom = Math.max(0, archive.length - maxCommentLength - 22);
  let eocd = -1;
  for (let offset = archive.length - 22; offset >= scanFrom; offset -= 1) {
    if (archive.readUInt32LE(offset) === EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd === -1) {
    throw new Error("Not a zip archive: no end-of-central-directory record found.");
  }

  if (
    eocd >= 20 &&
    archive.readUInt32LE(eocd - 20) === ZIP64_EOCD_LOCATOR_SIGNATURE
  ) {
    throw new Error(
      "This spreadsheet is a zip64 archive, which this reader does not support.",
    );
  }

  const entryCount = archive.readUInt16LE(eocd + 10);
  let cursor = archive.readUInt32LE(eocd + 16);

  const entries = new Map<string, Buffer>();

  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(cursor) !== CENTRAL_FILE_SIGNATURE) {
      throw new Error(`Corrupt zip: bad central directory entry at ${cursor}.`);
    }

    const compressionMethod = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localHeaderOffset = archive.readUInt32LE(cursor + 42);
    const name = archive
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString("utf8");

    // The local header repeats the name and extra fields, and its own lengths are
    // the authoritative ones — the central directory's extra field can differ.
    if (archive.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_SIGNATURE) {
      throw new Error(`Corrupt zip: bad local header for ${name}.`);
    }
    const localNameLength = archive.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = archive.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const data = archive.subarray(dataStart, dataStart + compressedSize);

    if (compressionMethod === STORED) {
      entries.set(name, Buffer.from(data));
    } else if (compressionMethod === DEFLATED) {
      entries.set(name, inflateRawSync(data));
    }
    // Any other method (bzip2, lzma) is not produced by spreadsheet software;
    // skipping leaves the entry absent, which surfaces as a clear error later.

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Resolves XML character and named entities in text content. */
export function decodeXmlText(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return String.fromCodePoint(parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCodePoint(parseInt(entity.slice(1), 10));
    }
    return XML_ENTITIES[entity] ?? match;
  });
}

/** Concatenates the text of every `<t>` element in a fragment. */
function collectText(fragment: string): string {
  let text = "";
  for (const match of fragment.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) {
    text += decodeXmlText(match[1] ?? "");
  }
  return text;
}

/**
 * Parses the shared string table. Cells store text by index into this table
 * rather than inline, so it has to be read before any sheet can be understood.
 * A string split into formatting runs (`<r>` elements) is rejoined.
 */
function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return Array.from(xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)).map(
    (match) => collectText(match[1] ?? ""),
  );
}

/** Converts a cell reference's column letters to a zero-based index: A→0, AB→27. */
export function columnIndex(reference: string): number {
  const letters = /^([A-Z]+)/.exec(reference)?.[1] ?? "A";
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index - 1;
}

/** Parses one worksheet into a padded grid. */
function parseSheet(name: string, xml: string, sharedStrings: string[]): Sheet {
  const rows: string[][] = [];
  let width = 0;

  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];

    // The attribute capture is lazy so a self-closing `<c .../>` matches the
    // `/>` branch. A greedy `[^>]*` would swallow the closing slash, fail to
    // self-close, and consume the following cell as this one's body — dropping the
    // empty cell and shifting every column after it left by one.
    for (const cellMatch of (rowMatch[1] ?? "").matchAll(
      /<c\b([^>]*?)\s*(?:\/>|>([\s\S]*?)<\/c>)/g,
    )) {
      const attributes = cellMatch[1] ?? "";
      const body = cellMatch[2] ?? "";
      const reference = /\br="([A-Z]+\d+)"/.exec(attributes)?.[1];
      const type = /\bt="([^"]+)"/.exec(attributes)?.[1];

      let value: string;
      if (type === "s") {
        // Shared string: the value is an index into the shared string table.
        const index = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
        value = sharedStrings[index] ?? "";
      } else if (type === "inlineStr") {
        value = collectText(body);
      } else {
        // Number, boolean, date serial, or a formula's cached result.
        value = decodeXmlText(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
      }

      // Empty cells are omitted from the XML entirely, so a cell's column has to
      // come from its reference. Without this, a row with a gap would shift left
      // and silently misalign every column after it.
      const target = reference ? columnIndex(reference) : cells.length;
      while (cells.length < target) cells.push("");
      cells[target] = value.trim();
    }

    width = Math.max(width, cells.length);
    rows.push(cells);
  }

  // Pad every row to the widest, so consumers can index columns without checking.
  for (const row of rows) {
    while (row.length < width) row.push("");
  }

  return { name, rows };
}

/**
 * Reads every worksheet from an .xlsx file, in the order the workbook defines.
 *
 * @param archive the raw file contents
 */
export function readWorkbook(archive: Buffer): Sheet[] {
  const entries = readZipEntries(archive);

  const workbookXml = entries.get("xl/workbook.xml")?.toString("utf8");
  if (!workbookXml) {
    throw new Error("Not an .xlsx file: xl/workbook.xml is missing.");
  }

  // Sheets are named in workbook.xml but their file paths live in the rels file,
  // keyed by relationship id. Neither is derivable from the other.
  const relsXml = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const targetsById = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const attributes = match[1] ?? "";
    const id = /\bId="([^"]+)"/.exec(attributes)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(attributes)?.[1];
    if (id && target) {
      targetsById.set(id, target.replace(/^\/?xl\//, "").replace(/^\.\//, ""));
    }
  }

  const sharedStrings = parseSharedStrings(
    entries.get("xl/sharedStrings.xml")?.toString("utf8"),
  );

  const sheets: Sheet[] = [];
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const attributes = match[1] ?? "";
    const name = decodeXmlText(/\bname="([^"]*)"/.exec(attributes)?.[1] ?? "");
    const relationshipId = /\br:id="([^"]+)"/.exec(attributes)?.[1] ?? "";
    const target = targetsById.get(relationshipId);
    const xml = target ? entries.get(`xl/${target}`)?.toString("utf8") : undefined;
    if (!xml) continue;
    sheets.push(parseSheet(name, xml, sharedStrings));
  }

  if (sheets.length === 0) {
    throw new Error("No readable worksheets found in the workbook.");
  }

  return sheets;
}
