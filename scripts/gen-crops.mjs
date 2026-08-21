/**
 * Generates additional unique leaf-shaped crops from tree2.jpg.
 *
 * Uses the EXACT alpha mask extracted from the original leaf PNGs
 * (leaf-vine.png and leaf-branch-soft.png) so every new crop has the
 * identical leaf shape (sharp top-right/bottom-left points, rounded top-left/bottom-right corners).
 *
 * Run with: node scripts/gen-crops.mjs
 */

import sharp from "sharp";
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "../public/tree2.jpg");
const OUT_DIR = path.resolve(__dirname, "../public/crops");

const REF_SHARP = path.resolve(__dirname, "../public/crops/leaf-vine.png");
const REF_SOFT = path.resolve(__dirname, "../public/crops/leaf-branch-soft.png");

/**
 * Load a reference PNG and resize it to 480x480 so it can be used as a mask.
 * The 'dest-in' blend mode uses its alpha channel.
 */
async function getMaskBuffer(file) {
  return sharp(file)
    .resize(480, 480)
    .png()
    .toBuffer();
}

const sharpMaskBuf = await getMaskBuffer(REF_SHARP);
const softMaskBuf = await getMaskBuffer(REF_SOFT);

/**
 * Produce a leaf-masked PNG crop matching original crops perfectly.
 */
async function makeCrop(name, region, { flipH = false, flipV = false, soft = false, blur = 0 } = {}) {
  const outPath = path.join(OUT_DIR, `${name}.png`);

  let pipeline = sharp(SRC).extract(region).resize(480, 480);
  if (flipH) pipeline = pipeline.flop();
  if (flipV) pipeline = pipeline.flip();
  if (blur > 0) pipeline = pipeline.blur(blur);

  const cropBuf = await pipeline.toBuffer();
  const mask = soft ? softMaskBuf : sharpMaskBuf;

  const masked = await sharp(cropBuf)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();

  writeFileSync(outPath, masked);
  console.log(`✓ ${name}.png`);
}

// ── Unique crops from tree2.jpg (2764 × 1536) ─────────────────────────────────

await makeCrop("leaf-moss-top", {
  left: 0, top: 800, width: 700, height: 700,
});

await makeCrop("leaf-bark-right", {
  left: 2300, top: 100, width: 464, height: 464,
}, { flipH: true });

await makeCrop("leaf-fern-left", {
  left: 0, top: 600, width: 560, height: 560,
});

await makeCrop("leaf-float-center", {
  left: 900, top: 200, width: 900, height: 900,
});

await makeCrop("leaf-branch-alt", {
  left: 2100, top: 0, width: 664, height: 664,
}, { flipH: true });

await makeCrop("leaf-bark-soft", {
  left: 100, top: 900, width: 560, height: 560,
}, { soft: true, blur: 2 });

console.log("All crops successfully generated using exact reference leaf masks.");
