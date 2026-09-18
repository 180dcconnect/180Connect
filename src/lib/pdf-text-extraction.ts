import { existsSync } from "node:fs";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export const MAX_EXTRACTED_TEXT_CHARACTERS = 250_000;

/**
 * pdf.js asks for a real font file whenever a page uses a non-embedded
 * standard-14 font (Helvetica, Times, Courier, …), purely so it can report
 * glyph widths — text extraction does not need the bytes, only the fetch has
 * to not blow up. Options below:
 *
 * 1. `useSystemFonts: true` — pdf.js skips the font fetch entirely for every
 *    standard font except Symbol/ZapfDingbats (it deliberately keeps those two
 *    on the fetch path so it can still map their glyphs). Zero warnings, and
 *    no dependency on font files existing at runtime.
 * 2. Best-effort `standardFontDataUrl` — covers the Symbol/ZapfDingbats
 *    carve-out whenever pdfjs-dist's own standard_fonts directory is actually
 *    reachable on disk (local dev/tests and any Node host with node_modules
 *    present). pdf.js's Node data factory reads the directory straight from
 *    the filesystem, so the value must be a filesystem path ending in "/".
 *
 * In a bundled serverless deployment the directory is usually absent, so the
 * fallback is deliberately "no URL": extraction still succeeds for every PDF;
 * only a Symbol/ZapfDingbats page would log the old warning there.
 */
function resolveStandardFontDataUrl(): string | undefined {
  const candidate = join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts");
  try {
    return existsSync(candidate) ? `${candidate}/` : undefined;
  } catch {
    return undefined;
  }
}

const STANDARD_FONT_DATA_URL = resolveStandardFontDataUrl();

export type PdfExtractionResult =
  | { ok: true; text: string; pageCount: number; truncated: boolean }
  | { ok: false; reason: "no_extractable_text" | "invalid_pdf" };

function normalisePageText(parts: readonly string[]): string {
  return parts
    .join(" ")
    .replace(/[\t\u00a0 ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/**
 * Extracts a stable, searchable text projection from a PDF without sending the
 * document to an external service. Image-only/scanned PDFs deliberately return
 * a typed failure so callers never mistake an empty string for success.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<PdfExtractionResult> {
  const loadingTask = getDocument({
    data: bytes,
    useSystemFonts: true,
    ...(STANDARD_FONT_DATA_URL ? { standardFontDataUrl: STANDARD_FONT_DATA_URL } : {}),
  });
  let document;
  try {
    document = await loadingTask.promise;
  } catch {
    return { ok: false, reason: "invalid_pdf" };
  }

  const pages: string[] = [];
  const pageCount = document.numPages;
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = normalisePageText(
        content.items.flatMap((item) => ("str" in item ? [item.str] : [])),
      );
      if (text) pages.push(text);
    }
  } catch {
    return { ok: false, reason: "invalid_pdf" };
  } finally {
    await loadingTask.destroy();
  }

  const fullText = pages.join("\n\n").trim();
  const meaningfulCharacters = fullText.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  const replacementCharacters = fullText.match(/\uFFFD/g)?.length ?? 0;
  if (
    meaningfulCharacters < 20 ||
    (fullText.length > 0 && replacementCharacters / fullText.length > 0.05)
  ) {
    return { ok: false, reason: "no_extractable_text" };
  }

  const truncated = fullText.length > MAX_EXTRACTED_TEXT_CHARACTERS;
  return {
    ok: true,
    text: truncated ? fullText.slice(0, MAX_EXTRACTED_TEXT_CHARACTERS) : fullText,
    pageCount,
    truncated,
  };
}
