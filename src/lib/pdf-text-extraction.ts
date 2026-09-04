import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export const MAX_EXTRACTED_TEXT_CHARACTERS = 250_000;

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
  const loadingTask = getDocument({ data: bytes });
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
