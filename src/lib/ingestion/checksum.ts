// Checksum for RAW_SOURCE_RECORDS.checksum (F038).
//
// The Data Model describes this column as "hash of raw_payload to detect changes...
// used to skip reprocessing unchanged records", so the hash has to be stable across
// runs for identical data and has to change when *any* part of the payload changes,
// however deeply nested.

import { createHash } from "node:crypto";

/**
 * `JSON.stringify` with every object's keys sorted, at every depth.
 *
 * Written by hand rather than as `JSON.stringify(v, Object.keys(v).sort())`: the
 * second argument to `JSON.stringify` is a *replacer allowlist*, not a key sorter,
 * and it applies recursively — so any nested key absent from the top-level key list
 * is dropped from the output entirely. A Companies House record would serialise its
 * `address` as `{}`, and a company that changed address would hash identically to
 * one that had not, which is precisely the change this checksum exists to catch.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    // JSON.stringify returns undefined for functions and symbols; those cannot
    // appear in a parsed API response, but the column is NOT NULL either way.
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    // Array order is meaningful and is left alone.
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify(
          (value as Record<string, unknown>)[key],
        )}`,
    );

  return `{${entries.join(",")}}`;
}

/** sha256 of the payload, key order normalised. Hex, as stored in the column. */
export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}
