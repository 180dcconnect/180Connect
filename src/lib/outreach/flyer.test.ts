import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { FLYER_FILENAME, FLYER_CONTENT_TYPE, flyerAttachment, readFlyer, resetFlyerCache } from "./flyer.ts";

test("the flyer ships with the code and is a real PDF", async () => {
  const bytes = await readFlyer();
  assert.ok(Buffer.isBuffer(bytes));
  // %PDF- magic: catches a truncated or LFS-pointer file being deployed.
  assert.equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-");
});

test("the flyer stays small enough to send", async () => {
  const bytes = await readFlyer();
  const mb = bytes.length / 1024 / 1024;
  // Some charity mail servers reject at 5-10MB, and base64 inflates by ~33%
  // on the wire. 2MB leaves real headroom; the committed file is ~1.3MB. This
  // fails the build if someone recommits the 4.8MB original.
  assert.ok(mb < 2, `flyer is ${mb.toFixed(2)}MB, too large to attach to cold outreach`);
});

test("flyerAttachment returns exactly what the MIME builder wants", async () => {
  const a = await flyerAttachment();
  assert.ok(a);
  assert.equal(a.filename, FLYER_FILENAME);
  assert.equal(a.contentType, FLYER_CONTENT_TYPE);
  assert.ok(Buffer.isBuffer(a.content));
  // The filename reaches the recipient, so it must read as something a charity
  // would open, not as an internal asset name.
  assert.match(a.filename, /\.pdf$/);
  assert.doesNotMatch(a.filename, /[\\/]/);
});

test("the bytes are read once and reused", async () => {
  resetFlyerCache();
  const first = await readFlyer();
  const second = await readFlyer();
  // Same Buffer instance means the second send did not re-read 1.3MB from disk.
  assert.equal(first, second);
});

test("the committed flyer matches the file on disk", async () => {
  const direct = await readFile("src/lib/outreach/assets/180dc-sheffield-flyer.pdf");
  resetFlyerCache();
  assert.ok(direct.equals(await readFlyer()));
});
