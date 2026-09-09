import "server-only";

import { existsSync } from "node:fs";
import { join } from "node:path";

import { createWorker, type Worker } from "tesseract.js";

/**
 * Reading a scanned page.
 *
 * ── Why an OCR engine and not a model ──
 *
 * The whole point of this column is that the text is the company's own filed
 * words. Tesseract transcribes; it does not compose. When it cannot read a word
 * it produces something wrong, which is a defect we can measure and a reviewer
 * can spot. A language model asked to read the same page can produce something
 * plausible that was never on it, which is a defect nobody can spot — and it
 * would put generated text in a field the Data Model now guarantees is filed
 * register text. That guarantee is the feature.
 *
 * Measured on three sampled filings, mean word confidence 94.5, 94.7 and 88.2
 * (the last a genuine photocopy rather than a digital print).
 *
 * ── Why word boxes, not just text ──
 *
 * Section B of the CIC36 is a two-column table: "Activities" on the left, "How
 * will the activity benefit the community?" on the right. Tesseract's reading
 * order walks across both, so its plain text output interleaves them —
 * "25TH Education & Training CIC | The community will benefit through improved
 * education" arrives as one line. Recovering the columns needs each word's
 * position, so `recognise` returns geometry and extract-statement.ts does the
 * splitting. This is not an optimisation; without it the stored text is two
 * documents shuffled together.
 */

/** One recognised word and where it sat on the page. */
export type OcrWord = {
  text: string;
  confidence: number;
  /** Page pixels, origin top-left. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
};

export type OcrPage = {
  /** Tesseract's own reading order. Correct for prose, interleaved for tables. */
  text: string;
  words: OcrWord[];
  /** Mean word confidence, 0-100. A page of noise still returns words, and this
   *  is the only signal that separates "read a page" from "read the speckles". */
  meanConfidence: number;
};

/**
 * Where the language data is looked for, in the same shape as the register
 * files' path resolution.
 *
 * It matters that this is local. Left to itself tesseract.js downloads
 * `eng.traineddata` from a CDN on first use and writes it to the working
 * directory — a 5.2MB fetch in the middle of a job, onto a filesystem that is
 * read-only in a serverless function, from a host that is not on any allowlist.
 * `npm run tesseract:fetch` puts it in `data/` beside the register files and
 * this points at it.
 */
function languagePath(): string | null {
  const configured = process.env.TESSERACT_LANG_PATH?.trim();
  const candidates = [
    ...(configured ? [configured] : []),
    join(process.cwd(), "data"),
    "/tmp",
  ];
  return candidates.find((dir) => existsSync(join(dir, "eng.traineddata"))) ?? null;
}

/** Why OCR cannot run here, or null when it can. Checked before a job starts so
 *  the admin screen can say what is missing rather than failing per company. */
export function ocrUnavailableReason(): string | null {
  return languagePath() === null
    ? "The OCR language data is not present. Run `npm run tesseract:fetch`."
    : null;
}

/**
 * A Tesseract worker, and the pages it has been asked to read.
 *
 * Worker startup costs a few seconds — it initialises WASM and loads the
 * language data — so one worker reads every page of every filing in a run
 * rather than one per page. `close()` is the caller's responsibility and must
 * run in a `finally`: an un-terminated worker keeps a process alive, which
 * turns a finished script into one that hangs.
 */
export type OcrSession = {
  recognise(png: Buffer): Promise<OcrPage>;
  close(): Promise<void>;
};

export async function startOcr(): Promise<OcrSession> {
  const langPath = languagePath();
  if (!langPath) throw new Error(ocrUnavailableReason() ?? "OCR is unavailable.");

  // `gzip: false` because the fetch script stores the file uncompressed; the
  // library otherwise looks for eng.traineddata.gz and reports the miss as a
  // download failure.
  const worker: Worker = await createWorker("eng", undefined, {
    langPath,
    gzip: false,
    // The library's default logger prints a progress line per page, which for
    // several hundred filings is thousands of lines of noise around the few
    // lines a caller actually wants.
    logger: () => {},
  });

  return {
    async recognise(png: Buffer): Promise<OcrPage> {
      const { data } = await worker.recognize(png, {}, { text: true, blocks: true });

      const words: OcrWord[] = (data.blocks ?? []).flatMap((block) =>
        (block.paragraphs ?? []).flatMap((paragraph) =>
          (paragraph.lines ?? []).flatMap((line) =>
            (line.words ?? []).map((word) => ({
              text: word.text,
              confidence: word.confidence,
              x0: word.bbox.x0,
              x1: word.bbox.x1,
              y0: word.bbox.y0,
              y1: word.bbox.y1,
            })),
          ),
        ),
      );

      const meanConfidence =
        words.length > 0
          ? words.reduce((total, word) => total + word.confidence, 0) / words.length
          : 0;

      return { text: data.text ?? "", words, meanConfidence };
    },

    async close() {
      await worker.terminate();
    },
  };
}
