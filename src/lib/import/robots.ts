// robots.txt handling for F037 Manual URL Import.
//
// Why this exists when the import is one page, fetched because a CAM asked for it:
// the open question on the ticket was the legal and technical basis for retrieving
// website content, and "we identify ourselves and we honour the site's own stated
// rules" is most of the answer. It also costs one cached request and a small parser.
//
// Scope is deliberately narrow — this is not a crawler. It reads Disallow and Allow
// for our own user-agent token and for `*`, and ignores Crawl-delay, Sitemap, and
// wildcard-heavy patterns beyond `*` and `$`, which no charity website uses to keep
// its homepage private. A rule this parser cannot understand is treated as a rule
// that does not apply, and the fetch goes ahead; that is the right default for a
// single human-initiated read, and the wrong one for a bulk crawler, which is why
// this module should not be reused as one.

/** Sent as User-Agent on every request F037 makes, and matched against here. */
export const IMPORT_USER_AGENT_TOKEN = "180Connect-Import";

export const IMPORT_USER_AGENT =
  `${IMPORT_USER_AGENT_TOKEN}/1.0 (+https://180dc.org; charity research; contact sheffield@180dc.org)`;

type Group = {
  /** Lower-cased user-agent tokens this group applies to. */
  agents: string[];
  rules: { allow: boolean; pattern: string }[];
};

function parseGroups(robotsTxt: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  // A blank line ends a group, but consecutive User-agent lines start one group with
  // several agents — so a User-agent line only opens a new group if the previous line
  // was a rule, not another agent.
  let lastWasAgent = false;

  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (!line) {
      current = null;
      lastWasAgent = false;
      continue;
    }

    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }

    if (field !== "allow" && field !== "disallow") continue;
    lastWasAgent = false;
    if (!current) continue;
    current.rules.push({ allow: field === "allow", pattern: value });
  }

  return groups;
}

/** Turns a robots.txt path pattern into a regular expression. Only `*` and `$` are special. */
function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const anchoredEnd = escaped.endsWith("\\$");
  const body = anchoredEnd ? escaped.slice(0, -2) : escaped;
  return new RegExp(`^${body.replace(/\*/g, ".*")}${anchoredEnd ? "$" : ""}`);
}

/**
 * Applies the robots.txt exclusion rules to one path.
 *
 * Group selection follows the standard: the most specific matching user-agent group
 * wins outright, and `*` is only consulted when no group names us. Within a group the
 * longest matching pattern wins, with Allow beating Disallow on an equal-length tie —
 * that tie-break is what lets a site write `Disallow: /` plus `Allow: /about`.
 */
export function isPathAllowedByRobots(
  robotsTxt: string,
  path: string,
  userAgentToken: string = IMPORT_USER_AGENT_TOKEN,
): boolean {
  const groups = parseGroups(robotsTxt);
  const token = userAgentToken.toLowerCase();

  const named = groups.filter((group) =>
    group.agents.some((agent) => agent !== "*" && token.startsWith(agent)),
  );
  const applicable = named.length > 0
    ? named
    : groups.filter((group) => group.agents.includes("*"));

  let decision: { allow: boolean; length: number } | null = null;

  for (const group of applicable) {
    for (const rule of group.rules) {
      // An empty Disallow value means "nothing is disallowed" and carries no path.
      if (rule.pattern === "") continue;
      if (!patternToRegExp(rule.pattern).test(path)) continue;

      const length = rule.pattern.length;
      if (!decision || length > decision.length || (length === decision.length && rule.allow)) {
        decision = { allow: rule.allow, length };
      }
    }
  }

  return decision ? decision.allow : true;
}
