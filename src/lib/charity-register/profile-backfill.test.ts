import assert from "node:assert/strict";
import { test } from "node:test";

import { patchFor, patchSize, type ProfilePatch, type StoredProfile } from "./profile-backfill.ts";

/** An organisation as the retired API discovery path left it: on the client
 *  list, carrying a charity number, and blank in all four register fields. */
function stored(overrides: Partial<StoredProfile> = {}): StoredProfile {
  return {
    id: "fbbda4a1-46f6-4ba0-81c1-387822667c56",
    charity_activities: null,
    sector: null,
    registered_on: null,
    charity_reporting_status: null,
    insolvent: null,
    in_administration: null,
    ...overrides,
  };
}

/** The register's row for the same charity. Oxfam's, in fact — the case that
 *  surfaced the gap. */
function fromRegister(overrides: Partial<Parameters<typeof patchFor>[1]> = {}) {
  return {
    activities:
      "Oxfam's objects are to prevent and relieve poverty and protect the vulnerable anywhere in the world.",
    dateOfRegistration: "1965-09-07",
    reportingStatus: "Submission Received",
    classifications: ["Overseas Aid/famine Relief", "The Prevention Or Relief Of Poverty"],
    insolvent: false,
    inAdministration: false,
    ...overrides,
  };
}

test("patchFor fills every field the register holds and the record is missing", () => {
  const patch = patchFor(stored(), fromRegister());

  assert.equal(
    patch.charity_activities,
    "Oxfam's objects are to prevent and relieve poverty and protect the vulnerable anywhere in the world.",
  );
  assert.equal(patch.registered_on, "1965-09-07");
  assert.equal(patch.charity_reporting_status, "Submission Received");
  // Mapped through the same CLASSIFICATION_TO_SECTOR the bulk import uses, so a
  // backfilled charity lands in the taxonomy the scorer reads.
  assert.equal(patch.sector, "Poverty Relief");
  // And the two solvency flags. `false` here is the register answering "not
  // insolvent", which is a value worth storing — a truthiness test would drop
  // it and leave every solvent charity looking permanently unassessed.
  assert.equal(patch.insolvent, false);
  assert.equal(patch.in_administration, false);
  assert.equal(patchSize(patch), 6);
});

test("stores an insolvency flag the register actually raised", () => {
  const patch = patchFor(
    stored(),
    fromRegister({ insolvent: true, inAdministration: true }),
  );

  assert.equal(patch.insolvent, true);
  assert.equal(patch.in_administration, true);
});

test("a solvency flag already stored is never restated", () => {
  const patch = patchFor(
    stored({ insolvent: false, in_administration: false }),
    fromRegister({ insolvent: true, inAdministration: true }),
  );

  assert.equal("insolvent" in patch, false);
  assert.equal("in_administration" in patch, false);
});

test("a register that published no solvency flag leaves both columns alone", () => {
  const patch = patchFor(
    stored(),
    fromRegister({ insolvent: null, inAdministration: null }),
  );

  assert.equal("insolvent" in patch, false);
  assert.equal("in_administration" in patch, false);
});

test("a field already holding a value never reaches the payload", () => {
  // The invariant that matters: PostgREST writes every key present in an update
  // payload, so a key here that the job did not mean to fill is an overwrite.
  const patch = patchFor(
    stored({
      charity_activities: "Written by an earlier bulk import.",
      sector: "Health & Social Care",
      registered_on: "1965-09-07",
      charity_reporting_status: "Submission Received",
      // Held on both sides, so this test is about the string columns only: a
      // stored false is the register's answer and must not be restated either,
      // which is the same rule stated as a boolean.
      insolvent: false,
      in_administration: false,
    }),
    fromRegister(),
  );

  assert.deepEqual(patch, {} satisfies ProfilePatch);
  assert.equal(patchSize(patch), 0);
});

test("a partly filled record is patched only where it is blank", () => {
  const patch = patchFor(
    stored({ sector: "Education & Training", registered_on: "1965-09-07" }),
    fromRegister(),
  );

  assert.deepEqual(Object.keys(patch).sort(), [
    "charity_activities",
    "charity_reporting_status",
    "in_administration",
    "insolvent",
  ]);
  // The disagreeing sector is left exactly as stored, never restated.
  assert.equal(patch.sector, undefined);
  assert.equal(patch.registered_on, undefined);
  // The solvency flags were blank on both sides' stored copy, so they are
  // filled even though the two register fields above were already held.
  assert.equal(patch.insolvent, false);
  assert.equal(patch.in_administration, false);
});

test("a field the register has no value for is not a gap this job can fill", () => {
  const patch = patchFor(
    stored(),
    fromRegister({ activities: null, reportingStatus: null, dateOfRegistration: null }),
  );

  assert.deepEqual(Object.keys(patch).sort(), ["in_administration", "insolvent", "sector"]);
  assert.equal(patchSize(patch), 3);
});

test("an unmapped classification leaves sector alone", () => {
  // bulkSector returns null for unmapped classifications; null is not a value
  // and must not become an empty write.
  const patch = patchFor(
    stored(),
    fromRegister({ classifications: ["General Charitable Purposes"] }),
  );

  assert.equal(patch.sector, undefined);
  assert.equal("sector" in patch, false);
});

test("an ambiguous classification leaves sector alone", () => {
  const patch = patchFor(stored(), fromRegister({ classifications: ["General Charitable Purposes"] }));
  assert.equal("sector" in patch, false);
});

test("a charity with no classifications at all is handled", () => {
  const patch = patchFor(stored(), fromRegister({ classifications: [] }));

  assert.equal(patch.sector, undefined);
  // activities, registered_on, reporting_status, and the two solvency flags.
  assert.equal(patchSize(patch), 5);
});

test("patchSize counts filled fields, not keys", () => {
  assert.equal(patchSize({}), 0);
  assert.equal(patchSize({ sector: "Poverty Relief" }), 1);
  assert.equal(
    patchSize({ sector: "Poverty Relief", charity_activities: "Relieves poverty." }),
    2,
  );
});
