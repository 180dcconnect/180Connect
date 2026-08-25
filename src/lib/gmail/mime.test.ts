import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createGmailMime, encodeGmailRaw } from "./mime.ts";

describe("createGmailMime", () => {
  it("creates a Gmail-compatible message and removes header injection", () => {
    const mime = createGmailMime({
      from: "180 Connect <clients.sheffield@180dc.org>",
      to: "charity@example.org",
      subject: "Hello\r\nBcc: attacker@example.org",
      text: "First line\nSecond line",
    });
    assert.match(mime, /Subject: Hello Bcc: attacker@example\.org/);
    assert.doesNotMatch(mime, /\r\nBcc:/);
    assert.match(mime, /\r\n\r\nFirst line\r\nSecond line$/);
  });

  it("preserves reply ancestry headers", () => {
    const mime = createGmailMime({
      from: "clients.sheffield@180dc.org",
      to: "charity@example.org",
      subject: "Re: Partnership",
      text: "Following up",
      inReplyTo: "<one@example.org>",
      references: ["<zero@example.org>", "<one@example.org>"],
    });
    assert.match(mime, /In-Reply-To: <one@example\.org>/);
    assert.match(mime, /References: <zero@example\.org> <one@example\.org>/);
  });
});

describe("createGmailMime with html", () => {
  it("builds a multipart/alternative message with both a plain and an HTML part", () => {
    const mime = createGmailMime({
      from: "clients.sheffield@180dc.org",
      to: "charity@example.org",
      subject: "Partnership",
      text: "Hello there",
      html: "<p>Hello <strong>there</strong></p>",
    });
    assert.match(mime, /Content-Type: multipart\/alternative; boundary="([^"]+)"/);
    const boundary = mime.match(/boundary="([^"]+)"/)?.[1];
    assert.ok(boundary);
    assert.match(mime, new RegExp(`--${boundary}\\r\\nContent-Type: text/plain`));
    assert.match(mime, /Hello there/);
    assert.match(mime, new RegExp(`--${boundary}\\r\\nContent-Type: text/html`));
    assert.match(mime, /<p>Hello <strong>there<\/strong><\/p>/);
    assert.match(mime, new RegExp(`--${boundary}--$`));
  });

  it("omits multipart entirely when no html is given", () => {
    const mime = createGmailMime({
      from: "clients.sheffield@180dc.org",
      to: "charity@example.org",
      subject: "Partnership",
      text: "Hello there",
    });
    assert.doesNotMatch(mime, /multipart/);
    assert.match(mime, /Content-Type: text\/plain/);
  });
});

describe("encodeGmailRaw", () => {
  it("uses URL-safe base64 without padding", () => {
    assert.doesNotMatch(encodeGmailRaw("ÿ?"), /[+/=]/);
  });
});
