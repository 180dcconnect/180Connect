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

describe("createGmailMime with attachments", () => {
  it("wraps a plain-text body and an attachment in multipart/mixed", () => {
    const mime = createGmailMime({
      from: "clients.sheffield@180dc.org",
      to: "charity@example.org",
      subject: "Partnership",
      text: "Hello there",
      attachments: [
        { filename: "agreement.pdf", contentType: "application/pdf", content: Buffer.from("PDFDATA") },
      ],
    });
    assert.match(mime, /Content-Type: multipart\/mixed; boundary="([^"]+)"/);
    const boundary = mime.match(/multipart\/mixed; boundary="([^"]+)"/)?.[1];
    assert.ok(boundary);
    // The plain-text body is the first nested part, unchanged from the no-attachment shape.
    assert.match(mime, new RegExp(`--${boundary}\\r\\nContent-Type: text/plain[\\s\\S]*Hello there`));
    // The attachment is a second nested part with the right disposition and encoding.
    assert.match(mime, /Content-Type: application\/pdf; name="agreement\.pdf"/);
    assert.match(mime, /Content-Disposition: attachment; filename="agreement\.pdf"/);
    assert.match(mime, /Content-Transfer-Encoding: base64/);
    assert.match(mime, new RegExp(Buffer.from("PDFDATA").toString("base64")));
    assert.match(mime, new RegExp(`--${boundary}--$`));
  });

  it("nests the html multipart/alternative body inside multipart/mixed when both are present", () => {
    const mime = createGmailMime({
      from: "clients.sheffield@180dc.org",
      to: "charity@example.org",
      subject: "Partnership",
      text: "Hello there",
      html: "<p>Hello there</p>",
      attachments: [{ filename: "note.txt", contentType: "text/plain", content: Buffer.from("hi") }],
    });
    assert.match(mime, /Content-Type: multipart\/mixed/);
    assert.match(mime, /Content-Type: multipart\/alternative/);
    assert.match(mime, /<p>Hello there<\/p>/);
    assert.match(mime, /Content-Disposition: attachment; filename="note\.txt"/);
  });

  it("sends more than one attachment, each as its own part", () => {
    const mime = createGmailMime({
      from: "clients.sheffield@180dc.org",
      to: "charity@example.org",
      subject: "Partnership",
      text: "Hello there",
      attachments: [
        { filename: "one.txt", contentType: "text/plain", content: Buffer.from("one") },
        { filename: "two.txt", contentType: "text/plain", content: Buffer.from("two") },
      ],
    });
    assert.match(mime, /filename="one\.txt"/);
    assert.match(mime, /filename="two\.txt"/);
  });

  it("strips quotes and CR/LF from a filename rather than corrupting the header", () => {
    const mime = createGmailMime({
      from: "clients.sheffield@180dc.org",
      to: "charity@example.org",
      subject: "Partnership",
      text: "Hello there",
      attachments: [
        { filename: 'evil".txt\r\nBcc: attacker@example.org', contentType: "text/plain", content: Buffer.from("x") },
      ],
    });
    assert.doesNotMatch(mime, /\r\nBcc:/);
  });

  it("falls back to application/octet-stream when no content type is known", () => {
    const mime = createGmailMime({
      from: "clients.sheffield@180dc.org",
      to: "charity@example.org",
      subject: "Partnership",
      text: "Hello there",
      attachments: [{ filename: "file.bin", contentType: null, content: Buffer.from("x") }],
    });
    assert.match(mime, /Content-Type: application\/octet-stream; name="file\.bin"/);
  });

  it("keeps the exact single-blank-line boundary between headers and body when no attachments are given", () => {
    // Regression guard: an extra blank line here would end the header block
    // early and turn Content-Type into unparsed body text.
    const mime = createGmailMime({
      from: "clients.sheffield@180dc.org",
      to: "charity@example.org",
      subject: "Partnership",
      text: "Hello there",
    });
    assert.match(mime, /MIME-Version: 1\.0\r\nContent-Type: text\/plain/);
  });
});

describe("encodeGmailRaw", () => {
  it("uses URL-safe base64 without padding", () => {
    assert.doesNotMatch(encodeGmailRaw("ÿ?"), /[+/=]/);
  });
});
