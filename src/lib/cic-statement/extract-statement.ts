/**
 * Finding the community interest statement on an OCR'd page, and pulling the
 * two boxes out of it.
 *
 * Pure, and no `server-only`: everything that can be wrong about this job lives
 * here, and it needs to be testable against recorded OCR output rather than
 * against PDFs and a WASM engine. `page-images.ts` and `ocr.ts` are plumbing —
 * they either work or throw. This module makes judgements.
 *
 * ── What the form looks like ──
 *
 * Form CIC36, "Declarations on Formation of a Community Interest Company".
 * Versions 9, 12 and 13 were all in a five-filing sample, and they differ in
 * layout, so nothing here may depend on a fixed page index or a fixed
 * y-coordinate. Two sections carry text a reader would recognise as a mission:
 *
 *   SECTION A: COMMUNITY INTEREST STATEMENT — beneficiaries
 *     One prose block, full page width, under the prompt
 *     "The company's activities will provide benefit to ...".
 *
 *   SECTION B: Community Interest Statement — Activities & Related Benefit
 *     A two-column table. Left column "Activities", right column "How will the
 *     activity benefit the community?".
 *
 * Both may be on one page (version 9) or on separate pages (versions 12 and 13).
 *
 * ── Why the text is short, and why that is not a bug ──
 *
 * The form's boxes are fixed height and the text is clipped to them, with
 * "(Please continue separate sheet if necessary.)" printed underneath. What the
 * page shows is what a reader of the public record sees, and it is what we
 * store. A statement that ends mid-sentence is faithfully transcribed, not
 * truncated by us.
 */

import type { OcrPage, OcrWord } from "./ocr.ts";

/** What one filing yielded. Either field may be null — the sections live on
 *  different pages in some form versions, and a filing may not surface both. */
export type CicStatement = {
  /** Section A: the community the company intends to benefit. */
  beneficiaries: string | null;
  /** Section B, left column: the company's day-to-day activities. */
  activities: string | null;
  /** Mean OCR confidence of the pages the text came from, 0-100. Stored on
   *  nothing, but logged, and the signal a spot-check should sort by. */
  confidence: number;
};

/**
 * Below this, a "page" is speckles rather than text.
 *
 * The photocopied sample scored 88.2 and was entirely legible, so this is set
 * well beneath it: the job of this threshold is to reject a blank or garbage
 * page, not to grade quality. Rejecting anything a human could read would lose
 * real statements to protect against a defect that a reviewer can see anyway.
 */
const MIN_PAGE_CONFIDENCE = 55;

/** Guards against storing a page-worth of prose when box detection goes wrong.
 *  The largest genuine statement in the sample was ~1,100 characters. */
const MAX_FIELD_CHARS = 1_500;

/** How far below a heading to keep reading, as a fraction of page height. Both
 *  sections run to the bottom of their box; nothing useful sits above a heading. */
const SECTION_A_MARKER = /activities\s+will\s+provide\s+benefit\s+to/i;
const SECTION_A_HEADING = /SECTION\s*A\b/i;
const SECTION_B_HEADING = /SECTION\s*B\b/i;
const STATEMENT_HEADING = /COMMUNITY\s+INTEREST\s+STATEMENT/i;

/** Boilerplate the form itself prints inside or beside the boxes. Left in, it
 *  would be stored as though the company had written it. */
const BOILERPLATE = [
  /\(?Please continue separate sheet if necessary\.?\)?/gi,
  /\(?The community will benefit by\.*\)?/gi,
  /\(?Please provide the day to day\s*activities of the company\.?\)?/gi,
  /\(?Tell us here what the company\s*is being set up to do\)?/gi,
  /How will the activity benefit the community\??/gi,
  // [VW] because OCR reads the footer's "Version" as "Wersion" often enough to
  // matter — it is small, grey, and the one line guaranteed to sit under every
  // box we read.
  // The separator between "Version 13" and "Last Updated" comes back as a
  // hyphen, an en dash, a tilde, a comma or a guillemet depending on how the
  // footer scanned, so the class is deliberately loose.
  /[VW]ersion\s*\d+\s*[-–«~.,]*\s*Last Updated on\s*\S+/gi,
  /The company name will need to be consistent throughout the application/gi,
  /Please indicate how it is proposed that the company'?s activities will benefit the community,?\s*(or)?\s*(a section of the community\.?)?/gi,
  /Electronically filed document for Company Number:?\s*\w*/gi,
  /^\s*Activities\s*$/gim,
  // The form's own footnotes, printed under Section A's box and inside the
  // reading area. They are the regulator's words about the community interest
  // test, and stored unstripped they read as though the company had written
  // them — which is exactly the confusion this column exists to avoid.
  /\d?\s*The community interest test is referred to in section 35[^]*?of the Regulations\.?/gi,
  /\d?\s*E\.?g\.?\s*[“"']the residents of Oldtown[^]*?disease[”"']\.?/gi,
  /\d?\s*A company is not eligible to be formed as a community interest company[^]*?completing this form\.?/gi,
  /\d?\s*This form will be placed on the public record[^]*?other documents\.?/gi,
  /\d?\s*On articles of association generally, see \[Part 5\][^]*?of your company\.?/gi,
];

/** True when this page is part of the CIC36 statement rather than the articles,
 *  the memorandum, or a PSC page. */
export function isStatementPage(page: OcrPage): boolean {
  if (page.meanConfidence < MIN_PAGE_CONFIDENCE) return false;
  return (
    STATEMENT_HEADING.test(page.text) ||
    SECTION_A_MARKER.test(page.text) ||
    (SECTION_B_HEADING.test(page.text) && /Activities/i.test(page.text))
  );
}

function tidy(value: string): string {
  const flattened = value
    // Hyphenation across a line break first, while the breaks are still there:
    // the form's boxes wrap mid-word ("struc-\ntured", "oppor-\ntunities"), and
    // stored as-is it reaches a reader — and a model — as two broken words.
    .replace(/(\w)-\s*\n\s*(\w)/g, "$1$2")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Boilerplate is stripped *after* flattening, not before. The form's printed
  // instructions wrap across several lines on the page, so a pattern written as
  // one sentence only matches once the line breaks are gone — which is why an
  // earlier ordering left "Please indicate how it is proposed that…" sitting in
  // the stored text.
  let text = flattened;
  for (const pattern of BOILERPLATE) text = text.replace(pattern, " ");
  return text.replace(/\s{2,}/g, " ").trim();
}

function capped(value: string): string | null {
  const text = tidy(value)
    // The prompt on the form ends "…will provide benefit to ...", and the
    // ellipsis is printed, not typed. Reading resumes after the prompt's words,
    // so the punctuation is what is left behind — as are stray marks the form
    // uses to point into the box.
    .replace(/^[\s.,;:•·—–\-*|\[\]()]+/u, "")
    .trim();
  if (text.length < 25) return null;
  if (text.length <= MAX_FIELD_CHARS) return text;
  // Cut at a word boundary — a field ending mid-word reads as corruption,
  // where one ending mid-sentence reads as the form's own clipping.
  const slice = text.slice(0, MAX_FIELD_CHARS);
  const lastSpace = slice.lastIndexOf(" ");
  return `${lastSpace > 0 ? slice.slice(0, lastSpace) : slice}…`;
}

/** Words grouped into visual lines, each line ordered left to right. */
function groupLines(words: OcrWord[]): OcrWord[][] {
  const sorted = [...words].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const lines: OcrWord[][] = [];

  for (const word of sorted) {
    const current = lines[lines.length - 1];
    // Same line when the vertical centres overlap by most of a line height.
    // Comparing y0 alone splits a line wherever a comma or a capital shifts the
    // box by a few pixels.
    const sameLine =
      current &&
      Math.abs((word.y0 + word.y1) / 2 - (current[0].y0 + current[0].y1) / 2) <
        (word.y1 - word.y0) * 0.7;
    if (sameLine) current.push(word);
    else lines.push([word]);
  }

  return lines.map((line) => [...line].sort((a, b) => a.x0 - b.x0));
}

/** Words in reading order, joined with the line breaks their positions imply. */
function wordsToText(words: OcrWord[]): string {
  return groupLines(words)
    .map((line) => line.map((word) => word.text).join(" "))
    .join("\n");
}

/**
 * The x-coordinate separating the two columns of the Section B table.
 *
 * Found from the data rather than assumed, because the divider sits in a
 * different place in different form versions. Words cluster into two bands with
 * a gutter between them; the widest gap between consecutive word-start
 * positions across the middle half of the page is that gutter.
 *
 * Returns null when there is no clear gutter, which is the honest answer for a
 * single-column page — and the caller then treats the page as prose rather than
 * inventing a split down the middle.
 */
export function columnDivider(words: OcrWord[], pageWidth: number): number | null {
  if (words.length < 20) return null;

  // Per line, not per page. Merging coverage across the whole page fills the
  // gutter in: the section heading, the form's instructions and the "COMPANY
  // NAME" box all run the full width and sit above the table. The gutter only
  // exists on the table's own rows, so the evidence has to be gathered a line
  // at a time and then voted on.
  const lowerBound = pageWidth * 0.2;
  const upperBound = pageWidth * 0.8;
  // A gutter is narrow — a few characters — but must beat the ordinary space
  // between two words, or every prose line looks like a table row.
  const minimumGap = pageWidth * 0.03;

  // Bucketed so that gaps at nearly the same x reinforce each other rather than
  // each voting for its own unique pixel.
  const bucketWidth = pageWidth * 0.01;
  const votes = new Map<number, { lines: number; total: number }>();

  for (const line of groupLines(words)) {
    for (let i = 1; i < line.length; i++) {
      const gapStart = line[i - 1].x1;
      const gapEnd = line[i].x0;
      const gap = gapEnd - gapStart;
      if (gap < minimumGap) continue;
      const centre = (gapStart + gapEnd) / 2;
      if (centre < lowerBound || centre > upperBound) continue;

      const bucket = Math.round(centre / bucketWidth);
      const tally = votes.get(bucket) ?? { lines: 0, total: 0 };
      tally.lines += 1;
      tally.total += centre;
      votes.set(bucket, tally);
    }
  }

  let best: { lines: number; total: number } | null = null;
  for (const tally of votes.values()) {
    if (!best || tally.lines > best.lines) best = tally;
  }

  // Three lines sharing a gap is a column; one or two is a coincidence — a
  // short line followed by a wide indent, or a heading with centred text.
  if (!best || best.lines < 3) return null;
  return best.total / best.lines;
}

/** Section A's prose: everything below the "provide benefit to" prompt. */
function sectionA(page: OcrPage): string | null {
  // The index just past the prompt, not the word that starts it. The company's
  // own answer usually continues on the same line as the prompt — "…will
  // provide benefit to charities, community groups," — so dropping the prompt's
  // whole line, which an earlier version did, cut the first words off the
  // statement.
  let afterMarker = -1;
  let marker: OcrWord | undefined;
  for (let index = 0; index < page.words.length && afterMarker === -1; index++) {
    for (let span = 2; span <= 8 && index + span <= page.words.length; span++) {
      const phrase = page.words
        .slice(index, index + span)
        .map((w) => w.text)
        .join(" ");
      if (SECTION_A_MARKER.test(phrase)) {
        marker = page.words[index];
        afterMarker = index + span;
        break;
      }
    }
  }

  // Some filings print Section A's text above the prompt rather than below it,
  // under the "[Insert a short description…]" instruction instead. With no
  // prompt to anchor on, take the page below its heading.
  const heading = page.words.find((word, index) =>
    SECTION_A_HEADING.test(
      page.words
        .slice(index, index + 3)
        .map((w) => w.text)
        .join(" "),
    ),
  );

  const anchor = marker ?? heading;
  if (!anchor) return null;

  // Section A stops where Section B starts. On version 9 both sections share a
  // page, and without this the beneficiaries field swallowed Section B's
  // heading and its whole block of printed instructions — which then read as
  // though the company had written them.
  const sectionBHeading = page.words.find((word, index) =>
    SECTION_B_HEADING.test(
      page.words
        .slice(index, index + 3)
        .map((w) => w.text)
        .join(" "),
    ),
  );
  const floor = sectionBHeading && sectionBHeading.y0 > anchor.y0 ? sectionBHeading.y0 : Infinity;

  // With a prompt anchor, resume at the word after it — Tesseract's word order
  // is reliable here because Section A is single-column prose. With only a
  // heading to go on, fall back to everything below that heading.
  const words = marker
    ? page.words.slice(afterMarker).filter((word) => word.y0 < floor)
    : page.words.filter((word) => word.y0 >= anchor.y0 && word.y0 < floor);

  return capped(wordsToText(words));
}

/** Section B's left column: what the company actually does day to day. */
function sectionB(page: OcrPage, pageWidth: number): string | null {
  const divider = columnDivider(page.words, pageWidth);
  if (divider === null) return null;

  const kept: OcrWord[] = [];
  let started = false;

  for (const rawLine of groupLines(page.words)) {
    // The table's vertical rule is read as a word — usually "|", sometimes "l"
    // or "i". Left in, it straddles the divider and disqualifies the row it
    // borders, which cost whole sentences out of the middle of the activities
    // text. It carries no meaning, so it is dropped before anything is decided.
    const line = rawLine.filter((word) => /[\p{L}\p{N}&]/u.test(word.text));
    if (line.length === 0) continue;

    const lineText = line.map((word) => word.text).join(" ");

    // Checked before the straddle test, not after: the surplus box's prompt is
    // itself a full-width line, so testing it later meant the line was skipped
    // and the box's contents ran on into the activities.
    if (/If the company makes any surplus/i.test(lineText)) break;

    // Everything above the "Activities" column header is the form talking —
    // the section heading, its instructions, the COMPANY NAME box. Some of
    // those lines happen to break at the divider and survive the straddle test
    // as half-sentences ("a section of the community."), so the top of the
    // table is anchored explicitly rather than filtered pattern by pattern.
    //
    // Anchored on the *left column's* text, because the header line carries
    // both column titles — "Activities   How will the activity benefit the
    // community?" — so matching against the whole line never fires.
    // Assigned on the word's centre, not its right edge. Tesseract sometimes
    // fuses the table's vertical rule onto the last word of a left cell, which
    // pushes that word's x1 past the divider — and testing x1 dropped the final
    // word of several lines ("...youth club activities and employability" lost
    // its last word on every row that touched the border).
    const leftWords = line.filter((word) => (word.x0 + word.x1) / 2 <= divider);
    if (!started) {
      const leftText = leftWords
        .map((word) => word.text)
        .join(" ")
        .trim();
      if (/^\(?Activities\)?$/i.test(leftText)) started = true;
      continue;
    }
    // No straddle test here, deliberately. Full-width text is what it would
    // guard against, and the `started` anchor above has already excluded all of
    // it — the heading, the instructions, the COMPANY NAME box all sit before
    // the "Activities" column header. Below that header the only full-width
    // things left are handled by name: the surplus box breaks the loop, and the
    // form's own captions are stripped as boilerplate.
    //
    // Keeping it cost real sentences. Tesseract sometimes fuses the table's
    // vertical rule onto the last word of a left cell ("employability|"), and
    // the resulting box crosses the divider, so the row it borders was thrown
    // away mid-sentence — which is how "creative arts and struc-" came to be
    // joined to "provide inclusive support" as "strucprovide".

    kept.push(...leftWords);
  }

  return capped(wordsToText(kept));
}

/**
 * Reads the statement out of whichever of the supplied pages carry it.
 *
 * Takes every candidate page rather than one, because the two sections sit on
 * different pages in most form versions and on the same page in others. The
 * first non-empty answer for each section wins: pages arrive last-first, and a
 * later page of a section is a continuation of an earlier one, so an earlier
 * page is the more complete answer.
 */
export function extractStatement(
  pages: readonly { page: OcrPage; width: number }[],
): CicStatement {
  const statementPages = pages.filter(({ page }) => isStatementPage(page));
  if (statementPages.length === 0) {
    return { beneficiaries: null, activities: null, confidence: 0 };
  }

  let beneficiaries: string | null = null;
  let activities: string | null = null;

  for (const { page, width } of statementPages) {
    beneficiaries ??= sectionA(page);
    activities ??= sectionB(page, width);
  }

  const confidence =
    statementPages.reduce((total, { page }) => total + page.meanConfidence, 0) /
    statementPages.length;

  return { beneficiaries, activities, confidence };
}

/**
 * The single string stored on the organisation.
 *
 * Labelled rather than concatenated: the two sections answer different
 * questions, and a reader — or a model writing a booklet — that cannot tell
 * "who this is for" from "what they do" will merge them into a claim the
 * company never made. Returns null when there is nothing worth storing, which
 * is what leaves the column null with the cursor set.
 */
export function formatStatement(statement: CicStatement): string | null {
  const parts: string[] = [];
  if (statement.beneficiaries) parts.push(`Community benefited: ${statement.beneficiaries}`);
  if (statement.activities) parts.push(`Activities: ${statement.activities}`);
  return parts.length > 0 ? parts.join("\n\n") : null;
}
