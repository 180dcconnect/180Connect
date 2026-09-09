import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALL_LOCAL_AUTHORITIES,
  UK_REGIONAL_GROUPS,
} from "./vocabulary.ts";

describe("vocabulary — UK_REGIONAL_GROUPS and ALL_LOCAL_AUTHORITIES coverage", () => {
  it("contains all 174 official local authorities", () => {
    assert.equal(ALL_LOCAL_AUTHORITIES.length, 174);
    const unique = new Set(ALL_LOCAL_AUTHORITIES);
    assert.equal(unique.size, 174, "Every authority name must be distinct");
  });

  it("ensures every local authority belongs to at least one regional group", () => {
    const covered = new Set<string>();
    for (const group of UK_REGIONAL_GROUPS) {
      for (const authority of group.authorities) {
        covered.add(authority);
      }
    }

    const missing = ALL_LOCAL_AUTHORITIES.filter((auth) => !covered.has(auth));
    assert.deepEqual(
      missing,
      [],
      `The following local authorities do not belong to any regional group: ${missing.join(", ")}`,
    );
    assert.equal(covered.size, 174);
  });

  it("ensures every authority in regional groups is in ALL_LOCAL_AUTHORITIES", () => {
    const validSet = new Set(ALL_LOCAL_AUTHORITIES);
    for (const group of UK_REGIONAL_GROUPS) {
      for (const authority of group.authorities) {
        assert.ok(
          validSet.has(authority),
          `Group "${group.name}" references unknown authority: "${authority}"`,
        );
      }
    }
  });

  it("includes all 4 South Yorkshire local authorities", () => {
    const southYorkshire = UK_REGIONAL_GROUPS.find((g) => g.id === "south-yorkshire");
    assert.ok(southYorkshire);
    assert.deepEqual(southYorkshire.authorities, [
      "Barnsley",
      "Doncaster",
      "Rotherham",
      "Sheffield City",
    ]);
  });
});
