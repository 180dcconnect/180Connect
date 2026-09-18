/**
 * Pulls the OCR language data into the deployment during the build.
 *
 * Runs as part of `prebuild`, beside the two register fetches, for the same
 * reason they do: the CIC36 statement job needs a file that is too big and too
 * static to live in git, and it must be present before anything asks for it.
 *
 * ── Why not let tesseract.js download it ──
 *
 * Left alone, tesseract.js fetches `eng.traineddata` from a CDN the first time
 * a worker starts and writes it into the working directory. Every part of that
 * is wrong here: a 5.2MB download lands in the middle of a job rather than in
 * the build, the working directory is read-only in a serverless function, and
 * the CDN is a host nobody has reviewed. Fetching it here makes it a build
 * input like the register files.
 *
 * ── Never fails the build ──
 *
 * Same rule as scripts/fetch-register.mts. The rest of the app has nothing to
 * do with CIC statements, and a release blocked because GitHub was slow would
 * be far worse than a backfill that says "the OCR language data is not present"
 * until someone runs this again. `ocrUnavailableReason()` is the check that
 * turns a missing file into that sentence instead of a crash.
 *
 * Skipped entirely when the file is already there, so a local build after a
 * manual run does not re-download it.
 */

import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname } from "node:path";

const OUT = process.env.TESSERACT_ENG_PATH?.trim() || "data/eng.traineddata";

/**
 * tessdata_fast, not tessdata_best. These are 200 DPI scans of printed forms —
 * the easiest thing OCR is ever asked to read — and the fast model scored 94.5,
 * 94.7 and 88.6 mean word confidence across the sampled filings. The best model
 * is several times the size and several times slower per page for accuracy this
 * job does not need.
 *
 * Pinned to a tag rather than to `main`: the traineddata format is versioned
 * against the engine, and a silently updated model would change what the job
 * transcribes with nothing in the diff to say so.
 */
const URL_ =
  process.env.TESSERACT_ENG_URL?.trim() ||
  "https://github.com/tesseract-ocr/tessdata_fast/raw/4.1.0/eng.traineddata";

/** Below this the response is an error page or a truncated download, not a
 *  model — the real file is ~5.2MB. Cheaper to catch here than as a confusing
 *  failure inside a WASM worker. */
const MIN_PLAUSIBLE_BYTES = 1_000_000;

function skip(reason: string): void {
  console.log(`[tesseract:fetch] ${reason}`);
  console.log("[tesseract:fetch] Continuing without it — the CIC statement job will say so.");
}

async function main(): Promise<void> {
  if (existsSync(OUT)) {
    const megabytes = statSync(OUT).size / 1_048_576;
    console.log(`[tesseract:fetch] ${OUT} already present (${megabytes.toFixed(1)}MB), skipping.`);
    return;
  }

  mkdirSync(dirname(OUT), { recursive: true });

  let response: Response;
  try {
    response = await fetch(URL_, { redirect: "follow" });
  } catch (error) {
    skip(`Could not reach ${URL_}: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  if (!response.ok || !response.body) {
    skip(`${URL_} returned ${response.status}.`);
    return;
  }

  // Downloaded to a temporary name and renamed on success, so an interrupted
  // run cannot leave a half-written file that looks present to every later
  // check and fails deep inside the OCR worker instead.
  const partial = `${OUT}.partial`;
  try {
    // `as never` on the body, as both register fetches do: the DOM and Node
    // ReadableStream types do not line up, and this is the seam.
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(partial));
  } catch (error) {
    skip(`Download failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const bytes = statSync(partial).size;
  if (bytes < MIN_PLAUSIBLE_BYTES) {
    skip(`Downloaded only ${bytes} bytes — that is not the language model.`);
    return;
  }

  renameSync(partial, OUT);
  console.log(`[tesseract:fetch] Wrote ${OUT} (${(bytes / 1_048_576).toFixed(1)}MB).`);
}

await main();
