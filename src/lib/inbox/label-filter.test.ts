import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { threadMatchesLabels } from "./label-filter.ts";

const thread = (
  sector: string,
  tagNames: string[],
): { sector: string; tags: { id: string; name: string; colour: string | null }[] } => ({
  sector,
  tags: tagNames.map((name, index) => ({ id: `t${index}`, name, colour: null })),
});

describe("threadMatchesLabels", () => {
  it("matches everything when no label is applied", () => {
    assert.equal(threadMatchesLabels(thread("Environment", []), new Set()), true);
  });

  it("matches on the built-in sector label", () => {
    assert.equal(
      threadMatchesLabels(thread("Environment", []), new Set(["Environment"])),
      true,
    );
    assert.equal(
      threadMatchesLabels(thread("Environment", []), new Set(["Health & Well-being"])),
      false,
    );
  });

  it("matches on a tag name", () => {
    assert.equal(
      threadMatchesLabels(
        thread("Charities & NGOs", ["Spring Cycle"]),
        new Set(["Spring Cycle"]),
      ),
      true,
    );
  });

  it("matches when any applied label hits — sector or tag", () => {
    assert.equal(
      threadMatchesLabels(
        thread("Environment", ["Spring Cycle"]),
        new Set(["Health & Well-being", "Spring Cycle"]),
      ),
      true,
    );
  });

  it("rejects a thread whose sector and tags miss every applied label", () => {
    assert.equal(
      threadMatchesLabels(
        thread("Environment", ["Autumn Cycle"]),
        new Set(["Spring Cycle"]),
      ),
      false,
    );
  });

  it("tolerates a thread with no tags field", () => {
    assert.equal(
      threadMatchesLabels({ sector: "Environment" }, new Set(["Spring Cycle"])),
      false,
    );
  });
});
