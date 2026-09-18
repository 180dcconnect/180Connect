/**
 * Streaming reader for the Charity Commission's daily bulk extracts.
 *
 * Read by the register build (scripts/build-register-sqlite.mts), which runs in
 * CI once a month and turns these files into the SQLite register the app ships
 * with.
 *
 * ── Why streaming ──
 *
 * The extracts are large enough that holding one in memory is not an option:
 * 508MB of charities, 1.26GB of Part A annual returns (measured 2026-09-03).
 * The build writes as it reads, so peak memory is one chunk plus whatever the
 * caller accumulates.
 *
 * ── Shape ──
 *
 * Each extract is a JSON array printed one object per line: "[{…}" then ",{…}"
 * then "…}]". So the parser is readline plus stripped array punctuation — no
 * streaming JSON parser, constant memory, and a malformed line costs one record
 * rather than the run.
 *
 * The zips are read with fflate's streaming Unzip: Node's zlib does gzip, not
 * zip archives, and buffering a 508MB member to call a one-shot unzip would put
 * back the memory problem this design exists to avoid.
 */

import { Unzip, UnzipInflate } from "fflate";

/** The extract files, and the names this codebase refers to them by. */
export const EXTRACTS = {
  charity: "publicextract.charity",
  classification: "publicextract.charity_classification",
  areaOfOperation: "publicextract.charity_area_of_operation",
  annualReturnPartA: "publicextract.charity_annual_return_parta",
  annualReturnPartB: "publicextract.charity_annual_return_partb",
} as const;

export type ExtractName = keyof typeof EXTRACTS;

export const EXTRACT_BASE_URL =
  "https://ccewuksprdoneregsadata1.blob.core.windows.net/data/json";

export type ExtractSource = {
  /**
   * Read already-unzipped .json files from this directory instead of
   * downloading ~100MB again. For tests, and for a second run in one day.
   */
  localDir?: string;
  /** Injected for tests. Defaults to global fetch with a retry policy. */
  fetchImpl?: (url: string) => Promise<Response>;
};

const DECODER = new TextDecoder();

/** Strips the array punctuation a line carries, or returns "" for a non-element. */
export function trimElement(line: string): string {
  // The BOM is only on the first line, and only the first line starts with "[".
  // \uFEFF as an escape, not a literal BOM: the raw character is invisible in
  // review and confuses editors into re-encoding the file.
  const text = line.replace(/^\uFEFF/, "").trim();
  const body = text.startsWith("[")
    ? text.slice(1)
    : text.startsWith(",")
      ? text.slice(1)
      : text;
  const withoutTail = body.endsWith("]") ? body.slice(0, -1) : body;
  const trimmed = withoutTail.trim().replace(/,$/, "");
  return trimmed.startsWith("{") ? trimmed : "";
}

/** Parses a line, or returns null — one bad row must not end a 400k-row pass. */
export function parseRow<T>(line: string): T | null {
  try {
    return JSON.parse(line) as T;
  } catch {
    return null;
  }
}

async function defaultFetch(url: string): Promise<Response> {
  const response = await fetch(url, { signal: AbortSignal.timeout(600_000) });
  if (!response.ok) {
    throw new Error(`Charity Commission extract ${url} returned ${response.status}`);
  }
  return response;
}

/**
 * Yields each record of one extract, already parsed.
 *
 * Rows that fail to parse are skipped silently — at 662,653 rows a single
 * malformed line is not a reason to abandon a snapshot, and the count of what
 * was read is reported by the caller either way.
 */
export async function* streamExtract<T>(
  name: ExtractName,
  source: ExtractSource = {},
): AsyncGenerator<T> {
  for await (const line of streamExtractLines(name, source)) {
    const row = parseRow<T>(line);
    if (row) yield row;
  }
}

/** Yields the JSON text of each element, array punctuation stripped. */
export async function* streamExtractLines(
  name: ExtractName,
  source: ExtractSource = {},
): AsyncGenerator<string> {
  const file = EXTRACTS[name];

  if (source.localDir) {
    const { createReadStream } = await import("node:fs");
    const { createInterface } = await import("node:readline");
    const stream = createReadStream(`${source.localDir}/${file}.json`, {
      encoding: "utf8",
    });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of lines) {
      const trimmed = trimElement(line);
      if (trimmed) yield trimmed;
    }
    return;
  }

  const fetchImpl = source.fetchImpl ?? defaultFetch;
  const response = await fetchImpl(`${EXTRACT_BASE_URL}/${file}.zip`);
  if (!response.ok || !response.body) {
    throw new Error(
      `Charity Commission extract ${file}.zip returned ${response.status}`,
    );
  }

  // fflate's Unzip is push-based and the fetch body is pull-based, so the
  // decompressed lines land in a queue that the generator drains between
  // chunks. Nothing accumulates beyond one chunk's worth of lines.
  const queue: string[] = [];
  let pending = "";
  let failure: Error | null = null;

  const unzip = new Unzip((entry) => {
    // The archive holds exactly one .json member; anything else is skipped
    // rather than parsed as if it were the register.
    if (!entry.name.endsWith(".json")) return;
    entry.ondata = (err, chunk, final) => {
      if (err) {
        failure = err instanceof Error ? err : new Error(String(err));
        return;
      }
      pending += DECODER.decode(chunk, { stream: !final });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = trimElement(line);
        if (trimmed) queue.push(trimmed);
      }
      if (final && pending) {
        const trimmed = trimElement(pending);
        if (trimmed) queue.push(trimmed);
        pending = "";
      }
    };
    entry.start();
  });
  unzip.register(UnzipInflate);

  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (value) unzip.push(value, done);
    if (failure) throw failure;
    while (queue.length > 0) yield queue.shift()!;
    if (done) break;
  }
  while (queue.length > 0) yield queue.shift()!;
}
