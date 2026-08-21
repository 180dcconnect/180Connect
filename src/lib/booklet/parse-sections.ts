// F082 — turns the flat booklet string into headings/paragraphs/lists for display.
// Pure and DB-free, same reasoning as build-prompt.ts: testable without a network
// call, and kept separate from the component so the parsing rule is one place, not
// duplicated between rendering and any future test of it.
//
// This only works because the system prompt (build-prompt.ts) dictates the exact
// section-break format Gemini must use: a short label alone on its own line,
// ending in a colon, nothing else there. If that instruction ever changes, this
// must change with it — the two are not independently maintainable.

export type BookletBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

const HEADING_LINE = /^[A-Za-z][\w &/-]{2,40}:$/;
const BULLET_LINE = /^[-*]\s+/;

/** A block's first line, alone, matching the exact "Label:" format the prompt asks for. */
function headingFrom(lines: string[]): string | null {
  if (lines.length < 2) return null;
  const first = lines[0].trim();
  return HEADING_LINE.test(first) ? first.slice(0, -1) : null;
}

export function parseBookletSections(text: string): BookletBlock[] {
  const blocks: BookletBlock[] = [];

  for (const rawBlock of text.split(/\n\s*\n/)) {
    const lines = rawBlock
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    const heading = headingFrom(lines);
    const body = heading ? lines.slice(1) : lines;
    if (heading) blocks.push({ type: "heading", text: heading });
    if (body.length === 0) continue;

    if (body.every((line) => BULLET_LINE.test(line))) {
      blocks.push({ type: "list", items: body.map((line) => line.replace(BULLET_LINE, "")) });
    } else {
      blocks.push({ type: "paragraph", text: body.join(" ") });
    }
  }

  return blocks;
}
