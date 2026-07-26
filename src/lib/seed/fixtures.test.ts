import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_ORGANISATION_COUNT,
  INCOMPLETE_SHARE,
  OUTREACH_STATUSES,
  SEED_DOMAIN,
  generateOrganisations,
} from "./fixtures.ts";

const organisations = generateOrganisations();

describe("generateOrganisations", () => {
  it("produces the volume target from F233 AC3", () => {
    assert.equal(organisations.length, DEFAULT_ORGANISATION_COUNT);
  });

  it("is deterministic — the same seed gives the same records", () => {
    assert.deepEqual(generateOrganisations(), generateOrganisations());
  });

  it("covers every pipeline stage with a handful each", () => {
    for (const status of OUTREACH_STATUSES) {
      const count = organisations.filter((o) => o.outreach_status === status).length;
      assert.ok(count >= 5, `${status} has only ${count} records`);
    }
  });

  it("leaves roughly 30% of profiles incomplete", () => {
    const incomplete = organisations.filter((o) => o.data_completeness_score < 1);
    const share = incomplete.length / organisations.length;
    assert.ok(
      Math.abs(share - INCOMPLETE_SHARE) <= 0.05,
      `incomplete share was ${share}, expected about ${INCOMPLETE_SHARE}`,
    );
  });

  it("covers each kind of gap developers need to test", () => {
    assert.ok(organisations.some((o) => o.contact_email === null && o.website !== null));
    assert.ok(organisations.some((o) => o.website === null && o.contact_email !== null));
    assert.ok(organisations.some((o) => o.address_line_1 === null && o.city === null));
  });

  it("marks every row as seed data", () => {
    assert.ok(organisations.every((o) => o.is_seed === true));
  });

  it("keeps every generated URL and email inside the reserved seed domain", () => {
    for (const organisation of organisations) {
      if (organisation.website) {
        assert.ok(organisation.website.endsWith(`.${SEED_DOMAIN}`), organisation.website);
      }
      if (organisation.contact_email) {
        assert.ok(
          organisation.contact_email.endsWith(`.${SEED_DOMAIN}`),
          organisation.contact_email,
        );
      }
    }
  });

  it("keeps is_international consistent with country_code (table check constraint)", () => {
    for (const organisation of organisations) {
      assert.equal(
        organisation.is_international,
        organisation.country_code !== "GB",
        organisation.legal_name,
      );
    }
  });

  it("scores completeness within the column's 0-1 constraint", () => {
    for (const organisation of organisations) {
      assert.ok(organisation.data_completeness_score >= 0);
      assert.ok(organisation.data_completeness_score <= 1);
    }
  });

  it("gives every record a distinct legal name", () => {
    const names = new Set(organisations.map((o) => o.legal_name));
    assert.equal(names.size, organisations.length);
  });

  it("includes some non-GB organisations", () => {
    assert.ok(organisations.some((o) => o.is_international));
  });
});
