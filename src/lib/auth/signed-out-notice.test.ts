import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SIGNED_OUT,
  SIGNED_OUT_FAILED,
  signedOutNotice,
} from "./signed-out-notice.ts";

describe("signedOutNotice", () => {
  it("confirms a completed sign-out", () => {
    const notice = signedOutNotice(SIGNED_OUT);
    assert.equal(notice?.tone, "success");
    assert.match(notice!.message, /signed out/i);
  });

  it("warns when the sign-out could not be confirmed", () => {
    const notice = signedOutNotice(SIGNED_OUT_FAILED);
    assert.equal(notice?.tone, "warning");
    assert.match(notice!.message, /shared computer/i);
  });

  it("shows nothing when the parameter is absent", () => {
    assert.equal(signedOutNotice(undefined), null);
  });

  it("takes the first value when the parameter is repeated", () => {
    assert.equal(signedOutNotice([SIGNED_OUT, "anything"])?.tone, "success");
  });

  it("refuses to render text supplied in the URL", () => {
    // The whole point of the closed mapping: a crafted link must not be able
    // to put its own words on the login page.
    for (const crafted of [
      "Your account has been deleted",
      "<script>alert(1)</script>",
      "true",
      "",
    ]) {
      assert.equal(signedOutNotice(crafted), null, `expected ${crafted} to be ignored`);
    }
  });
});
