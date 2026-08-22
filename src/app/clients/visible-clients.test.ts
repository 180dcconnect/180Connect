import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  emptyStateMessage,
  filterByOwner,
  formatLocation,
  formatOutreachStatus,
  filterByCity,
  filterByCountry,
  filterByStatus,
  filterByType,
  filterValues,
  parseListDirection,
  parseListSort,
  searchClients,
  sortClients,
  visibleClients,
  type ClientListRow,
} from "./visible-clients.ts";

function org(overrides: Partial<ClientListRow> = {}): ClientListRow {
  return {
    id: "org-1",
    legal_name: "Test Charity",
    organisation_type: "charity",
    city: "Bristol",
    country_code: "GB",
    outreach_status: "not_contacted",
    owner_id: null,
    owner: null,
    ...overrides,
  };
}

describe("formatLocation", () => {
  it("uses the city when present", () => {
    assert.equal(formatLocation({ city: "Bristol", country_code: "GB" }), "Bristol");
  });

  it("falls back to country_code when city is null", () => {
    assert.equal(formatLocation({ city: null, country_code: "FR" }), "FR");
  });

  it("falls back to country_code when city is blank", () => {
    assert.equal(formatLocation({ city: "  ", country_code: "GB" }), "GB");
  });
});

describe("formatOutreachStatus", () => {
  it("turns snake_case into a readable label", () => {
    assert.equal(formatOutreachStatus("not_contacted"), "Not contacted");
    assert.equal(formatOutreachStatus("responded"), "Responded");
  });
});

describe("visibleClients", () => {
  it("returns every org regardless of import method when there are no suppressions", () => {
    const organisations = [
      org({ id: "a", legal_name: "API Import" }),
      org({ id: "b", legal_name: "Manual Entry" }),
    ];
    const result = visibleClients(organisations, []);
    assert.deepEqual(result.map((c) => c.id), ["a", "b"]);
  });

  it("hides an actively suppressed charity", () => {
    const organisations = [org({ id: "a" }), org({ id: "b" })];
    const suppressions = [{ organisation_id: "a", status: "active" as const }];
    const result = visibleClients(organisations, suppressions);
    assert.deepEqual(result.map((c) => c.id), ["b"]);
  });

  it("still shows a charity with a pending suppression, flagged", () => {
    const organisations = [org({ id: "a" })];
    const suppressions = [{ organisation_id: "a", status: "pending" as const }];
    const result = visibleClients(organisations, suppressions);
    assert.equal(result.length, 1);
    assert.equal(result[0].suppressionPending, true);
  });

  it("returns an empty list for an empty database", () => {
    assert.deepEqual(visibleClients([], []), []);
  });

  it("attaches location and outreach status labels", () => {
    const organisations = [
      org({ id: "a", city: null, country_code: "GB", outreach_status: "follow_up_sent" }),
    ];
    const result = visibleClients(organisations, []);
    assert.equal(result[0].location, "GB");
    assert.equal(result[0].outreachStatusLabel, "Follow up sent");
  });

  it("F162: ownerName is null only for a genuinely unassigned client", () => {
    const organisations = [org({ id: "a", owner_id: null, owner: null })];
    const result = visibleClients(organisations, []);
    assert.equal(result[0].ownerName, null);
  });

  it("F162: ownerName carries the owning CAM's name", () => {
    const organisations = [
      org({ id: "a", owner_id: "cam-1", owner: { full_name: "Jane CAM" } }),
    ];
    const result = visibleClients(organisations, []);
    assert.equal(result[0].ownerName, "Jane CAM");
  });

  it("F162: falls back to a label when the owner is set but their row is hidden (deactivated)", () => {
    const organisations = [org({ id: "a", owner_id: "cam-1", owner: null })];
    const result = visibleClients(organisations, []);
    assert.equal(result[0].ownerName, "A former team member");
  });
});

describe("filterByOwner", () => {
  const clients = visibleClients(
    [
      org({ id: "a", owner_id: "cam-1", owner: { full_name: "Jane CAM" } }),
      org({ id: "b", owner_id: "cam-2", owner: { full_name: "Sam CAM" } }),
      org({ id: "c", owner_id: null, owner: null }),
    ],
    [],
  );

  it("returns every client when no filter is given", () => {
    assert.deepEqual(filterByOwner(clients, undefined).map((c) => c.id), ["a", "b", "c"]);
    assert.deepEqual(filterByOwner(clients, null).map((c) => c.id), ["a", "b", "c"]);
    assert.deepEqual(filterByOwner(clients, "").map((c) => c.id), ["a", "b", "c"]);
  });

  it("narrows to one CAM's clients", () => {
    assert.deepEqual(filterByOwner(clients, "cam-1").map((c) => c.id), ["a"]);
  });

  it("supports the 'my clients' shortcut, which is just a CAM id filter", () => {
    assert.deepEqual(filterByOwner(clients, "cam-2").map((c) => c.id), ["b"]);
  });

  it("surfaces unassigned clients under the distinct 'unassigned' value", () => {
    assert.deepEqual(filterByOwner(clients, "unassigned").map((c) => c.id), ["c"]);
  });

  it("returns an empty list for a CAM who owns nothing in view", () => {
    assert.deepEqual(filterByOwner(clients, "cam-3"), []);
  });

  it("returns an empty list when filtering an empty client list", () => {
    assert.deepEqual(filterByOwner([], "cam-1"), []);
  });
});

describe("searchClients", () => {
  const clients = visibleClients(
    [
      org({ id: "a", legal_name: "Bristol Food Bank" }),
      org({ id: "b", legal_name: "Cardiff Youth Trust" }),
      org({ id: "c", legal_name: "bristol animal rescue" }),
    ],
    [],
  );

  it("returns every client when no search term is given", () => {
    assert.deepEqual(searchClients(clients, undefined).map((c) => c.id), ["a", "b", "c"]);
    assert.deepEqual(searchClients(clients, null).map((c) => c.id), ["a", "b", "c"]);
    assert.deepEqual(searchClients(clients, "").map((c) => c.id), ["a", "b", "c"]);
    assert.deepEqual(searchClients(clients, "   ").map((c) => c.id), ["a", "b", "c"]);
  });

  it("matches a substring of legal_name case-insensitively", () => {
    assert.deepEqual(searchClients(clients, "bristol").map((c) => c.id), ["a", "c"]);
    assert.deepEqual(searchClients(clients, "BRISTOL").map((c) => c.id), ["a", "c"]);
  });

  it("returns an empty list when nothing matches", () => {
    assert.deepEqual(searchClients(clients, "nonexistent"), []);
  });

  // F052 AC2 — partial matches, not only a prefix or the whole name.
  it("matches mid-name, not just from the start", () => {
    assert.deepEqual(searchClients(clients, "Food").map((c) => c.id), ["a"]);
    assert.deepEqual(searchClients(clients, "outh Tru").map((c) => c.id), ["b"]);
  });

  it("ignores whitespace around the term", () => {
    assert.deepEqual(searchClients(clients, "  bristol  ").map((c) => c.id), ["a", "c"]);
  });
});

describe("emptyStateMessage", () => {
  it("names the search term when one is set", () => {
    assert.equal(
      emptyStateMessage({ isOwnedView: false, search: "bristol", filterActive: true }),
      "No clients match “bristol”. Clear the search to see the full list.",
    );
  });

  it("trims the term before quoting it back", () => {
    assert.equal(
      emptyStateMessage({ isOwnedView: false, search: "  bristol  ", filterActive: true }),
      "No clients match “bristol”. Clear the search to see the full list.",
    );
  });

  // F052 AC3 — the bug this ordering fixes: a CAM who owns clients but searches
  // for one that isn't there must not be told they own none.
  it("prefers the search message over the owned-view message", () => {
    assert.equal(
      emptyStateMessage({ isOwnedView: true, search: "bristol", filterActive: true }),
      "No clients match “bristol”. Clear the search to see the full list.",
    );
  });

  it("uses the owned-view message when the owned view has no search", () => {
    assert.match(
      emptyStateMessage({ isOwnedView: true, search: "   ", filterActive: true }),
      /don't own any clients yet/,
    );
  });

  it("falls back to the generic filter message for a non-search filter", () => {
    assert.equal(
      emptyStateMessage({ isOwnedView: false, search: null, filterActive: true }),
      "No clients match this filter.",
    );
  });

  it("says nothing to show when no filter is active at all", () => {
    assert.equal(
      emptyStateMessage({ isOwnedView: false, search: undefined, filterActive: false }),
      "No clients to show.",
    );
  });
});

/* ─── List sorting (F060 #62, F061 #63) ────────────────────────────────── */

/** sortClients works on VisibleClient, so fixtures go through visibleClients()
 * once — the same path the page uses, so `location` and `outreachStatusLabel`
 * are derived rather than hand-written and can't drift from the real ones. */
function listOf(rows: Partial<ClientListRow>[]) {
  return visibleClients(
    rows.map((row, index) => org({ id: `org-${index}`, ...row })),
    [],
  );
}

const names = (clients: { legal_name: string }[]) => clients.map((c) => c.legal_name);

describe("parseListSort", () => {
  it("accepts the three sortable fields", () => {
    assert.equal(parseListSort("name"), "name");
    assert.equal(parseListSort("location"), "location");
    assert.equal(parseListSort("status"), "status");
  });

  it("falls back to name for anything else", () => {
    assert.equal(parseListSort("owner"), "name");
    assert.equal(parseListSort(undefined), "name");
    assert.equal(parseListSort(""), "name");
    assert.equal(parseListSort("'; drop table organisations; --"), "name");
  });
});

describe("parseListDirection", () => {
  it("only descending is descending", () => {
    assert.equal(parseListDirection("descending"), "descending");
    assert.equal(parseListDirection("ascending"), "ascending");
    assert.equal(parseListDirection("desc"), "ascending");
    assert.equal(parseListDirection(undefined), "ascending");
  });
});

describe("sortClients by name", () => {
  it("sorts alphabetically, ignoring case", () => {
    const clients = listOf([
      { legal_name: "zebra trust" },
      { legal_name: "Apple Fund" },
      { legal_name: "Mango Aid" },
    ]);
    assert.deepEqual(names(sortClients(clients, "name", "ascending")), [
      "Apple Fund",
      "Mango Aid",
      "zebra trust",
    ]);
  });

  it("reverses on descending", () => {
    const clients = listOf([{ legal_name: "Apple Fund" }, { legal_name: "Mango Aid" }]);
    assert.deepEqual(names(sortClients(clients, "name", "descending")), [
      "Mango Aid",
      "Apple Fund",
    ]);
  });

  it("leaves the caller's array alone", () => {
    const clients = listOf([{ legal_name: "Zebra" }, { legal_name: "Apple" }]);
    sortClients(clients, "name", "ascending");
    assert.deepEqual(names(clients), ["Zebra", "Apple"]);
  });

  it("returns an empty list unchanged", () => {
    assert.deepEqual(sortClients([], "location", "descending"), []);
  });
});

describe("sortClients by location (F060)", () => {
  it("sorts alphabetically on the displayed location", () => {
    const clients = listOf([
      { legal_name: "C", city: "York" },
      { legal_name: "A", city: "Bristol" },
      { legal_name: "B", city: "Leeds" },
    ]);
    assert.deepEqual(names(sortClients(clients, "location", "ascending")), ["A", "B", "C"]);
  });

  it("groups clients sharing a location adjacently, in name order (AC2)", () => {
    const clients = listOf([
      { legal_name: "Sheffield Two", city: "Sheffield" },
      { legal_name: "Bristol One", city: "Bristol" },
      { legal_name: "Sheffield One", city: "Sheffield" },
      { legal_name: "Bristol Two", city: "Bristol" },
    ]);
    assert.deepEqual(names(sortClients(clients, "location", "ascending")), [
      "Bristol One",
      "Bristol Two",
      "Sheffield One",
      "Sheffield Two",
    ]);
  });

  it("keeps the group together on descending, and the names inside it ascending", () => {
    const clients = listOf([
      { legal_name: "Sheffield Two", city: "Sheffield" },
      { legal_name: "Bristol One", city: "Bristol" },
      { legal_name: "Sheffield One", city: "Sheffield" },
    ]);
    assert.deepEqual(names(sortClients(clients, "location", "descending")), [
      "Sheffield One",
      "Sheffield Two",
      "Bristol One",
    ]);
  });

  it("sorts a missing city on its country code, the value the list shows", () => {
    const clients = listOf([
      { legal_name: "Has city", city: "Zanzibar" },
      { legal_name: "No city", city: null, country_code: "AL" },
    ]);
    assert.deepEqual(names(sortClients(clients, "location", "ascending")), [
      "No city",
      "Has city",
    ]);
  });
});

describe("sortClients by outreach status (F061)", () => {
  it("follows pipeline order, not alphabetical order of the label (AC1)", () => {
    const clients = listOf([
      { legal_name: "Converted", outreach_status: "converted" },
      { legal_name: "Initial", outreach_status: "initial_outreach_sent" },
      { legal_name: "Not contacted", outreach_status: "not_contacted" },
    ]);
    // Alphabetically the labels would be Converted, Initial…, Not contacted.
    assert.deepEqual(names(sortClients(clients, "status", "ascending")), [
      "Not contacted",
      "Initial",
      "Converted",
    ]);
  });

  it("reverses the pipeline order on descending", () => {
    const clients = listOf([
      { legal_name: "Not contacted", outreach_status: "not_contacted" },
      { legal_name: "Converted", outreach_status: "converted" },
    ]);
    assert.deepEqual(names(sortClients(clients, "status", "descending")), [
      "Converted",
      "Not contacted",
    ]);
  });

  it("orders clients in the same status by name", () => {
    const clients = listOf([
      { legal_name: "Beta", outreach_status: "responded" },
      { legal_name: "Alpha", outreach_status: "responded" },
    ]);
    assert.deepEqual(names(sortClients(clients, "status", "ascending")), ["Alpha", "Beta"]);
  });

  it("sorts an unrecognised status last rather than first", () => {
    const clients = listOf([
      { legal_name: "Unknown", outreach_status: "invented_status" },
      { legal_name: "Converted", outreach_status: "converted" },
      { legal_name: "Not contacted", outreach_status: "not_contacted" },
    ]);
    assert.deepEqual(names(sortClients(clients, "status", "ascending")), [
      "Not contacted",
      "Converted",
      "Unknown",
    ]);
  });

  it("keeps an unrecognised status last on descending too — never first (regression)", () => {
    const clients = listOf([
      { legal_name: "Unknown", outreach_status: "invented_status" },
      { legal_name: "Converted", outreach_status: "converted" },
      { legal_name: "Not contacted", outreach_status: "not_contacted" },
    ]);
    assert.deepEqual(names(sortClients(clients, "status", "descending")), [
      "Converted",
      "Not contacted",
      "Unknown",
    ]);
  });

  it("ties two unrecognised statuses by name in either direction", () => {
    const clients = listOf([
      { legal_name: "Zeta", outreach_status: "invented_b" },
      { legal_name: "Alpha", outreach_status: "invented_a" },
    ]);
    assert.deepEqual(names(sortClients(clients, "status", "ascending")), ["Alpha", "Zeta"]);
    assert.deepEqual(names(sortClients(clients, "status", "descending")), ["Alpha", "Zeta"]);
  });
});

describe("sortClients combined with filters (F060 AC3 / F061 AC2)", () => {
  it("sorts only what the filter left behind", () => {
    const clients = listOf([
      { legal_name: "Owned York", city: "York", owner_id: "cam-1" },
      { legal_name: "Other Bristol", city: "Bristol", owner_id: "cam-2" },
      { legal_name: "Owned Bristol", city: "Bristol", owner_id: "cam-1" },
    ]);
    const mine = filterByOwner(clients, "cam-1");
    assert.deepEqual(names(sortClients(mine, "location", "ascending")), [
      "Owned Bristol",
      "Owned York",
    ]);
  });

  it("sorts what the search left behind", () => {
    const clients = listOf([
      { legal_name: "Trust Zed", outreach_status: "converted" },
      { legal_name: "Unrelated", outreach_status: "not_contacted" },
      { legal_name: "Trust Alpha", outreach_status: "not_contacted" },
    ]);
    const found = searchClients(clients, "trust");
    assert.deepEqual(names(sortClients(found, "status", "ascending")), [
      "Trust Alpha",
      "Trust Zed",
    ]);
  });
});

/* ─── Multi-select filters (F053 #55, F054 #56, F056 #58) ──────────────── */

describe("filterValues", () => {
  it("accepts a single value, an array, or nothing", () => {
    assert.deepEqual(filterValues("Leeds"), ["Leeds"]);
    assert.deepEqual(filterValues(["Leeds", "York"]), ["Leeds", "York"]);
    assert.deepEqual(filterValues(undefined), []);
    assert.deepEqual(filterValues(null), []);
  });

  it("drops blanks, so a stray ?city= shows everything rather than nothing", () => {
    assert.deepEqual(filterValues(""), []);
    assert.deepEqual(filterValues(["Leeds", "", "  "]), ["Leeds"]);
  });
});

describe("filterByType (F053)", () => {
  const clients = listOf([
    { legal_name: "A charity", organisation_type: "charity" },
    { legal_name: "A company", organisation_type: "company" },
    { legal_name: "Both", organisation_type: "both" },
    { legal_name: "Other", organisation_type: "other" },
  ]);

  it("filters on the stored type value", () => {
    assert.deepEqual(names(filterByType(clients, "charity")), ["A charity"]);
  });

  it("AC2 — several types show clients matching any of them", () => {
    assert.deepEqual(names(filterByType(clients, ["charity", "company"])), [
      "A charity",
      "A company",
    ]);
  });

  it("does not treat 'both' as a match for charity or company", () => {
    // "both" is its own standardised value, not a wildcard. The old
    // source-based filter folded it into each, which is why no combination of
    // options could express a plain union.
    assert.deepEqual(names(filterByType(clients, "charity")), ["A charity"]);
  });

  it("an unknown value matches nothing, rather than silently showing everything", () => {
    assert.deepEqual(names(filterByType(clients, "Charity Commission")), []);
    assert.deepEqual(names(filterByType(clients, ["charity", "nonsense"])), ["A charity"]);
  });

  it("no filter shows everything", () => {
    assert.equal(filterByType(clients, undefined).length, 4);
    assert.equal(filterByType(clients, []).length, 4);
  });
});

describe("filterByCity (F054)", () => {
  const clients = listOf([
    { legal_name: "Leeds one", city: "Leeds" },
    { legal_name: "York one", city: "York" },
    { legal_name: "Hull one", city: "Hull" },
    { legal_name: "No city", city: null, country_code: "FR" },
  ]);

  it("matches case-insensitively", () => {
    assert.deepEqual(names(filterByCity(clients, "leeds")), ["Leeds one"]);
  });

  it("AC — several cities show clients in any of them", () => {
    assert.deepEqual(names(filterByCity(clients, ["Leeds", "Hull"])), [
      "Leeds one",
      "Hull one",
    ]);
  });

  it("never matches a client with no city", () => {
    assert.deepEqual(names(filterByCity(clients, ["Leeds", "York", "Hull"])), [
      "Leeds one",
      "York one",
      "Hull one",
    ]);
  });
});

describe("filterByCountry (F054 AC1)", () => {
  const clients = listOf([
    { legal_name: "British", country_code: "GB" },
    { legal_name: "French", country_code: "FR" },
    { legal_name: "Dutch", country_code: "NL" },
  ]);

  it("filters on country_code, case-insensitively", () => {
    assert.deepEqual(names(filterByCountry(clients, "gb")), ["British"]);
  });

  it("supports several countries at once", () => {
    assert.deepEqual(names(filterByCountry(clients, ["FR", "NL"])), ["French", "Dutch"]);
  });

  it("combines with a city filter rather than replacing it", () => {
    const mixed = listOf([
      { legal_name: "Leeds GB", city: "Leeds", country_code: "GB" },
      { legal_name: "Leeds NL", city: "Leeds", country_code: "NL" },
      { legal_name: "York GB", city: "York", country_code: "GB" },
    ]);
    assert.deepEqual(names(filterByCountry(filterByCity(mixed, "Leeds"), "GB")), ["Leeds GB"]);
  });
});

describe("filterByStatus (F056)", () => {
  const clients = listOf([
    { legal_name: "Fresh", outreach_status: "not_contacted" },
    { legal_name: "Replied", outreach_status: "responded" },
    { legal_name: "Won", outreach_status: "converted" },
  ]);

  it("matches the stored enum value, which the label used to break", () => {
    // The old filter matched "Not contacted" and returned nothing for the value
    // the database actually holds.
    assert.deepEqual(names(filterByStatus(clients, "not_contacted")), ["Fresh"]);
  });

  it("does not match the formatted label", () => {
    assert.deepEqual(names(filterByStatus(clients, "Not contacted")), []);
  });

  it("AC3 — several statuses show clients in any of them", () => {
    assert.deepEqual(names(filterByStatus(clients, ["responded", "converted"])), [
      "Replied",
      "Won",
    ]);
  });

  it("no filter shows everything", () => {
    assert.equal(filterByStatus(clients, []).length, 3);
  });
});
