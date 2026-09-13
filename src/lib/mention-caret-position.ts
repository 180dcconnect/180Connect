/**
 * Pixel offset of the caret inside a `<textarea>`, relative to its own
 * content box. Textareas expose no caret geometry natively, so this mirrors
 * the element into an off-screen div with identical text layout and reads
 * back where a marker span lands at the given character offset — the
 * standard workaround (same technique as the `textarea-caret-position`
 * package). Used by the note composer (F485) to anchor the @mention
 * dropdown on the caret instead of a fixed corner.
 */

const MIRRORED_PROPERTIES = [
  "boxSizing",
  "width",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderStyle",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontSize",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
  "direction",
] as const;

export type CaretPosition = { left: number; top: number; lineHeight: number };

export function getCaretCoordinates(
  textarea: HTMLTextAreaElement,
  position: number,
): CaretPosition {
  const div = document.createElement("div");
  document.body.appendChild(div);

  const style = div.style;
  const computed = window.getComputedStyle(textarea);

  style.whiteSpace = "pre-wrap";
  style.wordWrap = "break-word";
  style.position = "absolute";
  style.visibility = "hidden";
  style.top = "0";
  style.left = "-9999px";

  for (const prop of MIRRORED_PROPERTIES) {
    (style as unknown as Record<string, string>)[prop] = (
      computed as unknown as Record<string, string>
    )[prop];
  }

  div.textContent = textarea.value.substring(0, position);
  // A trailing newline needs an explicit character or the mirror collapses it.
  if (textarea.value[position - 1] === "\n") div.textContent += " ";

  const span = document.createElement("span");
  span.textContent = textarea.value.substring(position) || ".";
  div.appendChild(span);

  const coordinates: CaretPosition = {
    left: span.offsetLeft,
    top: span.offsetTop,
    lineHeight: parseInt(computed.lineHeight, 10) || span.offsetHeight,
  };

  document.body.removeChild(div);
  return coordinates;
}
