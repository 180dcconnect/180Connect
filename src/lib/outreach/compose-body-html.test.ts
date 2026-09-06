import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { emailHtmlToPlainText } from "./email-html.ts";

import { composeBodyToHtml } from "./compose-body-html.ts";

/**
 * The inbox composer types into a textarea; the send path stores and mails
 * HTML. This is the one conversion between them, so what it must hold is:
 * everything typed stays content (never markup), the shape of what was typed
 * survives, and the result satisfies the send schema's "has real content"
 * check — which runs `emailHtmlToPlainText` over it, the same function that
 * derives the plain-text MIME part.
 */

describe("composeBodyToHtml", () => {
  it("wraps a single block in one paragraph", () => {
    assert.equal(composeBodyToHtml("Dear Riverbank team,"), "<p>Dear Riverbank team,</p>");
  });

  it("makes a paragraph per blank-line-separated block", () => {
    assert.equal(
      composeBodyToHtml("First paragraph.\n\nSecond paragraph."),
      "<p>First paragraph.</p><p>Second paragraph.</p>",
    );
  });

  it("keeps a single newline as a line break, not a new paragraph", () => {
    assert.equal(
      composeBodyToHtml("Best wishes,\nBashir"),
      "<p>Best wishes,<br />Bashir</p>",
    );
  });

  it("treats a run of blank lines as one break", () => {
    assert.equal(composeBodyToHtml("One.\n\n\n\nTwo."), "<p>One.</p><p>Two.</p>");
  });

  it("escapes typed markup rather than emitting it", () => {
    // A CAM writing "<3" or quoting an HTML snippet must not have it rendered,
    // and must not be able to inject markup into an outgoing email.
    assert.equal(
      composeBodyToHtml("We <3 your work & <script>alert(1)</script>"),
      "<p>We &lt;3 your work &amp; &lt;script&gt;alert(1)&lt;/script&gt;</p>",
    );
  });

  it("produces nothing at all for whitespace, so the send gate still refuses it", () => {
    assert.equal(composeBodyToHtml(""), "");
    assert.equal(composeBodyToHtml("   \n\n  \n "), "");
    // This is what reviewedEmailSchema's body refinement checks.
    assert.equal(emailHtmlToPlainText(composeBodyToHtml("   \n ")).length, 0);
  });

  it("round-trips real content back to non-empty plain text", () => {
    const html = composeBodyToHtml("Dear team,\n\nOne short ask.\n\nBest wishes,\nBashir");
    assert.ok(emailHtmlToPlainText(html).length > 0);
    assert.match(emailHtmlToPlainText(html), /One short ask\./);
  });

  it("drops a leading and trailing blank line rather than shipping empty paragraphs", () => {
    assert.equal(composeBodyToHtml("\n\nBody.\n\n"), "<p>Body.</p>");
  });
});
