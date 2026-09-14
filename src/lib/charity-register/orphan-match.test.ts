import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  indexRegisterByName,
  indexRegisterByPostcode,
  matchOrphans,
  normalizeName,
  normalizePostcode,
  preferOlderRegistration,
  type OrphanRow,
  type RegisterRow,
} from "./orphan-match.ts";

function orphan(id: string, legal_name: string, postcode: string | null = "S5 8BY"): OrphanRow {
  return { id, legal_name, postcode };
}

function register(
  organisation_number: number,
  charity_name: string,
  overrides: Partial<RegisterRow> = {},
): RegisterRow {
  return {
    organisation_number,
    registered_charity_number: organisation_number,
    charity_name,
    postcode: "S5 8BY",
    ...overrides,
  };
}

/** The register's own shape for a 2026 CIO successor. */
function cio(organisation_number: number, charity_name: string, date: string, postcode = "S5 8BY"): RegisterRow {
  return register(organisation_number, charity_name, {
    postcode,
    is_cio: 1,
    date_of_registration: date,
  });
}

function establish(
  organisation_number: number,
  charity_name: string,
  date: string,
  postcode = "S5 8BY",
): RegisterRow {
  return register(organisation_number, charity_name, {
    postcode,
    is_cio: 0,
    date_of_registration: date,
  });
}

function index(rows: readonly RegisterRow[]) {
  return indexRegisterByPostcode(rows);
}

function byId(matches: ReturnType<typeof matchOrphans>) {
  return new Map(matches.map((match) => [match.orphanId, match]));
}

describe("normalizeName", () => {
  it("ignores case, punctuation and spacing", () => {
    assert.equal(normalizeName("St Helen's  Pre-School"), normalizeName("ST HELENS PRE SCHOOL"));
  });

  it("drops a trailing parenthetical so a register acronym still matches", () => {
    assert.equal(
      normalizeName("WORD OF FIRE INTERNATIONAL MINISTRIES (WOFIM)"),
      normalizeName("WORD OF FIRE INTERNATIONAL MINISTRIES"),
    );
  });

  it("drops more than one trailing parenthetical", () => {
    assert.equal(normalizeName("SOMETHING (A) (B)"), normalizeName("SOMETHING"));
  });

  it("keeps a parenthetical that is not at the end", () => {
    assert.notEqual(normalizeName("FOO (A) BAR"), normalizeName("FOO BAR"));
  });
});

describe("normalizePostcode", () => {
  it("compacts spacing and uppercases, blank reads as absent", () => {
    assert.equal(normalizePostcode("ha4 0re"), "HA40RE");
    assert.equal(normalizePostcode("   "), null);
    assert.equal(normalizePostcode(null), null);
  });
});

describe("preferOlderRegistration", () => {
  const older = establish(100, "SAME NAME", "1986-08-18");
  const newer = cio(200, "SAME NAME", "2026-07-13");

  it("picks the established charity over the newer CIO", () => {
    assert.equal(preferOlderRegistration([newer, older])?.organisation_number, 100);
  });

  it("refuses when the older row is itself a CIO", () => {
    assert.equal(preferOlderRegistration([cio(100, "SAME NAME", "1986-08-18"), newer]), null);
  });

  it("refuses when the newer row is not a CIO", () => {
    assert.equal(preferOlderRegistration([older, establish(200, "SAME NAME", "2026-07-13")]), null);
  });

  it("refuses when both were registered on the same day", () => {
    assert.equal(
      preferOlderRegistration([cio(100, "SAME NAME", "2026-07-13"), cio(200, "SAME NAME", "2026-07-13")]),
      null,
    );
  });

  it("refuses without registration dates or charity numbers", () => {
    assert.equal(preferOlderRegistration([register(100, "SAME NAME"), register(200, "SAME NAME")]), null);
    assert.equal(
      preferOlderRegistration([older, register(200, "SAME NAME", { registered_charity_number: null })]),
      null,
    );
  });
});

describe("matchOrphans", () => {
  it("matches an exact name+postcode pair", () => {
    const matches = matchOrphans(
      [orphan("o1", "HANDS OF STARS LIMITED")],
      index([register(100, "HANDS OF STARS LIMITED")]),
    );
    assert.deepEqual(matches, [
      {
        kind: "confident",
        orphanId: "o1",
        organisationNumber: 100,
        registeredCharityNumber: 100,
        via: "name-and-postcode",
      },
    ]);
  });

  it("holds back ambiguous pairs instead of first-wins", () => {
    const matches = matchOrphans(
      [orphan("o1", "SAME NAME")],
      index([register(100, "SAME NAME"), register(101, "SAME NAME")]),
    );
    assert.equal(matches[0]?.kind, "ambiguous");
  });

  it("holds back two orphans claiming one register row", () => {
    const matches = matchOrphans(
      [orphan("o1", "DUPLICATE ROW"), orphan("o2", "DUPLICATE ROW")],
      index([register(100, "DUPLICATE ROW")]),
    );
    assert.ok(matches.every((match) => match.kind === "ambiguous"));
  });

  it("reports the unmatched with reasons", () => {
    const matches = matchOrphans(
      [
        orphan("o1", "NO POSTCODE", null),
        orphan("o2", "UNKNOWN POSTCODE", "ZZ9 9ZZ"),
        orphan("o3", "RENAMED SINCE IMPORT"),
        orphan("o4", "NO NUMBER", "S5 8BY"),
      ],
      index([
        register(100, "SOMETHING ELSE"),
        register(101, "NO NUMBER", { registered_charity_number: null }),
      ]),
    );
    const found = byId(matches);
    assert.equal(found.get("o1")?.kind, "unmatched");
    assert.equal((found.get("o1") as { reason: string }).reason, "no-postcode");
    assert.equal((found.get("o2") as { reason: string }).reason, "no-postcode-rows");
    assert.equal((found.get("o3") as { reason: string }).reason, "no-name-match");
    assert.equal((found.get("o4") as { reason: string }).reason, "no-charity-number");
  });

  // -----------------------------------------------------------------------
  // Pass 2 — the older-registration tie-break (staging, Sept 2026: 21 of 21
  // name+postcode collisions were an established charity beside a 2026 CIO).
  // -----------------------------------------------------------------------

  it("breaks a name+postcode collision in favour of the established charity", () => {
    const older = establish(1028313, "PRIORY PARK PRESCHOOL", "1993-11-11");
    const newer = cio(5289829, "PRIORY PARK PRESCHOOL", "2026-07-17");
    const matches = matchOrphans(
      [orphan("o1", "PRIORY PARK PRESCHOOL")],
      index([newer, older]),
    );

    assert.equal(matches.length, 1);
    const match = matches[0];
    assert.equal(match.kind, "tie-broken");
    if (match.kind !== "tie-broken") return;
    assert.equal(match.organisationNumber, 1028313);
    assert.equal(match.registeredCharityNumber, 1028313);
    assert.equal(match.rule, "older-registration");
    // Both sides of the choice stay on the record, oldest first.
    assert.deepEqual(
      match.candidates.map((candidate) => candidate.organisationNumber),
      [1028313, 5289829],
    );
    assert.equal(match.candidates[1].isCio, true);
  });

  it("leaves a collision ambiguous when the rule does not apply", () => {
    const matches = matchOrphans(
      [orphan("o1", "SAME NAME")],
      index([register(100, "SAME NAME"), register(101, "SAME NAME")]),
    );
    assert.equal(matches[0]?.kind, "ambiguous");
  });

  // -----------------------------------------------------------------------
  // Pass 3 — the unique-name fallback (staging: 4 records whose postcode has
  // drifted off the register's current value).
  // -----------------------------------------------------------------------

  it("matches on a unique name when the postcode has drifted", () => {
    const rows = [register(1219131, "DRAGON AID", { postcode: "NP23 4FB" })];
    const matches = matchOrphans(
      [orphan("o1", "DRAGON AID", "MK14 5BP")],
      index(rows),
      indexRegisterByName(rows),
    );

    assert.equal(matches[0]?.kind, "confident");
    assert.equal((matches[0] as { via: string }).via, "unique-name");
    assert.equal((matches[0] as { registeredCharityNumber: number }).registeredCharityNumber, 1219131);
  });

  it("does not use the name fallback when the name is not unique", () => {
    const rows = [
      register(100, "SAME NAME", { postcode: "AA1 1AA" }),
      register(101, "SAME NAME", { postcode: "BB2 2BB" }),
    ];
    const matches = matchOrphans(
      [orphan("o1", "SAME NAME", "MK14 5BP")],
      index(rows),
      indexRegisterByName(rows),
    );
    // Reported, not guessed at: two register rows, neither at our postcode.
    assert.equal(matches[0]?.kind, "ambiguous");
  });

  it("lets a register acronym match a name with no parenthetical", () => {
    const rows = [
      register(1219178, "WORD OF FIRE INTERNATIONAL MINISTRIES (WOFIM)", { postcode: "KT5 9JR" }),
      register(1143312, "WORD OF FIRE MINISTRY", { postcode: "CV12 8RR" }),
    ];
    const matches = matchOrphans(
      [orphan("o1", "WORD OF FIRE INTERNATIONAL MINISTRIES", "KT5 9JR")],
      index(rows),
      indexRegisterByName(rows),
    );

    assert.equal(matches[0]?.kind, "confident");
    assert.equal((matches[0] as { registeredCharityNumber: number }).registeredCharityNumber, 1219178);
  });

  it("still falls back when another charity now sits at the recorded postcode", () => {
    const rows = [
      register(1219131, "DRAGON AID", { postcode: "NP23 4FB" }),
      register(999, "SOMETHING ELSE", { postcode: "MK14 5BP" }),
    ];
    const matches = matchOrphans(
      [orphan("o1", "DRAGON AID", "MK14 5BP")],
      index(rows),
      indexRegisterByName(rows),
    );

    assert.equal(matches[0]?.kind, "confident");
    assert.equal((matches[0] as { via: string }).via, "unique-name");
  });

  it("stays unmatched when the name is nowhere in the register", () => {
    const rows = [register(999, "SOMETHING ELSE")];
    const matches = matchOrphans(
      [orphan("o1", "NO SUCH NAME")],
      index(rows),
      indexRegisterByName(rows),
    );
    assert.equal(matches[0]?.kind, "unmatched");
    assert.equal((matches[0] as { reason: string }).reason, "no-name-match");
  });
});
