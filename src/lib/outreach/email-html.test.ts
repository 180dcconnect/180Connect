import assert from "node:assert/strict";
import test from "node:test";
import {
  emailHtmlToPlainText,
  isRichEmailHtml,
  plainTextToEditorHtml,
  sanitizeEmailHtml,
} from "./email-html.ts";

test("sanitizeEmailHtml keeps allowed tags and styles", () => {
  const html = sanitizeEmailHtml(
    '<p style="color: #ff0000; font-family: Arial;">Hello <strong>there</strong></p><ul><li>One</li></ul>',
  );
  assert.match(html, /<p style="color:#ff0000;font-family:Arial">/i);
  assert.match(html, /<strong>there<\/strong>/);
  assert.match(html, /<ul><li>One<\/li><\/ul>/);
});

test("sanitizeEmailHtml strips scripts, event handlers and disallowed tags", () => {
  const html = sanitizeEmailHtml(
    '<p onclick="alert(1)">Hi</p><script>alert(2)</script><iframe src="evil"></iframe>',
  );
  assert.doesNotMatch(html, /onclick/i);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<iframe/i);
  assert.match(html, /<p>Hi<\/p>/);
});

test("sanitizeEmailHtml strips a javascript: link and forces safe attributes on a real one", () => {
  const dangerous = sanitizeEmailHtml('<a href="javascript:alert(1)">click</a>');
  assert.doesNotMatch(dangerous, /javascript:/i);

  const safe = sanitizeEmailHtml('<a href="https://example.org">click</a>');
  assert.match(safe, /href="https:\/\/example\.org"/);
  assert.match(safe, /rel="noopener noreferrer"/);
  assert.match(safe, /target="_blank"/);
});

test("sanitizeEmailHtml drops a disallowed inline style value", () => {
  const html = sanitizeEmailHtml('<span style="color: red; position: fixed;">x</span>');
  assert.doesNotMatch(html, /position/);
});

test("emailHtmlToPlainText strips markup and keeps readable line breaks", () => {
  const text = emailHtmlToPlainText("<p>Hello there</p><p>Second paragraph</p>");
  assert.equal(text, "Hello there\n\nSecond paragraph");
});

test("emailHtmlToPlainText renders list items as dashed lines", () => {
  const text = emailHtmlToPlainText("<ul><li>One</li><li>Two</li></ul>");
  assert.equal(text, "- One\n- Two");
});

test("emailHtmlToPlainText decodes entities", () => {
  assert.equal(emailHtmlToPlainText("<p>Tom &amp; Jerry</p>"), "Tom & Jerry");
});

test("emailHtmlToPlainText treats a formatted-but-empty body as blank", () => {
  assert.equal(emailHtmlToPlainText("<p></p>"), "");
  assert.equal(emailHtmlToPlainText("<p><br></p>"), "");
});

test("plainTextToEditorHtml wraps paragraphs and escapes markup-like text", () => {
  const html = plainTextToEditorHtml("Hello <there>\n\nSecond paragraph");
  assert.equal(html, "<p>Hello &lt;there&gt;</p><p>Second paragraph</p>");
});

test("plainTextToEditorHtml keeps a single line break within one paragraph", () => {
  assert.equal(plainTextToEditorHtml("Line one\nLine two"), "<p>Line one<br>Line two</p>");
});

test("plainTextToEditorHtml never returns an empty string", () => {
  assert.equal(plainTextToEditorHtml(""), "<p></p>");
});

test("isRichEmailHtml distinguishes legacy plain text from new HTML rows", () => {
  assert.equal(isRichEmailHtml("Just a plain sent email, no markup here."), false);
  assert.equal(isRichEmailHtml("<p>Hello</p>"), true);
  assert.equal(isRichEmailHtml("<strong>Bold</strong> text"), true);
});
