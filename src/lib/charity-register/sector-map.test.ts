import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CLASSIFICATION_SECTORS, sectorForClassifications } from "./sector-map.ts";

/**
 * The taxonomy, copied from SECTOR_CATEGORY_GROUPS in
 * src/app/settings/outreach-preferences/constants.ts. Copied rather than
 * imported because `lib` must not depend on `app` — the same reason
 * score-by-sector.ts mirrors it, and guarded the same way: by a test that fails
 * if the two drift.
 */
const SECTOR_PRESETS = [
  "Health & Social Care", "Mental Health", "Disability Support", "Medical Research",
  "Education & Training", "Youth & Children", "Schools & Colleges", "Skills & Employment",
  "Environment & Conservation", "Climate & Sustainability", "Renewable Energy", "Animal Welfare",
  "Poverty Relief", "Housing & Homelessness", "Community Development", "Social Inclusion",
  "Arts & Culture", "Heritage & Museums", "Sports & Recreation",
  "Social Enterprise", "International Aid", "Human Rights & Justice",
];

/** Every "What" classification the register publishes, counted 2026-09-03. */
const REGISTER_CLASSIFICATIONS = [
  "Education/training",
  "General Charitable Purposes",
  "The Prevention Or Relief Of Poverty",
  "Religious Activities",
  "The Advancement Of Health Or Saving Of Lives",
  "Arts/culture/heritage/science",
  "Disability",
  "Amateur Sport",
  "Economic/community Development/employment",
  "Environment/conservation/heritage",
  "Recreation",
  "Other Charitable Purposes",
  "Overseas Aid/famine Relief",
  "Accommodation/housing",
  "Human Rights/religious Or Racial Harmony/equality Or Diversity",
  "Animals",
  "Armed Forces/emergency Service Efficiency",
];

describe("CLASSIFICATION_SECTORS", () => {
  it("covers every classification the register publishes", () => {
    // A classification missing here is a charity that imports with no sector and
    // no explanation. All 17 must be present, mapped or explicitly null.
    for (const classification of REGISTER_CLASSIFICATIONS) {
      assert.ok(
        classification in CLASSIFICATION_SECTORS,
        `${classification} is not in the sector map`,
      );
    }
    assert.equal(Object.keys(CLASSIFICATION_SECTORS).length, REGISTER_CLASSIFICATIONS.length);
  });

  it("only maps onto sectors the scorer knows", () => {
    for (const [classification, sector] of Object.entries(CLASSIFICATION_SECTORS)) {
      if (sector === null) continue;
      assert.ok(
        SECTOR_PRESETS.includes(sector),
        `${classification} maps to "${sector}", which is not in the sector taxonomy`,
      );
    }
  });

  it("maps the sectors the old import excluded outright", () => {
    // Arts, environment and housing were not merely scored low before — they
    // could not be imported at all.
    assert.equal(CLASSIFICATION_SECTORS["Arts/culture/heritage/science"], "Arts & Culture");
    assert.equal(
      CLASSIFICATION_SECTORS["Environment/conservation/heritage"],
      "Environment & Conservation",
    );
    assert.equal(CLASSIFICATION_SECTORS["Accommodation/housing"], "Housing & Homelessness");
  });
});

describe("sectorForClassifications", () => {
  it("returns null when the charity has no classification", () => {
    assert.equal(sectorForClassifications([]), null);
    assert.equal(sectorForClassifications(undefined), null);
  });

  it("prefers a specific cause over an unmappable one", () => {
    // A charity carrying both must not come out sectorless just because
    // "General Charitable Purposes" appeared first in its own list.
    assert.equal(
      sectorForClassifications(["General Charitable Purposes", "Disability"]),
      "Disability Support",
    );
  });

  it("returns null rather than guessing when nothing maps", () => {
    assert.equal(
      sectorForClassifications(["Religious Activities", "General Charitable Purposes"]),
      null,
    );
  });

  it("is stable regardless of the order the register lists them in", () => {
    const a = sectorForClassifications(["Disability", "Education/training"]);
    const b = sectorForClassifications(["Education/training", "Disability"]);
    assert.equal(a, b);
  });
});
