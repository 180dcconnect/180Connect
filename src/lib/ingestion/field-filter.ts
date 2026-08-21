// Field-level payload filter for data handling rules (F246).
//
// Pure function: takes a raw_payload and a list of deny/allow rules, returns
// the filtered payload and the list of field paths that were stripped. No
// database dependency — the runner loads rules once per run and passes them here.
//
// Path syntax:
//   - Dot-separated keys:      "registered_office_address.locality"
//   - Array wildcards:          "officers[*].usual_residential_address"
//   - Top-level field:          "previous_company_names"
//
// Deny-list model: everything is kept unless a deny rule matches. An 'allow'
// rule at a more specific source overrides a global 'deny' for the same path.

/** A single resolved rule, as loaded from the database. */
export type FieldRule = {
  /** Null = applies to all sources. */
  source: string | null;
  field_path: string;
  action: "allow" | "deny";
};

export type FilterResult = {
  /** The payload with denied fields removed. */
  filtered: unknown;
  /** The field paths that were actually stripped (deny rules that matched real data). */
  excludedFields: string[];
};

/**
 * Resolves which rules apply to a given source. Source-specific rules override
 * global rules for the same field_path.
 */
export function resolveRulesForSource(
  rules: FieldRule[],
  source: string,
): FieldRule[] {
  // Group by field_path. Source-specific wins over global (source = null).
  const byPath = new Map<string, FieldRule>();

  for (const rule of rules) {
    if (rule.source !== null && rule.source !== source) continue;

    const existing = byPath.get(rule.field_path);
    if (!existing) {
      byPath.set(rule.field_path, rule);
    } else if (rule.source !== null && existing.source === null) {
      // Source-specific overrides global
      byPath.set(rule.field_path, rule);
    }
    // If both are same specificity, first wins (shouldn't happen with unique index)
  }

  return Array.from(byPath.values());
}

/**
 * Parses a field path like "officers[*].usual_residential_address" into segments.
 *
 * Each segment is either a plain key ("officers") or a wildcard marker ("[*]"
 * appended to the key means "iterate every array element").
 */
type PathSegment = { key: string; isArrayWildcard: boolean };

function parsePath(fieldPath: string): PathSegment[] {
  // Split on dots, then check each segment for [*] suffix
  return fieldPath.split(".").map((raw) => {
    if (raw.endsWith("[*]")) {
      return { key: raw.slice(0, -3), isArrayWildcard: true };
    }
    return { key: raw, isArrayWildcard: false };
  });
}

/**
 * Recursively strips a field from a value at the given path segments.
 *
 * Returns { value, removed } where `removed` is true if the path matched
 * something that was deleted.
 */
function stripField(
  value: unknown,
  segments: PathSegment[],
  currentIndex: number,
): { value: unknown; removed: boolean } {
  if (currentIndex >= segments.length) {
    // We've consumed the full path — this value IS the target. Remove it.
    return { value: undefined, removed: true };
  }

  if (value === null || value === undefined || typeof value !== "object") {
    // Can't traverse further into a primitive — path doesn't match
    return { value, removed: false };
  }

  const segment = segments[currentIndex];

  if (segment.isArrayWildcard) {
    // The current key should point to an array; iterate each element
    const obj = value as Record<string, unknown>;
    const arr = obj[segment.key];

    if (!Array.isArray(arr)) {
      return { value, removed: false };
    }

    let anyRemoved = false;
    const newArr = arr.map((element) => {
      const result = stripField(element, segments, currentIndex + 1);
      if (result.removed) anyRemoved = true;
      return result.value;
    });

    if (!anyRemoved) return { value, removed: false };

    return {
      value: { ...obj, [segment.key]: newArr },
      removed: true,
    };
  }

  // Plain key — descend one level
  const obj = value as Record<string, unknown>;
  if (!(segment.key in obj)) {
    return { value, removed: false };
  }

  if (currentIndex === segments.length - 1) {
    // This is the last segment — delete the key
    const { [segment.key]: _removed, ...rest } = obj;
    return { value: rest, removed: true };
  }

  // More segments to go — recurse into the value at this key
  const child = obj[segment.key];
  const result = stripField(child, segments, currentIndex + 1);
  if (!result.removed) return { value, removed: false };

  return {
    value: { ...obj, [segment.key]: result.value },
    removed: true,
  };
}

/**
 * Filters a raw_payload according to the resolved deny rules for a source.
 *
 * Only 'deny' rules strip fields. 'allow' rules have already been resolved
 * by `resolveRulesForSource` (they override a global deny for the same path).
 */
export function filterPayload(
  payload: unknown,
  rules: FieldRule[],
  source: string,
): FilterResult {
  const resolved = resolveRulesForSource(rules, source);
  const denyRules = resolved.filter((r) => r.action === "deny");

  if (denyRules.length === 0) {
    return { filtered: payload, excludedFields: [] };
  }

  let current = payload;
  const excludedFields: string[] = [];

  for (const rule of denyRules) {
    const segments = parsePath(rule.field_path);
    const result = stripField(current, segments, 0);
    if (result.removed) {
      current = result.value;
      excludedFields.push(rule.field_path);
    }
  }

  return { filtered: current, excludedFields };
}
