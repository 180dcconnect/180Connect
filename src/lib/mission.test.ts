import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveMission, resolveMissionText } from "./mission.ts";

describe("resolveMission", () => {
  it("prefers filed charity activities over everything else", () => {
    assert.deepEqual(
      resolveMission({
        charity_activities: "Runs weekly workshops.",
        cic_community_statement: "Benefits local youth.",
        enrichment_mission: "Hand-written mission.",
      }),
      { text: "Runs weekly workshops.", source: "charity_activities" },
    );
  });

  it("uses the CIC statement for companies with no charity activities", () => {
    assert.deepEqual(
      resolveMission({
        charity_activities: null,
        cic_community_statement: "Benefits the Sheffield community.",
        enrichment_mission: null,
      }),
      { text: "Benefits the Sheffield community.", source: "cic_statement" },
    );
  });

  it("falls back to the enrichment mission when no register text exists", () => {
    assert.deepEqual(
      resolveMission({ enrichment_mission: "Hand-written mission." }),
      { text: "Hand-written mission.", source: "enrichment" },
    );
  });

  it("treats blank and whitespace-only values as absent", () => {
    assert.deepEqual(
      resolveMission({
        charity_activities: "   ",
        cic_community_statement: "",
        enrichment_mission: "  Real mission.  ",
      }),
      { text: "Real mission.", source: "enrichment" },
    );
    assert.deepEqual(resolveMission({}), { text: null, source: "none" });
  });

  it("resolveMissionText returns the text alone", () => {
    assert.equal(
      resolveMissionText({ cic_community_statement: "Community purpose." }),
      "Community purpose.",
    );
    assert.equal(resolveMissionText({}), null);
  });
});
