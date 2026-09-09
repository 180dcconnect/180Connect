import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The 180DC Sheffield flyer, attached to first-contact outreach.
 *
 * WHY A REPO ASSET AND NOT AN UPLOAD: the flyer belongs to the branch, not to
 * any one client, and `attachments` is keyed per organisation
 * (`<organisation_id>/<attachment_id>-<filename>`, 20260823090000). Storing it
 * there would mean one copy per client — pointless duplication of an identical
 * file, against a 1 GB Storage quota (AGENTS.md "Infrastructure budget").
 * Shipping it with the code costs nothing at runtime and nothing in Supabase.
 *
 * WHY 1.3 MB AND NOT THE 4.8 MB ORIGINAL: the source export stored its four
 * cut-out photographs losslessly at print resolution — 91% of the file. Those
 * were re-encoded at screen resolution with their alpha masks intact, which is
 * visually identical in a mail client and leaves real headroom under the 5-10 MB
 * cap some charity mail servers enforce. Deliverability was measured, not
 * assumed: an outreach email carrying even the uncompressed flyer scored 10/10
 * on mail-tester with no SpamAssassin rule against the attachment, so size here
 * is about bounce risk alone.
 */
export const FLYER_FILENAME = "180DC Sheffield - What we do.pdf";
export const FLYER_CONTENT_TYPE = "application/pdf";

const FLYER_PATH = path.join(process.cwd(), "src/lib/outreach/assets/180dc-sheffield-flyer.pdf");

/**
 * Read once per process, then reuse. The file never changes between deploys,
 * and re-reading 1.3 MB on every send would be pure waste. The promise itself
 * is cached, so concurrent sends in one instance share a single read rather
 * than racing several.
 */
let cached: Promise<Buffer> | null = null;

export function readFlyer(): Promise<Buffer> {
  cached ??= readFile(FLYER_PATH);
  return cached;
}

/** Test seam: forces the next readFlyer() back to disk. */
export function resetFlyerCache() {
  cached = null;
}

/**
 * The flyer as the Gmail MIME builder wants it (see gmail/branch-sender.ts).
 * Returns null rather than throwing if the file is somehow missing from the
 * deployment: an outreach email that goes out without its flyer is a much
 * smaller failure than one that does not go out at all.
 */
export async function flyerAttachment(): Promise<
  { filename: string; contentType: string; content: Buffer } | null
> {
  try {
    return {
      filename: FLYER_FILENAME,
      contentType: FLYER_CONTENT_TYPE,
      content: await readFlyer(),
    };
  } catch {
    cached = null;
    return null;
  }
}
