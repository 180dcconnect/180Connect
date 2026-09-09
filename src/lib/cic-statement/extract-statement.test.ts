import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  columnDivider,
  extractStatement,
  formatStatement,
  isStatementPage,
} from "./extract-statement.ts";
import type { OcrPage, OcrWord } from "./ocr.ts";

/**
 * Recorded Tesseract output from four real CIC36 filings, kept as OCR results
 * rather than as PDFs.
 *
 * The fixture is deliberately the *output* of OCR and not the input: running
 * Tesseract in the test suite would make it slow, make it depend on a 5.2MB
 * language file, and — worst — make it non-deterministic, so a failure could
 * mean the extractor regressed or could mean the engine did. Everything this
 * module can get wrong is a decision about text and geometry, and that is
 * exactly what these fixtures hold.
 *
 * Four filings across three form versions, because the layout is not stable:
 *
 *   v9-single-page   Sections A and B share one page.
 *   v12-two-page     Sections on separate pages, digital print.
 *   v13-two-page     Sections on separate pages, prompt and answer on one line.
 *   v13-photocopy    A genuine photocopy — speckled, skewed, 88.6 confidence.
 */
const FIXTURES = JSON.parse(
  readFileSync(new URL("./__fixtures__/ocr-pages.json", import.meta.url), "utf8"),
) as Record<
  string,
  { pageNumber: number; width: number; meanConfidence: number; text: string; words: OcrWord[] }[]
>;

function pagesFor(name: string): { page: OcrPage; width: number }[] {
  const pages = FIXTURES[name];
  assert.ok(pages?.length, `fixture ${name} is missing`);
  return pages.map((p) => ({
    page: { text: p.text, words: p.words, meanConfidence: p.meanConfidence },
    width: p.width,
  }));
}

/**
 * Lays out lines of text as single-column word boxes.
 *
 * For asserting text handling — boilerplate stripping, hyphen joining — where
 * the geometry is incidental. Anything about columns uses the recorded
 * fixtures, because a hand-built two-column layout would only ever prove that
 * the extractor agrees with my idea of the form.
 */
function wordsFrom(lines: string[]): OcrWord[] {
  const words: OcrWord[] = [];
  lines.forEach((line, row) => {
    let x = 160;
    for (const text of line.split(" ")) {
      const width = text.length * 12;
      words.push({
        text,
        confidence: 95,
        x0: x,
        x1: x + width,
        y0: 200 + row * 40,
        y1: 228 + row * 40,
      });
      x += width + 10;
    }
  });
  return words;
}

describe("isStatementPage", () => {
  it("accepts the statement pages of every sampled form version", () => {
    for (const name of Object.keys(FIXTURES)) {
      for (const { page } of pagesFor(name)) {
        assert.equal(isStatementPage(page), true, `${name} should be a statement page`);
      }
    }
  });

  it("rejects a page of illegible noise", () => {
    // Confidence, not content: a blank or speckled scan still yields "words",
    // and without this gate they would be stored as a company's mission.
    const noise: OcrPage = {
      text: "COMMUNITY INTEREST STATEMENT",
      words: [],
      meanConfidence: 20,
    };
    assert.equal(isStatementPage(noise), false);
  });

  it("rejects an ordinary page of the articles of association", () => {
    const articles: OcrPage = {
      text: "INDEX TO THE ARTICLES\n1. Defined Terms\n2. Community Interest Company\n3. Asset Lock",
      words: [],
      meanConfidence: 95,
    };
    assert.equal(isStatementPage(articles), false);
  });
});

describe("columnDivider", () => {
  it("finds the gutter on a Section B table", () => {
    // The three sampled Section B tables put the divider at 591-614px on a
    // ~1655px page. Anything in that band is the real gutter.
    const tables = pagesFor("v12-two-page")
      .concat(pagesFor("v13-two-page"), pagesFor("v13-photocopy"))
      .filter(({ page }) => /SECTION\s*B/i.test(page.text));

    assert.ok(tables.length >= 3, "expected at least three Section B pages");
    for (const { page, width } of tables) {
      const divider = columnDivider(page.words, width);
      assert.ok(divider !== null, "expected a divider on a Section B page");
      assert.ok(
        divider > width * 0.3 && divider < width * 0.45,
        `divider ${divider} is not in the gutter band for width ${width}`,
      );
    }
  });

  it("returns null for single-column prose", () => {
    // The honest answer for a page with no table. Returning a made-up midpoint
    // would split a paragraph down the middle and store half of it.
    const prose = pagesFor("v12-two-page").find(
      ({ page }) => !/SECTION\s*B/i.test(page.text),
    );
    assert.ok(prose, "expected a prose page in the fixture");
    assert.equal(columnDivider(prose.page.words, prose.width), null);
  });

  it("returns null rather than guessing when there is almost nothing to go on", () => {
    assert.equal(columnDivider([], 1654), null);
  });
});

describe("extractStatement", () => {
  it("reads the activities column without the neighbouring column's text", () => {
    const { activities } = extractStatement(pagesFor("v12-two-page"));

    // The two columns sit on the same visual lines, and Tesseract's reading
    // order interleaves them. If the geometry split ever breaks, the right
    // column's wording appears here — so assert its absence, not just the
    // left column's presence.
    assert.ok(activities);
    assert.match(activities, /will provide tutoring \(including 1-1 support\), mentoring/);
    assert.match(activities, /creative arts and structured wellbeing sessions/);
    assert.doesNotMatch(activities, /reduce isolation and anti-social behaviour/);
    assert.doesNotMatch(activities, /recognised qualifications/);
  });

  it("keeps the form's printed instructions out of the company's words", () => {
    for (const name of Object.keys(FIXTURES)) {
      const statement = extractStatement(pagesFor(name));
      const stored = formatStatement(statement) ?? "";
      assert.doesNotMatch(stored, /Please indicate how it is proposed/i, name);
      assert.doesNotMatch(stored, /Please continue separate sheet/i, name);
      assert.doesNotMatch(stored, /Last Updated on/i, name);
      assert.doesNotMatch(stored, /COMPANY NAME/, name);
      assert.doesNotMatch(stored, /How will the activity benefit the community/i, name);
    }
  });

  it("starts the beneficiaries text at the company's own first word", () => {
    // On this form version the answer continues on the same line as the prompt.
    // Anchoring by line rather than by word once cut "charities, community
    // groups," off the front and began the stored text mid-sentence.
    const { beneficiaries } = extractStatement(pagesFor("v13-two-page"));
    assert.ok(beneficiaries);
    assert.match(beneficiaries, /^charities, community groups, and churches across Scotland/);
  });

  it("does not begin with the ellipsis the form prints after its prompt", () => {
    for (const name of Object.keys(FIXTURES)) {
      const { beneficiaries } = extractStatement(pagesFor(name));
      if (beneficiaries) assert.doesNotMatch(beneficiaries, /^[.\s…]/, name);
    }
  });

  it("stops Section A where Section B begins on a shared page", () => {
    // Version 9 puts both sections on one page. Without a floor, the
    // beneficiaries field swallowed Section B's heading and its whole block of
    // printed instructions.
    const { beneficiaries } = extractStatement(pagesFor("v9-single-page"));
    assert.ok(beneficiaries);
    assert.match(beneficiaries, /Sensory Pit Stops Global CIC will design, deliver and manage/);
    assert.doesNotMatch(beneficiaries, /SECTION B/i);
    assert.doesNotMatch(beneficiaries, /different from a commercial company/i);
  });

  it("reads a genuine photocopy, not just a digital print", () => {
    const statement = extractStatement(pagesFor("v13-photocopy"));
    assert.ok(statement.confidence > 80);
    assert.ok(statement.beneficiaries);
    assert.match(statement.beneficiaries, /Communities throughout the world/);
    assert.ok(statement.activities);
    assert.match(statement.activities, /Application for Arts Council Funding/);
  });

  it("rejoins words the form's box wrapped mid-word", () => {
    // "struc-\ntured" and "oppor-\ntunities" are how the boxes wrap. Stored
    // unjoined they reach a reader, and a model, as two broken words.
    const stored = formatStatement(extractStatement(pagesFor("v12-two-page"))) ?? "";
    assert.match(stored, /structured wellbeing/);
    assert.doesNotMatch(stored, /struc\s+tured/);
  });

  it("strips the form's own footnotes from below Section A's box", () => {
    // These sit inside the reading area under Section A and are the
    // regulator's words about the community interest test. Two live filings
    // stored them as though the company had written them.
    const withFootnotes = extractStatement([
      {
        page: {
          text: "SECTION A: COMMUNITY INTEREST STATEMENT",
          meanConfidence: 94,
          words: wordsFrom([
            "The company's activities will provide benefit to",
            "vulnerable adults across the UK who need real support.",
            "2 The community interest test is referred to in section 35 of the",
            "Companies (Audit, Investigations and Community Enterprise) Act 2004",
            "and is expanded upon in regulations 3, 4 & 5 of the Regulations.",
            "3 E.g. \u201Cthe residents of Oldtown\u201D or \u201Cthose suffering from XYZ disease\u201D.",
            "Version 13 ~ Last Updated on 14/08/2023",
          ]),
        },
        width: 1654,
      },
    ]);

    assert.equal(
      withFootnotes.beneficiaries,
      "vulnerable adults across the UK who need real support.",
    );
  });

  it("strips the form's table rules where OCR read them as characters", () => {
    // A photocopied border comes back as glyphs, and the stored statement
    // opened with a hedge of them. Real case, staging: CREWKERNE BUSINESS
    // GROUP CIC.
    const { beneficiaries } = extractStatement([
      {
        page: {
          text: [
            "SECTION A",
            "the company's activities will provide benefit to ...",
            "i i ... i : i { : ] | Our business community here in Crewkerne and our local population | | | | . . .",
          ].join("\n"),
          words: wordsFrom([
            "SECTION A",
            "the company's activities will provide benefit to ...",
            "i i ... i : i { : ] | Our business community here in Crewkerne and our local population | | | | . . .",
          ]),
          meanConfidence: 88,
        },
        width: 1654,
      },
    ]);

    assert.ok(beneficiaries);
    assert.match(beneficiaries, /^Our business community here in Crewkerne/);
    assert.doesNotMatch(beneficiaries, /[|{}\][]/);
    // And no residue on the end, where a lone glyph has no neighbour to make a
    // run with.
    assert.doesNotMatch(beneficiaries, /\s\S{0,3}\.{2,}$/);
  });

  it("leaves single letters and punctuation that are actually words alone", () => {
    // The rule stripper matches bare `i`, `l` and `I`, so it must not fire on
    // "i.e.", a colon after a heading word, or a first-person sentence. Only a
    // run of two or more such tokens is a border.
    const lines = [
      "SECTION A",
      "the company's activities will provide benefit to ...",
      "adults, i.e. people over 18, and their families. Our aims: training and",
      "employability support. I am the sole director and I will deliver it.",
    ];
    const { beneficiaries } = extractStatement([
      {
        page: { text: lines.join("\n"), words: wordsFrom(lines), meanConfidence: 95 },
        width: 1654,
      },
    ]);

    assert.ok(beneficiaries);
    assert.match(beneficiaries, /i\.e\. people over 18/);
    assert.match(beneficiaries, /Our aims: training/);
    assert.match(beneficiaries, /I am the sole director and I will deliver it\./);
  });

  it("drops the form's COMPANY NAME field where it bled into the answer", () => {
    // Real case, staging: THE BABBLING BREW C.I.C. stored
    // "…and the local area. COMPANY NAME The Babbling Brew or".
    const lines = [
      "SECTION A",
      "the company's activities will provide benefit to ...",
      "local young families in Kendal and the local area.",
      "COMPANY NAME The Babbling Brew or",
    ];
    const { beneficiaries } = extractStatement([
      {
        page: { text: lines.join("\n"), words: wordsFrom(lines), meanConfidence: 95 },
        width: 1654,
      },
    ]);

    assert.ok(beneficiaries);
    assert.match(beneficiaries, /local young families in Kendal and the local area\.$/);
    assert.doesNotMatch(beneficiaries, /COMPANY NAME|Babbling Brew/);
  });

  it("keeps an ellipsis the form's own box clipped mid-sentence", () => {
    // The trailing trim must not eat this: attached to the word, it is the
    // company's text running out of box, not a border glyph.
    const lines = [
      "SECTION A",
      "the company's activities will provide benefit to ...",
      "young people seeking employability support across West Yorkshire and Leeds...",
    ];
    const { beneficiaries } = extractStatement([
      {
        page: { text: lines.join("\n"), words: wordsFrom(lines), meanConfidence: 95 },
        width: 1654,
      },
    ]);

    assert.ok(beneficiaries);
    assert.match(beneficiaries, /Leeds\.\.\.$/);
  });

  it("returns nothing at all when no page carries a statement", () => {
    const statement = extractStatement([
      {
        page: { text: "Statement of Guarantee\nName: A PERSON", words: [], meanConfidence: 95 },
        width: 1654,
      },
    ]);
    assert.deepEqual(statement, { beneficiaries: null, activities: null, confidence: 0 });
    assert.equal(formatStatement(statement), null);
  });
});

describe("formatStatement", () => {
  it("labels the two sections rather than running them together", () => {
    // They answer different questions. A reader — or a booklet model — that
    // cannot tell "who this is for" from "what they do" will merge them into a
    // claim the company never made.
    const stored = formatStatement({
      beneficiaries: "Young people in Sheffield who are not in education or training.",
      activities: "Weekly drop-in sessions and one-to-one mentoring.",
      confidence: 94,
    });
    assert.equal(
      stored,
      "Community benefited: Young people in Sheffield who are not in education or training.\n\n" +
        "Activities: Weekly drop-in sessions and one-to-one mentoring.",
    );
  });

  it("stores whichever half was found when the other is missing", () => {
    assert.equal(
      formatStatement({ beneficiaries: null, activities: "Runs a food bank.", confidence: 90 }),
      "Activities: Runs a food bank.",
    );
  });

  it("is null when there is nothing worth storing", () => {
    assert.equal(
      formatStatement({ beneficiaries: null, activities: null, confidence: 0 }),
      null,
    );
  });
});
