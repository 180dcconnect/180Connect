/**
 * Pulls the current companies-register file into the deployment during the build.
 *
 * Runs as `prebuild` (alongside fetch-register.mts), so `next build` —
 * including every Vercel build — collects the file automatically. Nobody runs
 * this by hand.
 *
 * Same contract as fetch-register.mts: the asset resolves through the REST
 * API (works for public and private repositories alike), and a missing or
 * unreachable file never fails the build — the import screen says the
 * register is not loaded instead. Skipped entirely when the file is already
 * present, so a local build after a manual `npm run companies-register:build`
 * does not re-download ~190MB.
 */

import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname } from "node:path";

const OUT = process.env.COMPANIES_REGISTER_DB_PATH?.trim() || "data/companies-register.sqlite";

/**
 * The one long-lived release the refresh workflow replaces in place, so there
 * is exactly one answer to "which companies register is current".
 * Overridable for a fork.
 */
const REPO = process.env.REGISTER_REPO?.trim() || "180dcconnect/180Connect";
const TAG = process.env.COMPANIES_REGISTER_RELEASE_TAG?.trim() || "companies-register";
const ASSET = "companies-register.sqlite";

/**
 * Optional while the repository is public; required once it is private.
 * `GITHUB_TOKEN` is the fallback so the workflow itself needs no extra secret.
 */
function token(): string | null {
  return (
    process.env.REGISTER_DOWNLOAD_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim() || null
  );
}

function authHeaders(): Record<string, string> {
  const value = token();
  return value ? { Authorization: `Bearer ${value}` } : {};
}

function skip(reason: string): void {
  console.log(`[companies-register:fetch] ${reason}`);
  console.log("[companies-register:fetch] Continuing without it — the import screen will say so.");
}

type ReleaseAsset = { id: number; name: string; size: number };

async function main(): Promise<void> {
  if (existsSync(OUT)) {
    const megabytes = statSync(OUT).size / 1_048_576;
    console.log(`[companies-register:fetch] ${OUT} already present (${megabytes.toFixed(1)}MB), skipping.`);
    return;
  }

  const apiBase = `https://api.github.com/repos/${REPO}`;
  console.log(`[companies-register:fetch] looking up ${REPO} release "${TAG}"`);

  let release: Response;
  try {
    release = await fetch(`${apiBase}/releases/tags/${TAG}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...authHeaders(),
      },
    });
  } catch (error) {
    skip(`could not reach GitHub: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  if (release.status === 404) {
    skip(
      token()
        ? `no "${TAG}" release on ${REPO} — run the Refresh companies register workflow once to create it.`
        : `no "${TAG}" release on ${REPO}. If the repository is private, set ` +
            `REGISTER_DOWNLOAD_TOKEN to a token with Contents: Read on it.`,
    );
    return;
  }
  if (!release.ok) {
    skip(`GitHub returned ${release.status} looking up the release.`);
    return;
  }

  const asset = ((await release.json()) as { assets?: ReleaseAsset[] }).assets?.find(
    (candidate) => candidate.name === ASSET,
  );
  if (!asset) {
    skip(`the "${TAG}" release has no ${ASSET} asset.`);
    return;
  }

  console.log(
    `[companies-register:fetch] downloading ${ASSET} (${(asset.size / 1_048_576).toFixed(1)}MB)`,
  );

  let download: Response;
  try {
    download = await fetch(`${apiBase}/releases/assets/${asset.id}`, {
      // The header that turns this from JSON metadata into the file itself.
      headers: { Accept: "application/octet-stream", ...authHeaders() },
      redirect: "follow",
    });
  } catch (error) {
    skip(`download failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  if (!download.ok || !download.body) {
    skip(`GitHub returned ${download.status} downloading the asset.`);
    return;
  }

  mkdirSync(dirname(OUT), { recursive: true });
  // Streamed to disk rather than buffered: the file is ~190MB and a build
  // container should not hold that in memory to write it straight out again.
  await pipeline(Readable.fromWeb(download.body as never), createWriteStream(OUT));

  const written = statSync(OUT).size;
  if (asset.size > 0 && written !== asset.size) {
    // A truncated download would leave a corrupt SQLite file that opens and then
    // returns wrong answers, which is worse than having no register at all.
    skip(
      `downloaded ${written} bytes but the asset is ${asset.size} — treating as failed.`,
    );
    return;
  }

  console.log(`[companies-register:fetch] wrote ${OUT} — ${(written / 1_048_576).toFixed(1)}MB`);
}

await main();
