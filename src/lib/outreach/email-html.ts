/**
 * F117: shared helpers for the rich-text outreach email body.
 *
 * `outreach_messages.body` stays a plain `text` column (F115/F116 avoided a
 * schema change and this follows the same rule) — HTML fits in it as a string
 * like any other. These are the only functions allowed to turn that HTML into
 * something else: sanitized HTML for re-rendering, plain text for the MIME
 * fallback part and for AI prompt context, or the reverse, plain AI text into
 * HTML the editor can open.
 */

import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "ul",
  "ol",
  "li",
  "blockquote",
  "a",
  "span",
];

const HEX_OR_RGB_COLOR =
  /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))$/i;
const FONT_FAMILY_VALUE = /^[a-z0-9 ,'"-]+$/i;
const FONT_SIZE_VALUE = /^\d{1,3}(\.\d+)?(px|pt|em|%)$/;
const MARGIN_LEFT_VALUE = /^\d{1,3}(\.\d+)?(px|pt|em)$/;

/**
 * Strict allowlist for outreach email HTML. Runs on every write (send) and
 * every read (history/admin display), so a bad row can never reach
 * `dangerouslySetInnerHTML` unsanitized even if a future write path skips it.
 */
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "rel", "target"],
      span: ["style"],
      p: ["style"],
      li: ["style"],
    },
    allowedStyles: {
      "*": {
        color: [HEX_OR_RGB_COLOR],
        "font-family": [FONT_FAMILY_VALUE],
        "font-size": [FONT_SIZE_VALUE],
        "margin-left": [MARGIN_LEFT_VALUE],
      },
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" }, true),
    },
  }).trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const codePoint =
        entity[1]?.toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * Derives the plain-text MIME fallback (and stage-two's AI prompt context)
 * from the HTML the CAM actually reviewed, so the two are never manually kept
 * in sync and can never drift apart.
 */
export function emailHtmlToPlainText(html: string): string {
  const withBreaks = html
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/(p|blockquote)>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  const stripped = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} });
  return decodeHtmlEntities(stripped)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Hydrates the editor when a draft is (re)generated: the model returns plain
 * text, and this is the only place a plain AI draft becomes the HTML the rich
 * editor opens with.
 */
export function plainTextToEditorHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => escapeHtml(block.trim()).replace(/\n/g, "<br>"))
    .filter(Boolean);
  if (paragraphs.length === 0) return "<p></p>";
  return paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join("");
}

// Anchored to the start of the body on purpose. Every row this app writes
// begins with a tag (Tiptap always wraps content in blocks and sanitize-html
// preserves them), while legacy plain text only ever contains tags as literal
// prose mid-sentence — e.g. "wrap it in <p> tags". A substring sniff would
// misrender those rows as mangled HTML; an anchored one cannot.
const RICH_TAG_PATTERN = /^\s*<\/?(p|br|strong|b|em|i|u|s|ul|ol|li|blockquote|a|span)[\s/>]/i;

/**
 * Historical rows predate this feature and are plain text with no markup.
 * Sniffing for markup, rather than migrating the column, is how F117 tells
 * a legacy row from a new one so both keep rendering correctly.
 */
export function isRichEmailHtml(body: string): boolean {
  return RICH_TAG_PATTERN.test(body);
}
