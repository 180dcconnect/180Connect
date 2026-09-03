/**
 * Pulls the current register file into the deployment during the build.
 *
 * Runs as `prebuild`, so `next build` — including every Vercel build — collects
 * the file automatically. Nobody runs this by hand.
 *
 * ── Why the REST API and not the plain download URL ──
 *
 * The obvious URL is
 * `github.com/{owner}/{repo}/releases/download/{tag}/{asset}`. That works for a
 * public repository and **silently 404s for a private one**, because it is the
 * browser download path and authenticates by session cookie, not by token.
 *
 * This repository goes private shortly. Combined with the never-fail-the-build
 * rule below, the plain URL would have produced the worst kind of failure: green
 * deployments where the register had quietly vanished, with nothing to point at.
 *
 * So the asset is resolved through the REST API instead — look the release up by
 * tag, find the asset id, then request that asset with
 * `Accept: application/octet-stream`. That path works unauthenticated for a
 * public repository and with a token for a private one, so nothing changes on
 * the day the repository flips.
 *
 * (The API redirects the asset request to a signed storage URL. `fetch` drops
 * the Authorization header on a cross-origin redirect, which is exactly right —
 * the signed URL carries its own credentials and rejects a second set.)
 *
 * ── Never fails the build ──
 *
 * A missing or unreachable register must not stop a deployment. The rest of the
 * app has nothing to do with charity imports, and a release blocked because
 * GitHub was slow would be far worse than an import screen that says "the
 * register is not loaded" for an hour. The screen handles the file being absent
 * and says so plainly, with the refresh button next to it.
 *
 * Skipped entirely when the file is already present, so a local build after a
 * manual `npm run register:build` does not re-download 180MB.
 */

import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname } from "node:path";

const OUT = process.env.REGISTER_DB_PATH?.trim() || "data/register.sqlite";

/**
 * The one long-lived release the refresh workflow replaces in place, so there
 * is exactly one answer to "which register is current". Overridable for a fork.
 */
const REPO = process.env.REGISTER_REPO?.trim() || "180dcconnect/180Connect";
const TAG = process.env.REGISTER_RELEASE_TAG?.trim() || "charity-register";
const ASSET = "register.sqlite";

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
  console.log(`[register:fetch] ${reason}`);
  console.log("[register:fetch] Continuing without it — the import screen will say so.");
}

type ReleaseAsset = { id: number; name: string; size: number };

async function main(): Promise<void> {
  if (existsSync(OUT)) {
    const megabytes = statSync(OUT).size / 1_048_576;
    console.log(`[register:fetch] ${OUT} already present (${megabytes.toFixed(1)}MB), skipping.`);
    return;
  }

  const apiBase = `https://api.github.com/repos/${REPO}`;
  console.log(`[register:fetch] looking up ${REPO} release "${TAG}"`);

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
        ? `no "${TAG}" release on ${REPO} — run the Refresh register workflow once to create it.`
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
    `[register:fetch] downloading ${ASSET} (${(asset.size / 1_048_576).toFixed(1)}MB)`,
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
  // Streamed to disk rather than buffered: the file is ~180MB and a build
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

  console.log(`[register:fetch] wrote ${OUT} — ${(written / 1_048_576).toFixed(1)}MB`);
}

await main();
