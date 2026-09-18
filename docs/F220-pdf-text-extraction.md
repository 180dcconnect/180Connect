# F220 — PDF text extraction

PDFs attached to a client are processed locally by PDF.js immediately after
their metadata is recorded. Extracted text stays on the RLS-protected
`ATTACHMENTS` row and is indexed with PostgreSQL full-text search. No document
bytes or extracted content are sent to a third-party extraction service.

## Staging demonstration

1. Open a client as a CAM and upload a PDF containing selectable text.
2. Confirm the attachment shows **Text extracted**, expand it, and find a known
   sentence from the PDF.
3. Generate a Stage 1 or Stage 2 draft and inspect the stored AI generation
   prompt to confirm the named PDF text appears in `<client_pdf_text>`.
4. Upload an image-only/scanned PDF. Confirm the visible **Text could not be
   extracted** state and the retry control.
5. Upload a non-PDF attachment. It remains available normally and is recorded
   as `not_applicable` for extraction.
6. Repeat with a viewer account. The viewer can read extracted text under the
   existing shared-read policy but cannot upload, extract, retry, or call the
   result-recording RPC.
7. Make the stored object temporarily unreadable and retry extraction. Confirm
   the safe UI failure and a structured `attachments.extract.read` ERROR_LOG
   event without document content.

## Operational notes

- Existing PDFs are backfilled to `pending` and expose an **Extract text**
  control; newly uploaded PDFs are extracted automatically.
- Image-only PDFs are not silently treated as empty content. They move to
  `failed` with a stable reason; OCR can later consume the same state contract.
- Email context is capped at 30,000 characters across the newest successful
  attachments, and stored extraction is capped at 250,000 characters per PDF.
- PDF.js is local tooling, not an external API, so no `API_HEALTH_LOGS` entry is
  required. Extraction failures are reported through the application error log.
