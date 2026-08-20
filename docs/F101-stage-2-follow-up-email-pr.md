# F101 — Generate Stage 2 Follow-Up Email

## Summary

Adds the Stage 2 follow-up email generation flow for CAMs. A follow-up can only be generated when the client is at `initial_outreach_sent`, meaning the Stage 1 email has been sent and no response or later pipeline transition has been recorded.

## What changed

- Added a dedicated Stage 2 Gemini prompt and generation service.
- Added server-side Stage 2 pipeline eligibility enforcement.
- Loads the latest sent outreach email so the follow-up acknowledges the previous contact.
- Reuses client profile, booklet, financial, contact, and enrichment context from Stage 1.
- Includes relevant stored news hooks when available.
- Saves generated follow-ups as `draft` outreach messages only.
- Stores the original model output in `ai_generations` for human-review tracking.
- Displays the generated follow-up in the existing review editor.
- Supports regeneration and refreshes the editor with the latest result.
- Records Gemini success/failure through API health logging.
- Records generation, configuration, loading, and persistence failures through application error logging.
- Returns clear user-facing errors without exposing provider or server details.

## Human-review safety

This feature contains no send operation. Generated content is persisted with `send_status: "draft"` and is shown in the review editor. A separate explicit human-reviewed send flow is still required before any outreach can be delivered.

## Eligibility behaviour

| Client pipeline status | Stage 2 generation |
| --- | --- |
| `initial_outreach_sent` | Allowed |
| `not_contacted` | Blocked |
| `follow_up_sent` | Blocked |
| `responded` | Blocked |
| `converted` or any other status | Blocked |

The API repeats this check server-side, so changing the browser UI or calling the endpoint directly cannot bypass it.

## Testing completed

- All 1,137 automated tests passed.
- TypeScript validation passed with `npx tsc --noEmit`.
- ESLint passed for all changed files.
- `git diff --check` passed.
- Added tests covering:
  - eligible and ineligible pipeline statuses;
  - successful structured follow-up generation;
  - safe handling of LLM failures;
  - acknowledgement of the previous email;
  - inclusion of booklet and previous-email context;
  - conditional inclusion of relevant news hooks.

## Staging test still required

The shared staging database currently has no client with both `initial_outreach_sent` status and an earlier sent outreach record. After this branch is merged into `dev` and deployed to shared staging:

1. Create or identify a clearly labelled test client with a sent Stage 1 email.
2. Set its pipeline status to `initial_outreach_sent` through the approved workflow.
3. Generate a Stage 2 follow-up and confirm it acknowledges the earlier email.
4. Edit the subject and body in the review editor.
5. Regenerate and confirm the editor shows the new result.
6. Verify clients at other statuses cannot call the Stage 2 endpoint.
7. Confirm generated messages remain drafts and no email is sent.

## Database changes

None. The feature uses the existing `organisations`, `contacts`, `enrichment_results`, `financial_periods`, `outreach_messages`, and `ai_generations` schema.

## Build note

The local Next.js production build did not complete because Turbopack encountered an internal worker timeout. A webpack fallback also stalled without reporting a compilation error and was stopped. TypeScript, ESLint, and the complete automated test suite passed; the shared staging deployment remains the final build verification.
