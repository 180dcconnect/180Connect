const REPLY_EXCERPT_LIMIT = 500;

function compact(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * F136: stores reply provenance inside the ordinary F072 note content because
 * the approved NOTES schema has no reply_event_id column. The full UUID keeps
 * the association unambiguous; the quote makes it understandable in the Notes
 * list without requiring a second lookup.
 */
export function buildReplyNoteContent(input: {
  note: string;
  replyId: string;
  replyBody: string;
  receivedAt: string;
}): string {
  const reply = compact(input.replyBody);
  const excerpt = reply.length > REPLY_EXCERPT_LIMIT
    ? `${reply.slice(0, REPLY_EXCERPT_LIMIT - 1)}…`
    : reply;
  const received = new Date(input.receivedAt).toISOString();

  return [
    `Reply context — received ${received} — reference ${input.replyId}`,
    `Client wrote: “${excerpt}”`,
    "",
    input.note.trim(),
  ].join("\n");
}
