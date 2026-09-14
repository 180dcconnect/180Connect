import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";

async function source(relative: string) {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

describe("send ownership contract", () => {
  it("both send surfaces confirm take-ownership through the shared dialog", async () => {
    // One dialog, two senders: a second copy of this confirm is how one
    // surface's ownership wording drifts from the other's.
    for (const relative of [
      "../../components/inbox/gmail-compose-modal.tsx",
      "../../components/outreach/reply-composer.tsx",
    ]) {
      const text = await source(relative);
      assert.match(text, /TakeOwnershipDialog/, `${relative} must mount the shared dialog`);
      assert.match(
        text,
        /claimClientOwnership/,
        `${relative} must claim through the shared helper`,
      );
    }
  });

  it("keeps the ownership copy in exactly one place", async () => {
    const dialog = await source("../../components/outreach/take-ownership-dialog.tsx");
    assert.match(dialog, /will make you its owner/);
    for (const relative of [
      "../../components/inbox/gmail-compose-modal.tsx",
      "../../components/outreach/reply-composer.tsx",
    ]) {
      const text = await source(relative);
      assert.doesNotMatch(
        text,
        /will make you its owner/,
        `${relative} must not restate the dialog copy`,
      );
    }
  });

  it("claims through the audited route, never a direct owner write", async () => {
    const dialog = await source("../../components/outreach/take-ownership-dialog.tsx");
    assert.match(dialog, /\/api\/clients\/\$\{organisationId\}\/claim/);
    assert.doesNotMatch(dialog, /\.from\("organisations"\)/);
    assert.doesNotMatch(dialog, /\.rpc\(/);
  });

  it("gates send-now and scheduled sends behind the same confirmation", async () => {
    // Both composers funnel every send through one handleSend, so the gate
    // inside it covers the Send button and the schedule dialog alike.
    const modal = await source("../../components/inbox/gmail-compose-modal.tsx");
    assert.match(modal, /ownerId == null &&\s+ownershipAcceptedFor !==/);
    const composer = await source("../../components/outreach/reply-composer.tsx");
    assert.match(composer, /ownerId == null &&\s+ownershipAcceptedFor !==/);
  });
});
