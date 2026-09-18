/**
 * The inbox composer types into a plain textarea; the outreach send path
 * stores and mails HTML (F117, and `emailHtmlToPlainText` derives the plain
 * MIME part back from it). This is the one conversion between them.
 *
 * Its own module rather than a helper inside the modal because it is pure and
 * worth testing on its own — the modal is a client component whose imports
 * reach the "use server" actions, which a unit test cannot load.
 */

/**
 * One paragraph per blank-line-separated block, single newlines kept as
 * breaks, so the shape of what the CAM typed is the shape that arrives.
 *
 * Escaped first, deliberately: everything typed into that box is content,
 * never markup.
 */
export function composeBodyToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => `<p>${block.replace(/\n/g, "<br />")}</p>`)
    .join("");
}
