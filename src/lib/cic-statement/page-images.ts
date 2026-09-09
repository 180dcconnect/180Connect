import "server-only";

import { deflateSync } from "node:zlib";

import { getDocumentProxy } from "unpdf";

/**
 * Getting the scanned pages out of a Companies House filing.
 *
 * ── Why this exists at all ──
 *
 * A CIC incorporation filing (type CICINC) is two documents stapled together.
 * The first nine to fourteen pages — the certificate, the IN01, the PSC
 * statements — are generated electronically and carry a real text layer.
 * Everything after that, including the CIC36 community interest statement we
 * are here for, is a scan. `extractText` returns empty strings for those pages.
 *
 * ── Why no rasteriser ──
 *
 * The obvious approach is to render each page to a bitmap, which means poppler,
 * pdfium or node-canvas — a native binary in the deployment for the sake of
 * turning an image back into an image. It is unnecessary here: each scanned
 * page is a single full-page image XObject drawn edge to edge, so the bitmap
 * already in the file *is* the rendered page. pdf.js will hand it over without
 * rendering anything, and this module asks it to.
 *
 * The one wrinkle is that pdf.js resolves image objects asynchronously through
 * a callback registry rather than returning them from `getOperatorList`. Hence
 * `resolveImage` below: `getOperatorList` queues the object, and the callback
 * form of `objs.get` waits for it. Reading `objs.get(name)` synchronously
 * straight after throws "Requesting object that isn't resolved yet".
 *
 * ── Why PNG on the way out ──
 *
 * Tesseract reads encoded images, not bare pixel buffers, and PNG is the only
 * lossless encoder available without a dependency: `zlib.deflateSync` is
 * exactly the compressor a PNG IDAT chunk wants, so the whole encoder is a
 * header, a CRC and three chunks. Lossless matters — these are 1-bit scans of
 * printed text, and JPEG ringing around the glyph edges is precisely the
 * artefact that costs OCR accuracy.
 */

/** A page of the filing, as a PNG ready for OCR. */
export type PageImage = {
  /** 1-based page number in the filing, so a log line can name the page. */
  pageNumber: number;
  width: number;
  height: number;
  png: Buffer;
};

/**
 * pdf.js image kinds. 1bpp greyscale is what every sampled CIC36 uses — a
 * bilevel scan of a printed form — but a colour scan is possible and must not
 * throw.
 */
const GRAYSCALE_1BPP = 1;
const RGB_24BPP = 2;
const RGBA_32BPP = 3;

/** paintImageXObject in pdf.js's operator table. Its args are [name, w, h]. */
const OP_PAINT_IMAGE_XOBJECT = 85;

/** How long to wait for pdf.js to hand over one image before giving up on the
 *  page. A stuck object must not hang a backfill of several hundred filings. */
const IMAGE_RESOLVE_TIMEOUT_MS = 20_000;

type PdfImage = {
  width: number;
  height: number;
  kind: number;
  data: Uint8Array | null;
};

type PdfPage = {
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
  objs: { get(name: string, callback: (value: PdfImage) => void): void };
  /** Releases this page's decoded image cache. Not optional at our volumes. */
  cleanup(): boolean;
};

/** CRC-32, as PNG defines it. Table built once per process. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Wraps raw scanlines as a PNG.
 *
 * `bitDepth`/`colourType` are passed through rather than normalising everything
 * to 8-bit RGB: a 1-bit page is 484KB packed and would be 11.6MB expanded, and
 * multiplying every page by twenty-four to hand Tesseract information it does
 * not have would be the wrong trade in a job that reads several hundred of them.
 *
 * Filter byte 0 (None) on every row. PNG's filters exist to help the compressor
 * predict the next byte, and on 1-bit scanned text they earn very little —
 * these pages already compress from 484KB to ~10-40KB unfiltered.
 */
function encodePng(
  width: number,
  height: number,
  bitDepth: number,
  colourType: number,
  pixels: Uint8Array,
): Buffer {
  const bitsPerPixel = colourType === 0 ? bitDepth : bitDepth * (colourType === 6 ? 4 : 3);
  const stride = Math.ceil((width * bitsPerPixel) / 8);

  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    rows.push(Buffer.from([0]));
    rows.push(Buffer.from(pixels.subarray(y * stride, (y + 1) * stride)));
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = bitDepth;
  header[9] = colourType;

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Waits for pdf.js to resolve one queued image object. */
function resolveImage(page: PdfPage, name: string): Promise<PdfImage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out resolving ${name}`)),
      IMAGE_RESOLVE_TIMEOUT_MS,
    );
    try {
      page.objs.get(name, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
    } catch (error) {
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function toPng(image: PdfImage): Buffer | null {
  if (!image.data) return null;
  switch (image.kind) {
    case GRAYSCALE_1BPP:
      return encodePng(image.width, image.height, 1, 0, image.data);
    case RGB_24BPP:
      return encodePng(image.width, image.height, 8, 2, image.data);
    case RGBA_32BPP:
      return encodePng(image.width, image.height, 8, 6, image.data);
    default:
      // An image kind pdf.js grew after this was written. Skipping the page
      // loses one page of a filing; guessing at the layout would produce a
      // scrambled bitmap that OCR reports as confident nonsense.
      return null;
  }
}

/**
 * The full-page scans in a filing, last page first.
 *
 * Reverse order because that is the order the caller wants them: the CIC36 sits
 * at the back of the document, four to six pages from the end across every
 * filing sampled, and OCR is the expensive step. Walking backwards means
 * reading three or four pages instead of twenty-five.
 *
 * `pageLimit` caps how many pages are decoded at all, so a pathological filing
 * cannot turn one organisation into a hundred OCR passes.
 *
 * A page whose image cannot be decoded is skipped rather than throwing: filings
 * are third-party documents, one unreadable page is not a reason to abandon a
 * document whose other pages are fine, and the caller's outcome for "found
 * nothing" is already well defined.
 */
export async function scannedPagesFromEnd(
  pdfBytes: Uint8Array,
  pageLimit: number,
): Promise<PageImage[]> {
  const pdf = await getDocumentProxy(pdfBytes);
  const images: PageImage[] = [];

  // Every page proxy and the document itself must be released explicitly.
  // pdf.js caches each decoded image on the page's `objs` store and keeps the
  // document's worker alive until told otherwise, so a backfill walking
  // hundreds of ~1.2MB filings in one process grows until the OS kills it.
  // Learned the hard way: the first staging run was killed for memory at 398
  // of 537 companies.
  try {
    for (let pageNumber = pdf.numPages; pageNumber >= 1; pageNumber--) {
      if (images.length >= pageLimit) break;

      const page = (await pdf.getPage(pageNumber)) as unknown as PdfPage;
      try {
        const ops = await page.getOperatorList();

        for (let i = 0; i < ops.fnArray.length; i++) {
          if (ops.fnArray[i] !== OP_PAINT_IMAGE_XOBJECT) continue;
          const args = ops.argsArray[i];
          if (!Array.isArray(args) || typeof args[0] !== "string") continue;

          try {
            const image = await resolveImage(page, args[0]);
            const png = toPng(image);
            if (!png) continue;
            images.push({ pageNumber, width: image.width, height: image.height, png });
          } catch {
            // Deliberately swallowed, and deliberately not reported: a page
            // that will not decode is expected background noise across
            // hundreds of third-party documents, and one reportError per page
            // would bury the failures that matter.
          }
          // One full-page scan per page is the shape of every filing seen.
          // Taking only the first also means a page carrying a logo alongside
          // the scan cannot push the real page out of the limit.
          break;
        }
      } finally {
        // Drops this page's decoded image cache. The PNG we keep is already a
        // copy, so releasing the source costs us nothing.
        page.cleanup();
      }
    }
  } finally {
    // `loadingTask.destroy()`, not `pdf.cleanup()`: cleanup only drops cached
    // page data, while this also tears down the worker and its transport.
    // getDocumentProxy discards the loading task, but the proxy exposes it.
    await pdf.loadingTask.destroy();
  }

  return images;
}
