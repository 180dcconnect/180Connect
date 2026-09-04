import assert from "node:assert/strict";
import test from "node:test";
import { extractPdfText } from "./pdf-text-extraction.ts";

function pdfWithText(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 100 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(body);
}

test("extractPdfText extracts usable text from a valid PDF", async () => {
  const result = await extractPdfText(pdfWithText("Annual report supports local families"));
  assert.equal(result.ok, true);
  if (result.ok) assert.match(result.text, /supports local families/);
});

test("extractPdfText identifies an image-only/empty PDF", async () => {
  const result = await extractPdfText(pdfWithText(""));
  assert.deepEqual(result, { ok: false, reason: "no_extractable_text" });
});

test("extractPdfText identifies unsupported or corrupt bytes", async () => {
  const result = await extractPdfText(new TextEncoder().encode("not a pdf"));
  assert.deepEqual(result, { ok: false, reason: "invalid_pdf" });
});

