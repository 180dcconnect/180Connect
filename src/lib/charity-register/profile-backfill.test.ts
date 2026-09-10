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
  assert.equal(patchSize(patch), 4);
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
  ]);
  // The disagreeing sector is left exactly as stored, never restated.
  assert.equal(patch.sector, undefined);
  assert.equal(patch.registered_on, undefined);
});

test("a field the register has no value for is not a gap this job can fill", () => {
  const patch = patchFor(
    stored(),
    fromRegister({ activities: null, reportingStatus: null, dateOfRegistration: null }),
  );

  assert.deepEqual(Object.keys(patch), ["sector"]);
  assert.equal(patchSize(patch), 1);
});

test("a classification outside the accepted five leaves sector alone", () => {
  // bulkSector maps only the five imported classifications; anything else is
  // null, which is not a value and must not become an empty write.
  const patch = patchFor(
    stored(),
    fromRegister({ classifications: ["Arts/culture/heritage/science"] }),
  );

  assert.equal(patch.sector, undefined);
  assert.equal("sector" in patch, false);
});

test("a charity with no classifications at all is handled", () => {
  const patch = patchFor(stored(), fromRegister({ classifications: [] }));

  assert.equal(patch.sector, undefined);
  assert.equal(patchSize(patch), 3);
});

test("patchSize counts filled fields, not keys", () => {
  assert.equal(patchSize({}), 0);
  assert.equal(patchSize({ sector: "Poverty Relief" }), 1);
  assert.equal(
    patchSize({ sector: "Poverty Relief", charity_activities: "Relieves poverty." }),
    2,
  );
});
