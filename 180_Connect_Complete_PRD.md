# 180 Connect — Product Requirements Document

**Product:** 180 Connect  
**Organisation:** 180 Degrees Consulting Sheffield  
**Document type:** Product and System Requirements Document  
**Version:** 1.0  
**Status:** Approved baseline for MVP delivery  
**Last updated:** 14 July 2026  
**Format:** Markdown source of truth

> This document consolidates the product requirements, user journeys, delivery scope, business rules, system behaviour, data model, security controls, non-functional requirements, acceptance criteria, and traceability for 180 Connect. Where earlier documents conflict, the precedence rules in Section 2.4 apply.
## 1. Document Control
| Item | Value |
|---|---|
| Product owner | 180DC Sheffield / Project Leader |
| Primary users | Client Acquisition Managers (CAMs), Admins, Viewers |
| Delivery model | Two cross-functional delivery teams of three developers |
| Delivery period | Eight weeks, four two-week sprints |
| Target MVP handover | 6 September 2026 |
| Authoritative feature count | 240 scheduled backlog features |
| Required priorities | P1 and P2 |
| Conditional MVP priorities | P3, delivered if capacity remains after P1/P2 |
| Launch scoring method | Configurable weighted rule engine |
| Future scoring method | Trained model once sufficient labelled outcomes exist |
| Database | Supabase Postgres with row-level security |
| Application | Next.js / TypeScript hosted on Vercel |
| Email | Gmail API preferred; Gmail SMTP permitted as controlled fallback |
### 1.1 Revision Policy
This file must be updated whenever an approved change affects scope, product behaviour, data structures, permissions, integrations, acceptance criteria, or non-functional targets. A change is not complete until the PRD, backlog, and Data Model are aligned. Material changes require approval from the Project Leader and the relevant 180DC stakeholder.

Every revision must add an entry to the change log at the end of this document. Requirements should not be deleted without recording why they were removed or deferred.
### 1.2 Requirement Language
- **Must / shall:** mandatory for the stated priority and release.
- **Should:** expected unless a documented constraint prevents implementation.
- **May:** optional implementation choice.
- **P1:** essential for the platform to work safely and meaningfully.
- **P2:** required for the MVP, but the core product could technically operate without it.
- **P3:** within the MVP scope but delivered only if capacity remains after all P1 and P2 requirements are accepted.
## 2. Product Context
### 2.1 Problem Statement
180DC Sheffield currently acquires clients through a fragmented manual process involving spreadsheets, separate Gmail inboxes, Google Drive records, and Monday.com. The current process has no shared source of truth for organisations, no consistent method for deciding who to contact first, limited ownership controls, weak follow-up visibility, and no reliable feedback loop between outreach activity and successful outcomes.

CAMs spend time finding and cleaning organisation data, manually reviewing previous communication, deciding whom to contact, drafting outreach, and checking follow-ups across several tools. This creates duplicated effort, missed opportunities, inconsistent outreach quality, and poor institutional memory when a CAM leaves or becomes unavailable.
### 2.2 Product Vision
180 Connect will be the unified B2B client-acquisition platform used by 180DC Sheffield to find, understand, prioritise, contact, and manage relationships with charities and other eligible organisations. It will combine trusted organisation data, transparent scoring, AI-assisted research and drafting, human-controlled sending, reply synchronisation, pipeline management, and outcome tracking in one auditable system.
### 2.3 Product Principles
1. **Human-controlled outreach:** no email leaves the platform without explicit approval by an authenticated CAM.
2. **One trusted organisation record:** raw data may come from many sources, but operational workflows use a canonical entity record.
3. **Transparent intelligence:** scores and recommendations must retain their inputs, model version, and explanation.
4. **Shared history, controlled action:** all CAMs can see relevant history; restricted actions belong to the owning CAM or an admin.
5. **Fail visibly:** important failures are surfaced to users and recorded in `ERROR_LOG`.
6. **Security by default:** deny-by-default row-level security, validation, auditability, and suppression checks are built into every feature.
7. **Learning without data leakage:** future training uses frozen snapshots captured at the time of outreach.
8. **Operational usefulness over novelty:** the platform must save CAM time and reduce missed work compared with the current process.
### 2.4 Source-of-Truth Precedence
When sources conflict, use the following order:

1. The latest explicit decision approved by the Project Leader.
2. This PRD after approval.
3. The 180 Connect Standard Operating Procedure Guidebook.
4. The Gantt chart for committed delivery scope, grouping, and schedule.
5. The complete Data Model workbook for database structure.
6. The backlog for individual user stories, dependencies, and feature-level notes.
7. The Technical Brief for product vision, architecture, and supporting context.

The SOP takes precedence over older descriptions of permanent frontend/backend/AI teams. Delivery uses two cross-functional teams.
## 3. Goals, Outcomes, and Success Measures
### 3.1 MVP Goals
By MVP handover, the platform must:

- ingest and preserve organisation data from approved external sources;
- validate, deduplicate, and promote records into a canonical organisation database;
- allow reviewed manual organisation creation;
- score and rank organisations using a configurable weighted rule engine;
- let CAMs search, filter, inspect, tag, and annotate organisations;
- generate Client Booklets and personalised outreach drafts;
- require CAM review before every send or schedule action;
- send from authorised 180DC Gmail accounts;
- synchronise replies and associate them with the correct outreach thread;
- manage CAM ownership, reminders, actions, pipeline stages, suppression, and outcomes;
- preserve history when ownership changes or a CAM is offboarded;
- expose CAM and admin dashboards, operational analytics, audit trails, errors, and API health;
- collect reliable records for future model training without making a trained model an MVP dependency.
### 3.2 Product Success Measures
The MVP will be judged against the following product outcomes during acceptance testing and initial rollout:

| Measure | Target |
|---|---:|
| P1 stories accepted | 100% |
| P2 stories accepted | 100% |
| P3 stories accepted | As many as capacity permits after P1/P2 |
| Critical end-to-end journeys passing in staging | 100% |
| Emails sent without authenticated approval | 0 |
| Suppressed contacts emailed | 0 |
| Duplicate canonical organisations created in the test dataset | <1% unresolved duplicate rate |
| External API failures logged | 100% |
| User-facing critical errors recorded in `ERROR_LOG` | 100% |
| Ownership changes retaining full history | 100% |
| Successful restore test completed before launch | 1 documented test |
| CAM testers able to complete core workflow without developer intervention | At least 80% on first guided test |
## 4. Users, Roles, and Access
### 4.1 User Types
| Role | Purpose | Core access |
|---|---|---|
| Admin | Manages users, approvals, data quality, ownership, suppression, configuration, and team oversight | Full authorised management access |
| CAM | Finds organisations, reviews scores, drafts and sends outreach, manages owned relationships, logs outcomes | Shared read access plus controlled write/action access |
| Viewer | Observes organisation, outreach, and reporting information without changing operational data | Read-only |
| Service role | Executes trusted background jobs and integrations | Server-side only; never exposed to the browser |
### 4.2 Identity Rules
- Public self-sign-up is prohibited.
- An admin creates or invites users.
- Approved 180DC email domains restrict eligibility but do not grant a role by themselves.
- The authoritative role is stored in `USERS` and enforced through Supabase row-level security.
- A deactivated account cannot log in, refresh tokens, send messages, or execute background actions on behalf of the user.
- Role changes and deactivation actions must be audited.
- Admin privileges must never be inferred solely from an email string in client-side code.
### 4.3 Permission Matrix
| Capability | Admin | CAM | Viewer |
|---|:---:|:---:|:---:|
| View canonical organisations | Yes | Yes | Yes |
| View shared notes and communication history | Yes | Yes | Yes |
| Create personal/shared note | Yes | Yes | No |
| Suggest organisation field correction | Yes | Yes | No |
| Directly approve canonical data changes | Yes | No | No |
| Generate Client Booklet | Yes | Yes | No |
| Generate email draft | Yes | Yes | No |
| Send to an unowned organisation | Yes | Yes, becomes owner | No |
| Send to an organisation owned by another CAM | Yes | No | No |
| Reassign ownership | Yes | No | No |
| Override pipeline stage | Yes, reason required | No | No |
| Lift suppression | Yes, reason required | No | No |
| Manage users and roles | Yes | No | No |
| Trigger external-source refresh | Yes | No | No |
| View team analytics | Yes | Limited/personal | Read-only if authorised |
| View personal analytics | Yes | Own data | No |
| View raw source records | Yes/technical admin | No | No |
## 5. Scope and Release Priorities
### 5.1 MVP Scope Definition
The MVP includes P1, P2, and P3 stories in the product boundary. P1 and P2 are mandatory for release. P3 stories are legitimate MVP scope but are time-permitting and must not delay acceptance of P1/P2.

The Gantt chart identifies 240 scheduled features and is authoritative for the committed feature count. Six backlog items are explicitly excluded by the Gantt (`F026`, `F110`, `F127`, `F140`, `F141`, and `F142`). Other backlog rows not represented in the 240-item schedule are not automatically committed unless formally added through change control.
### 5.2 Functional Scope by Workstream
| # | Workstream | Schedule | Feature IDs | Count |
|---:|---|---|---|---:|
| 1 | Foundations & environments | W1–W2 (Mon 13 Jul–Wed 22 Jul) | F221–F226, F229–F233, F238–F240 | 14 |
| 2 | Authentication & roles | W1–W2 (Wed 15 Jul–Fri 24 Jul) | F001–F004, F006–F007, F016–F017 | 8 |
| 3 | User management & onboarding | W2–W3 (Wed 22 Jul–Wed 29 Jul) | F008–F015, F252, F255, F257 | 11 |
| 4 | Data ingestion (APIs) | W2–W3 (Wed 22 Jul–Fri 31 Jul) | F031–F036, F038–F039 | 8 |
| 5 | Data cleaning & compliance | W3–W4 (Mon 27 Jul–Wed 05 Aug) | F041–F050, F246–F248, F254, F256 | 15 |
| 6 | Client database & profiles | W3–W4 (Wed 29 Jul–Fri 07 Aug) | F019–F020, F030, F051–F081, F234–F236, F251 | 38 |
| 7 | Scoring, tags & preferences | W4–W5 (Wed 05 Aug–Wed 12 Aug) | F088–F099, F188–F202 | 27 |
| 8 | AI booklets & email generation | W4–W5 (Wed 05 Aug–Fri 14 Aug) | F082–F087, F100–F113 (excl. F110) | 19 |
| 9 | Email review & sending | W5–W6 (Wed 12 Aug–Fri 21 Aug) | F114–F130 (excl. F127), F227–F228, F241, F249–F250 | 21 |
| 10 | Reply handling & CRM pipeline | W6–W7 (Mon 17 Aug–Wed 26 Aug) | F131–F161 (excl. F140–F142) | 28 |
| 11 | Ownership, actions & notifications | W6–W7 (Wed 19 Aug–Fri 28 Aug) | F018, F162–F179, F253 | 20 |
| 12 | Dashboards, admin & analytics | W7–W8 (Mon 24 Aug–Wed 02 Sep) | F021–F029 (excl. F026), F180–F187, F206–F213 | 24 |
| 13 | Search & UX stretch (P3) | W7–W8 (Wed 26 Aug–Wed 02 Sep) | F203–F205, F214–F216, F237 | 7 |
| 14 | Testing, hardening & launch | W8 (Mon 31 Aug–Fri 04 Sep) | Full QA, docs, bug-fix buffer, go-live | — |
### 5.3 Explicitly Deferred Beyond V1
The architecture may support these later, but they are not acceptance dependencies for V1 unless a scheduled P3 story explicitly covers a limited version:

- replacement of the weighted rule engine with a trained model;
- model training and production deployment based on live outcomes;
- multi-tenant operation for other branches or organisations;
- full mobile-optimised interface;
- Monday.com bidirectional integration;
- advanced annual-report summarisation;
- high-confidence open/click analytics as a core success metric;
- large-scale international registry coverage beyond the fields already supported by the schema;
- autonomous outreach without CAM approval.
## 6. End-to-End User Journeys
### 6.1 New CAM Onboarding
1. An admin creates or invites the CAM using an approved 180DC email address.
2. The admin assigns the `CAM` role and activates the account.
3. The system sends the user a secure invitation or password setup link; plaintext passwords are never emailed.
4. The CAM completes account setup and, where required, authorises Gmail access using OAuth 2.0.
5. On first login, the CAM confirms display name, email signature, notification preferences, outreach preferences, and default email-generation settings.
6. Until activation and any required Gmail authorisation are complete, sending actions remain unavailable.
7. The onboarding completion event is recorded for audit and support.
### 6.2 Login and Entry
1. The user opens the login page.
2. The user enters email and password and completes bot protection when triggered.
3. The backend validates account existence, domain eligibility, active status, credentials, and rate limits.
4. Failed attempts return a generic error that does not reveal whether an account exists.
5. On success, the user is routed to the Queue View.
6. Role-specific navigation is rendered from server-authorised permissions.
### 6.3 Queue View
The Queue View answers: **“What should I do today?”** It displays nightly or near-real-time summary cards for total organisations, contacted/replied counts, conversions, and work needing attention.

The page contains:

- **My attention:** actions and notifications belonging to the logged-in CAM only;
- **My ranked queue:** uncontacted or owned organisations ranked using the CAM-adjusted score;
- **Recent team activity:** shared, permission-safe activity events;
- **Unowned/stalled work:** shown only in an explicitly shared area or admin view, never mixed into another CAM’s personal action list.

A CAM can open an organisation, claim eligible unowned work through the first outreach action, dismiss/read notifications, and move to the Actions or Charity List views.
### 6.4 Finding and Filtering Organisations
CAMs can search by organisation name and filter by type, location, sector, income band, tags, score band, ownership, outreach status, data-quality status, and suppression state where authorised. Columns are sortable. Bulk actions are limited to safe operations such as adding tags, adding a comment, or changing permitted statuses.

Natural-language search converts a plain-English request into validated structured filters. The database performs the actual query. The result explains why each organisation matched and must not invent attributes absent from trusted or clearly labelled derived data.
### 6.5 Manual Organisation Addition
1. A CAM selects **Add organisation**.
2. The minimum input is a website URL; optional keywords and any known identifiers may be supplied.
3. The system validates the URL and checks for obvious duplicates.
4. The submission is stored in `MANUAL_ENTRY_RECORDS`, not immediately trusted as canonical.
5. Available website content is extracted and enrichment/Client Booklet generation may begin.
6. A confident match may be linked automatically; ambiguous matches require review.
7. An admin approves, rejects, or merges the submission.
8. Approved records are promoted to `ORGANISATIONS` and related entity tables.
9. If the website is unreadable, the CAM receives a recoverable error and may add the required fields manually.
### 6.6 Organisation Detail Drawer
Opening an organisation displays a consistent context panel containing:

- canonical profile, identifiers, contact details, address, sector, mission, website, and verification state;
- score, score band, component breakdown, explanation, model version, and last-scored time;
- Client Booklet and enrichment freshness;
- contacts, financial periods, grants, tags, and notes;
- current owner, pipeline stage, suppression state, and recommended next action;
- complete communication timeline, including emails, replies, notes, ownership changes, outcomes, and admin overrides;
- data-quality warnings and proposed edits;
- actions permitted for the current role and ownership state.

The drawer must distinguish canonical source data, CAM-entered data, and AI-derived enrichment.
### 6.7 Client Booklet Generation
1. The CAM requests a booklet or the system triggers generation after an approved manual entry.
2. The backend gathers trusted organisation data, selected enrichment, website text, recent approved news context, financials, grants, and source metadata.
3. The LLM returns structured content validated against a schema.
4. The result is stored as derived enrichment with model/prompt version, source links, generation time, and confidence/review state.
5. The interface shows a progress state and permits retry after failure.
6. Generated claims must not overwrite canonical fields automatically.
7. Stale booklets can be regenerated while older versions remain auditable where required.
### 6.8 Email Generation, Review, Approval, and Sending
1. The CAM opens an eligible organisation they own or that is unowned.
2. Before generation, the CAM may adjust tone, length, opening approach, sign-off, voice, and custom instructions.
3. VOICE receives the organisation profile, Client Booklet, selected contact, previous outreach, CAM settings, approved templates, and optional current news context.
4. The generated subject/body are stored separately from the final message.
5. The editor lets the CAM review and change recipient, subject, body, formatting, attachments, and send time.
6. The backend rechecks ownership, active-user status, suppression, recipient validity, daily sending limits, and duplicate/idempotency keys.
7. The CAM explicitly chooses **Send now**, **Save draft**, or **Schedule**.
8. Saving a draft sends nothing.
9. Scheduling is permitted only after explicit approval of the exact message content; later content changes invalidate the approval and require reapproval.
10. A successful first send automatically assigns the CAM as owner when the organisation is unowned.
11. The exact final subject/body and provider identifiers are preserved.
### 6.9 Reply Handling
1. Gmail push notifications or fallback polling identify new mailbox activity.
2. The sync worker retrieves the message and matches it using Gmail thread/message IDs and standard reply headers.
3. The reply is stored and added to the organisation timeline.
4. The owning CAM receives an in-platform notification and, if configured, an email notification.
5. Reply intelligence classifies intent, sentiment, urgency, objections, referrals, and a proposed next action.
6. Low-confidence or sensitive classification is visibly labelled and requires human judgement.
7. The CAM may draft a follow-up, update the pipeline, add a note, or log an outcome.
8. Unmatched replies enter an admin/technical reconciliation queue rather than being discarded.
### 6.10 Actions and Reminders
The Actions tab is personal to the logged-in CAM. It includes follow-ups due, replies awaiting action, drafts awaiting completion, owned records stalled beyond configured thresholds, and tasks explicitly assigned by an admin.

Actions can be completed, deferred where policy allows, or opened in the organisation context. A reminder creates an action or notification; it never sends an email automatically. Shared unowned work appears in a separate shared queue.
### 6.11 Pipeline and Closure
Organisations move through controlled outreach states. Automatic transitions occur after confirmed system events; CAMs confirm relationship outcomes. Closure requires a category and may require a reason. Hard-no outcomes immediately apply suppression.

A closed record retains all history. Reopening is restricted to an admin or an explicitly authorised workflow and must be audited.
### 6.12 CAM Offboarding and Reassignment
1. An admin deactivates the CAM account.
2. The user loses login and send permissions immediately.
3. Open owned organisations, outstanding actions, scheduled messages, and unresolved replies are flagged.
4. Scheduled messages belonging to the inactive CAM are paused until reassigned and reapproved where necessary.
5. The admin may reassign each relationship, release it to the unowned pool, or close it with a reason.
6. The new owner receives a handover view containing notes, timeline, previous messages, replies, stage, outcomes, and previous owner identity.
7. Historical ownership is never overwritten or deleted.
### 6.13 Admin Journey
Admins can manage users, manual-entry approvals, proposed data corrections, entity-match conflicts, suppression requests, ownership, stalled records, pipeline overrides, data-quality issues, source refreshes, scoring configuration, and team analytics.

Every privileged decision requires an audit entry. Suppression removal, stage override, ownership reassignment, and rejection/approval of proposed changes require a written reason.
## 7. Functional Requirements by Domain
The detailed 240-item feature register appears in Appendix A. The following domain requirements define the consolidated product behaviour that those stories implement.
### 7.1 Authentication and Account Security
- The system must use Supabase Auth for email/password authentication and password reset.
- The system must restrict account creation to admin-controlled invitations and approved 180DC identities.
- The system must apply CAPTCHA or equivalent bot protection to risky login attempts.
- The system must rate-limit login, password reset, and invitation endpoints.
- The system must invalidate access promptly when an account is deactivated.
- The system must never expose service-role keys, OAuth refresh tokens, or secrets to client-side code.
### 7.2 User Management and Onboarding
- The system must allow admins to invite, activate, deactivate, and assign roles to users.
- The system must allow users to maintain their display name, email signature, notification settings, and permitted profile data.
- The system must make onboarding status visible and auditable.
- The system must trigger the offboarding and reassignment workflow when a user is deactivated.
### 7.3 Data Ingestion and Source Tracking
- The system must record the source, trigger, timestamps, status, counts, and errors for each ingestion run.
- The system must preserve raw source records unchanged with source identifiers and payloads.
- The system must keep imports modular so one source can fail without corrupting others.
- The system must support CharityBase, Companies House, Charity Commission, Find That Charity, and 360Giving where credentials and interfaces are available.
- The system must allow admins to trigger an on-demand refresh without bypassing validation.
- The system must write external-call status and latency to API health logs.
### 7.4 Data Validation, Deduplication, and Quality
- The system must validate required fields, types, enums, URLs, emails, identifiers, and payload schemas.
- The system must distinguish email syntax validation from deliverability verification.
- The system must use registration identifiers, name, domain, address, and contact signals for entity matching.
- The system must automatically resolve only high-confidence matches; ambiguous cases require human review.
- The system must create data-quality events for failed checks rather than silently deleting records.
- The system must retain provenance for canonical records and prevent lower-priority sources from overwriting them without an approved source-priority policy.
### 7.5 Organisation Database and Profile
- The system must provide one canonical organisation record with related identifiers, contacts, financial periods, grants, enrichment, notes, and tags.
- The system must support source-labelled field display and freshness indicators.
- The system must allow CAMs to propose edits while protecting trusted fields from unauthorised direct changes.
- The system must expose a chronological timeline of important activity.
- The system must support international identifiers and country fields without making broad international ingestion an MVP dependency.
### 7.6 Scoring and Ranking
- The system must use a weighted rule engine with configurable, versioned weights in V1.
- The system must produce a 0–100 priority score, score band, explanation, and recommended action.
- The system must use documented features and deterministic normalisation.
- The system must capture every run with input snapshot, output, source, model version, latency, and trigger.
- The system must refresh stale or changed organisation scores nightly.
- The system must apply CAM preferences as a personal boost without altering the objective base score.
- The system must capture outcomes for a future trained model; no trained model is required for V1.
### 7.7 Tags, Search, and Preferences
- The system must allow admins and CAMs to create and apply permitted tags using a junction table for membership.
- The system must provide structured search and filters that work without an LLM.
- The system must convert natural-language search requests into validated filters and explain matches.
- The system must store CAM outreach preferences separately from email-generation preferences.
- The system must prevent preferences from bypassing suppression, permissions, or data-quality controls.
### 7.8 Client Booklets and AI Enrichment
- The system must generate structured summaries from trusted and clearly sourced content.
- The system must retain prompt/model version, source information, time, and review status.
- The system must label AI-derived data and never silently promote it to canonical truth.
- The system must handle unreadable websites, timeouts, empty content, and malformed model output visibly.
- The system must protect against prompt injection in scraped or uploaded content.
### 7.9 Email Generation and Review
- The system must generate personalised drafts using approved context and CAM settings.
- The system must store the original AI generation separately from the final edited message.
- The system must allow complete human review of recipient, subject, body, attachments, and timing.
- The system must require explicit authenticated approval before send or schedule.
- The system must require reapproval after any material content or recipient change.
- The system must use the mandatory CAM review as the authoritative email approval control; no separate two-checkpoint review queue is required.
### 7.10 Sending, Scheduling, and Delivery Signals
- The system must prefer Gmail API sending with OAuth 2.0; controlled SMTP may be used as fallback.
- The system must store Gmail message and thread identifiers for reconciliation.
- The system must execute scheduled sends through a trusted worker and only for the exact content previously approved.
- The system must enforce a default platform cap of 100 outbound emails per day and per-user/endpoint rate limits.
- The system must record draft, approved, scheduled, attempted, accepted, sent, failed, bounced, replied, and cancelled lifecycle events where observable.
- The system must treat opens/clicks as optional low-confidence signals requiring privacy review; do not make them a core success metric.
- The system must treat negative replies, unsubscribe requests, and hard-no outcomes as actionable complaint/suppression signals.
### 7.11 Reply Handling and Attachments
- The system must synchronise replies with Gmail push where possible and polling fallback.
- The system must match replies deterministically and queue uncertain matches for review.
- The system must classify reply intent/sentiment/urgency without overwriting the original message.
- The system must preserve attachments and metadata subject to size/type/security limits.
- The system must extract text from supported PDF/DOCX/image attachments asynchronously when the relevant P3 feature is delivered.
- The system must never execute active content from attachments.
### 7.12 Ownership, CRM Pipeline, and Actions
- The system must first successful outreach to an unowned organisation assigns ownership to the sending CAM.
- The system must only the owner or admin can perform restricted outreach actions.
- The system must all authorised CAMs can view shared history, notes, and status.
- The system must conflicting actions show owner identity and last-contact context.
- The system must personal Actions contains only the logged-in CAM’s work or explicitly assigned work.
- The system must ownership reassignment preserves all prior owners and activity.
### 7.13 Notifications and Dashboards
- The system must notify users of replies, follow-ups, assignment changes, failed scheduled sends, and relevant approvals.
- The system must provide configurable instant/daily/weekly notification preferences where supported.
- The system must dashboard metrics use snapshots for fast loading and indicate freshness.
- The system must team activity must not expose secret or permission-restricted content.
### 7.14 Admin, Audit, and Analytics
- The system must provide admin queues for data quality, manual entries, proposed edits, entity matching, suppression, and stalled work.
- The system must audit privileged actions with user, timestamp, before/after values, and reason.
- The system must provide personal CAM analytics and team-level pipeline/sector performance views.
- The system must monitor API health, ingestion, cost, errors, and model usage.
- The system must analytics tables are populated by jobs/events, not manually edited by CAMs.
### 7.15 Compliance and Privacy
- The system must store only professional contact information reasonably needed for outreach.
- The system must support objection, correction, access, and deletion workflows subject to legal retention requirements.
- The system must apply suppression before every send at the backend.
- The system must include transparent outreach identity/source/opt-out language in approved templates.
- The system must maintain processor and data-retention documentation outside or alongside the platform.
- The system must complete a Legitimate Interest Assessment before live outreach.
## 8. Business Rules and State Models
### 8.1 Outreach Pipeline States
The logical pipeline is:

```text
NOT_STARTED → QUEUED → INITIAL_OUTREACH_SENT → FOLLOW_UP_DUE
→ FOLLOW_UP_SENT → RESPONDED → IN_DISCUSSION → MEETING_CONFIRMED → CLOSED
```

Implementations may use more granular internal states, but the user-facing mapping must remain consistent.
| Current state | Trigger | Next state | Automatic? |
|---|---|---|:---:|
| NOT_STARTED | Organisation becomes eligible/scored | QUEUED | Yes |
| QUEUED | First approved email accepted by Gmail | INITIAL_OUTREACH_SENT | Yes |
| INITIAL_OUTREACH_SENT | Configured follow-up interval reached with no reply | FOLLOW_UP_DUE | Yes |
| FOLLOW_UP_DUE | Approved follow-up accepted by Gmail | FOLLOW_UP_SENT | Yes |
| INITIAL_OUTREACH_SENT / FOLLOW_UP_SENT | Matched reply received | RESPONDED | Yes |
| RESPONDED | CAM confirms active discussion | IN_DISCUSSION | No |
| IN_DISCUSSION | CAM confirms meeting | MEETING_CONFIRMED | No |
| Any active state | CAM/admin records final outcome | CLOSED | No |
| CLOSED | Admin reopens with reason | Appropriate prior/active state | No |
### 8.2 Outcome Categories
| Outcome | Meaning | Additional rule |
|---|---|---|
| Converted to partner | Relationship produced an active engagement | Counts as conversion ground truth |
| Future potential | Interested but not currently ready | Requires re-engagement date or note |
| Soft no | Declined without permanent objection | May be eligible for later contact under policy |
| Hard no | Explicit objection or do-not-contact request | Applies suppression immediately |
| No response | Approved outreach sequence completed without reply | Retained as negative/neutral training label |
| Lost due to timing | Relationship stalled for external timing reasons | Reason required |
| Referral | Contact redirected the team elsewhere | Referral details and next action recorded |
### 8.3 Ownership Rules
- Ownership is assigned only after a successful first send or explicit admin assignment.
- A failed send does not assign ownership unless the admin intentionally assigns it.
- An owner may view and act on their records; other CAMs have shared visibility but restricted action.
- An admin can reassign ownership at any time with a reason.
- Ownership history is append-only/auditable.
- Deactivation pauses scheduled messages and creates reassignment actions.
- Unowned work is available through a shared queue and is not presented as another CAM’s personal task.
### 8.4 Suppression Rules
- Suppression may apply at organisation and/or contact level.
- Every send path checks suppression server-side immediately before provider submission.
- A hard-no outcome, unsubscribe request, or confirmed objection creates suppression.
- A suppressed record disables generate/send/schedule actions where appropriate and explains why.
- Only an admin may lift suppression, with a mandatory written reason and audit event.
- Minimum identifying data may be retained in a suppression list solely to prevent future contact.
### 8.5 Reminder Rules
Default cadence:

- Seven days after initial outreach without reply: create first follow-up action.
- Fourteen days after the follow-up without reply: create second/escalation action as configured.
- Ninety days without activity: flag the relationship as stalled for admin/shared review.

CAM-configured timing may adjust reminders within approved limits. Reminders never send messages automatically.
## 9. System Architecture
### 9.1 Logical Components
| Component | Responsibility |
|---|---|
| Next.js web application | User interface, server actions/API routes, permission-aware navigation |
| Supabase Auth | Authentication, sessions, password reset, invitation foundation |
| Supabase Postgres | Canonical data, workflow state, audit records, model metadata, analytics |
| Row-level security | Database-enforced access control |
| Supabase Storage | Attachments and future model artifacts |
| pg_cron / scheduled workers | Scoring, analytics, data comparison, retries, polling, scheduled sends |
| Ingestion workers | External API retrieval, raw preservation, validation, promotion |
| Intelligence services | Feature engineering, weighted scoring, LLM generation/classification |
| Gmail integration | OAuth, sending, reply retrieval, message/thread reconciliation |
| Vercel | Application hosting and preview deployments |
| Sentry / error tooling | Runtime error capture, linked to application error records where practical |
| PostHog | Product usage and cost/usage analysis with privacy controls |
| GitHub / GitHub Projects | Source control, pull requests, sprint board, release evidence |
### 9.2 Environment Separation
- Development, staging, and production must use separate environment variables and databases where practical.
- Pull requests receive Vercel preview deployments connected to staging/test data, never production data.
- Secrets are held in secure environment storage and excluded from Git.
- Database changes are applied through ordered migrations in `/supabase/migrations`.
- Production changes must be repeatable and reviewed; untracked manual schema changes are prohibited.
### 9.3 External Integrations
| Integration | Use | Failure behaviour |
|---|---|---|
| CharityBase | Organisation profiles | Log, retry safely, retain last successful data |
| Companies House | Registration/company data | Log, retry, flag stale records |
| Charity Commission | Charity registration/financial data | Partial ingestion allowed; no corruption of other sources |
| Find That Charity | Supplementary profiles/contact data | Treat as source-labelled, validate before promotion |
| 360Giving | Grant history | Continue without grants if unavailable; show freshness |
| Gmail API | Preferred sending, reply sync, message/thread IDs | Queue/retry; surface authentication expiry |
| Gmail SMTP | Controlled sending fallback | Record reduced observability; no silent fallback |
| LLM provider | Booklets, drafts, NL search parsing, reply classification | Timeout, retry within limits, schema validation, human fallback |
| Live web search provider | Optional current news hooks | Omit news hook if unavailable; do not block core draft generation |
| Email verification service | Deliverability signal | Flag unknown status; do not treat as proof |
## 10. Background Jobs and Scheduling
| Job | Default cadence/trigger | Required output | Failure handling |
|---|---|---|---|
| External source ingestion | Daily/weekly per source; admin on demand | Ingestion run and raw records | Retry safe calls; partial status; alert repeated failure |
| Validation and matching | After ingestion | Quality events and match candidates | Quarantine invalid/ambiguous records |
| Canonical promotion | After approved/confident match | Entity updates with provenance | Transaction rollback on failure |
| Enrichment refresh | On new/stale entity; on demand | Versioned enrichment result | Retain prior result; retry |
| Nightly scoring | Nightly and on material change | Agent runs and latest scores | Keep previous score with stale indicator |
| Nightly analytics | Nightly | Dashboard snapshots | Show last successful refresh |
| Scheduled sending | At least every minute or suitable queue trigger | Provider send event | Idempotent retry; never duplicate-send |
| Reply sync | Push-triggered; polling reconciliation every 5–15 minutes | Reply events and notifications | Token refresh/auth alert; retry cursor |
| Follow-up reminders | Daily | Actions/notifications | Idempotent creation |
| Stall detection | Daily | Admin/shared stalled queue | No automatic reassignment |
| Weekly data comparison | Weekly | Data-quality discrepancies | Log per source; continue others |
| Attachment extraction | Event-driven | Safe extracted text and metadata | Quarantine unsupported/unsafe files |
| Backups | Daily/PITR as available | Recoverable database state | Alert backup failure; restore test before launch |
## 11. Intelligence and AI Requirements
### 11.1 SCOUT — V1 Weighted Rule Engine
SCOUT is deterministic in V1. It reads normalised feature values and active weights, calculates a base score, stores an auditable run, and writes the latest result used by the queue.

The initial 13 weighted factors are:
| Feature | Weight | Range | Purpose |
|---|---:|---|---|
| `south_yorkshire_flag` | 0.2 | 0.0 to 1.0 | Sheffield branch priority: highest single weight |
| `mission_alignment_score` | 0.15 | 0.0 to 1.0 | How well the organisation’s mission fits 180DC services |
| `service_fit_score` | 0.1 | 0.0 to 1.0 | Match to a specific service offering |
| `never_contacted_flag` | 0.08 | 0.0 to 1.0 | Fresh opportunity not yet in the outreach pipeline |
| `income_band` | 0.08 | 1.0 to 5.0 | Organisation size and financial capacity |
| `income_trend` | 0.07 | -1.0 to 1.0 | Growing organisations may be more receptive to support |
| `days_since_last_contact` | 0.07 | 0.0 to 365.0 | Recency measure — stale contacts score lower |
| `financial_stability_score` | 0.05 | 0.0 to 1.0 | Overall financial health |
| `has_recent_grant_flag` | 0.05 | 0.0 to 1.0 | Active organisation that has recently received funding |
| `digital_maturity_score` | 0.05 | 0.0 to 1.0 | Readiness for digital-transformation work |
| `data_completeness_score` | 0.05 | 0.0 to 1.0 | Penalises incomplete organisation records |
| `grant_count` | 0.03 | 0.0 to 50.0 | Track record of external funding |
| `has_partnership_history_flag` | 0.02 | 0.0 to 1.0 | Prior consulting or partnership relationship |
The scoring implementation must:

- validate that active weights are complete and versioned;
- normalise each factor consistently and document missing-value behaviour;
- produce a 0–100 score and score band;
- provide component contributions and a concise explanation;
- capture the exact feature snapshot used;
- support manual or scheduled recalculation;
- prevent CAMs from directly editing final scores;
- permit authorised weight changes through controlled configuration and a new model version.
### 11.2 Personalised Queue Score
A CAM’s personal queue may apply bounded preference boosts for geography, sector, size, donation/partnership history, and contact history. The interface must show that this is a personalised ordering. The objective base score remains unchanged and auditable.
### 11.3 Future Trained Model
The future trained model is not part of V1 acceptance. V1 must nonetheless collect suitable training material:

- frozen input snapshots from the time of scoring/outreach;
- active model/weight version;
- exact generated and final sent content;
- replies and classifications;
- CAM-confirmed outcomes and reasons;
- timestamps and relevant context.

A future model may complement or replace the rule engine only after data quality, label sufficiency, evaluation, bias review, rollback, and explainability requirements are approved.
### 11.4 VOICE — Email Generation
VOICE generates drafts only. It must use approved, organisation-specific context; return structured subject/body output; avoid unsupported claims; respect selected tone/length; and never call the send function. The original generation, prompt/model version, latency, token usage, and edit indicator must be retained.
### 11.5 Client Booklet and Enrichment
LLM summaries are derived data. Every output must retain source context and generation metadata. Content from websites, news, and attachments is untrusted input and must be delimited, filtered, and protected against prompt injection. The model must not follow instructions embedded in source documents.
### 11.6 Reply Intelligence
Reply classification assists the CAM and does not make irreversible relationship decisions. The original reply remains authoritative. Low-confidence results, legal/privacy objections, and sensitive messages must be visibly escalated for human review.
## 12. Email Architecture and Observability
### 12.1 Sending
The preferred implementation uses Gmail API `users.messages.send` or equivalent with each CAM’s authorised account. This provides stable message/thread identifiers and better reconciliation than SMTP. Gmail SMTP may be used as a controlled fallback, but the reduced observability must be recorded.

OAuth tokens are encrypted/server-side. Revocation, expiry, and insufficient scopes produce a clear reconnect action. Sending must be idempotent and use a server-generated unique operation key.
### 12.2 Scheduling
A scheduled message stores the exact approved recipient, subject, body, attachments, sender, and `scheduled_at`. A trusted worker sends due messages. Editing content after approval invalidates that approval. Deactivated users, expired OAuth, suppression, ownership changes, or invalid recipients pause/cancel the send and notify the responsible user/admin.
### 12.3 Delivery, Opens, Clicks, Bounces, and Complaints
The MVP must be accurate about what Gmail can observe:

- **Reliable internal/provider lifecycle:** approved, scheduled, send attempted, accepted/sent, failed, reply received.
- **Bounces:** detected from mailbox delivery-status notifications where possible; not guaranteed as real-time webhooks.
- **Opens/clicks:** optional tracking-pixel/redirect signals only after privacy and deliverability review. They are probabilistic and must be labelled accordingly.
- **Complaints:** Gmail does not provide transactional-provider complaint webhooks. Negative replies, unsubscribe requests, hard-no outcomes, and suppression actions are the operational complaint signals.
- **Unsubscribes/objections:** must update suppression before any later send.

Replies and CAM-confirmed outcomes are the authoritative performance signals for the MVP.
## 13. Validation, Errors, and Edge Cases
### 13.1 Validation Requirements
All writes must be validated server-side. Client-side validation is for usability only. Validate:

- required values and maximum lengths;
- enum membership and state transitions;
- UUIDs and foreign-key existence;
- email and URL syntax;
- organisation identifiers and country codes;
- timestamps and scheduling in the user’s timezone;
- attachment type, size, and malware risk;
- LLM structured output against a schema;
- permissions, ownership, suppression, active account, and rate limits immediately before sensitive actions.
### 13.2 Error Handling Matrix
| Scenario | User experience | System action |
|---|---|---|
| Invalid login | Generic credentials error; retry/reset option | Rate-limit and record security telemetry |
| Inactive account | Access denied; contact admin | No session or send permission |
| External API unavailable | Show stale-data notice where relevant | Retry safely, log API health, preserve last good data |
| Partial ingestion | Admin sees partial status and counts | Commit valid isolated records; quarantine failures |
| Duplicate/ambiguous organisation | Review prompt | Create entity match candidate; do not create duplicate canonical row |
| Unreadable website | Explain and allow manual input/retry | Store failure and avoid fabricated booklet |
| LLM timeout/malformed output | Retry option; preserve user input | Log error/cost, validate schema, no partial trusted write |
| Suppressed recipient | Send controls blocked with reason | Reject server-side and audit attempted action |
| Ownership conflict | Show owner and last contact | Reject restricted action unless admin |
| Duplicate send click/retry | Single confirmation only | Idempotency prevents second provider submission |
| Scheduled send with expired OAuth | Notify user/admin; mark paused/failed | Do not silently switch sender |
| Gmail send accepted but app response lost | Show reconciling state | Reconcile by operation/message ID before retry |
| Reply cannot be matched | Admin reconciliation queue | Preserve message; no guessed association |
| Attachment unsupported/too large | Explain limit | Reject/quarantine without executing content |
| Analytics job failed | Display last updated time | Retain last snapshot and alert |
| Scoring job failed | Display stale score indicator | Retain prior score; log failure |
| Database write conflict | Non-destructive retry message | Use transactions/optimistic concurrency |
| Permission denied | Clear safe message | Do not reveal restricted row existence unnecessarily |
### 13.3 Required Edge Cases
Testing must cover at least:

- same organisation arriving from multiple APIs with conflicting names/addresses;
- organisation with no registry identifier;
- multiple contacts at one organisation;
- duplicate manual entry while an ingestion job is running;
- missing income/grant/enrichment values during scoring;
- score weights changed while a nightly run is in progress;
- two CAMs attempting the first send simultaneously;
- owner deactivated with scheduled messages and unread replies;
- hard-no reply arriving before a scheduled follow-up;
- suppression added milliseconds before send execution;
- daylight-saving/timezone changes for scheduled messages;
- Gmail token revoked after approval but before send;
- provider timeout after message accepted;
- reply forwarded into a different thread;
- attachment containing prompt-injection text;
- stale Client Booklet used for a draft;
- user editing a draft in two browser tabs;
- admin reopening a closed record;
- deletion/privacy request where suppression retention is still required;
- background job rerun after partial failure.
## 14. Non-Functional Requirements
### 14.1 Performance Targets
The following targets are approved baseline values for the MVP:

| Area | Target |
|---|---|
| Initial authenticated page load | ≤3 seconds at p95 |
| Subsequent standard navigation | ≤1.5 seconds at p95 |
| Structured filtering/search | ≤1 second for ordinary queries |
| Natural-language search | ≤5 seconds excluding provider outage |
| Detail Drawer opening | ≤1.5 seconds |
| Single weighted score calculation | ≤500 ms |
| Nightly scoring for 100,000 organisations | ≤30 minutes |
| AI email generation | Ordinarily ≤15 seconds; hard timeout 30 seconds |
| Client Booklet generation | Ordinarily ≤45 seconds; hard timeout 90 seconds |
| Send confirmation | ≤10 seconds after submission under normal provider conditions |
| Scheduled-send timing | Within 5 minutes of selected time |
| Reply synchronisation | Ordinarily within 5 minutes; ≤15 minutes under polling fallback |
| Concurrent authenticated users | At least 30 without material degradation |
| Canonical organisation capacity | At least 100,000 records |
| Default outbound volume cap | 100 emails/day across the platform |
### 14.2 Reliability and Recovery
- Availability target: 99.5% during normal working periods, excluding planned maintenance and third-party outages.
- Recovery point objective: no more than 24 hours of data loss; use point-in-time recovery where available.
- Recovery time objective: restore critical functionality within four hours.
- Daily automated backups and at least one documented restore test before launch.
- External API calls use up to three retries with exponential backoff where safe.
- Jobs, webhooks, and sends must be idempotent.
- A failed optional integration must not make unrelated core records unusable.
### 14.3 Usability and Accessibility
- Desktop-first responsive web interface; full mobile optimisation is deferred.
- Keyboard-accessible navigation and controls for core journeys.
- Visible focus states, semantic labels, and sufficient colour contrast.
- Do not rely on colour alone for status or score meaning.
- Support light/dark mode and text accessibility settings where scheduled.
- Loading, empty, success, partial, stale, and error states must be designed for every major view.
- Destructive or irreversible actions require confirmation and explain consequences.
### 14.4 Maintainability and Observability
- TypeScript types and validation schemas should align with the Data Model.
- Every external API call records status and latency in `API_HEALTH_LOGS` or equivalent.
- Every important application failure records a safe error entry in `ERROR_LOG` and may also be captured by Sentry.
- Logs must exclude secrets and minimise personal data.
- Model/prompt/weight versions are immutable after use.
- Code changes follow one story, one branch, one pull request where practical.
## 15. Security, GDPR, and Compliance
- Supabase row-level security is enabled on every user-accessible table using deny-by-default policies.
- Service-role operations are server-side and narrowly scoped.
- Secrets and Gmail OAuth tokens are encrypted and never committed to source control.
- Staging and production use separate credentials.
- All sensitive actions are authorised server-side.
- Inputs are validated and output encoded to reduce injection risks.
- Prompt injection is explicitly tested for website, email, and attachment content.
- Professional contact data is minimised; special-category and unnecessary personal data must not be collected.
- A documented Legitimate Interest Assessment is required before live outreach.
- Outreach templates explain who is contacting the recipient, why, the source of professional details, and how to object or opt out.
- Suppression is enforced before every send.
- Data-subject access, correction, objection, and deletion requests must be supportable.
- Retention periods must be documented; expired data is deleted or anonymised, while minimum suppression data may be retained.
- Processor records and transfer safeguards are maintained for Supabase, Google, Vercel, PostHog, the LLM provider, and other processors.
- Security testing includes cross-CAM access, direct score edits, unauthorised sends, secret exposure, injection, prompt injection, suppression enforcement, and restore testing.
- Incident response includes containment, token revocation, evidence preservation, impact assessment, remediation, and ICO escalation within 72 hours where legally required.
## 16. Data Model and Storage Requirements
### 16.1 Data Lifecycle
The database follows a layered lifecycle:

1. Raw source ingestion.
2. Validation and entity matching.
3. Canonical entities.
4. Enrichment and feature engineering.
5. Scoring/predictions.
6. CAM review and outreach.
7. Replies and confirmed outcomes.
8. Analytics, monitoring, and future training records.

Raw records remain traceable. Canonical entities are used operationally. Derived AI content is stored separately and labelled. Analytics are read-optimised outputs rather than replacements for operational records.
### 16.2 Database Conventions
- Table names use `UPPER_SNAKE_CASE`; fields use `lower_snake_case`.
- New tables include a UUID primary key and `created_at` unless a documented exception applies.
- Foreign keys are explicit and indexed where query patterns require.
- Shared schema changes require a migration and Data Model update.
- Row-level security policies are created in the same migration as the table.
- Destructive renames/drops require cross-team approval and a migration/backfill plan.
- Timestamps are stored in UTC and rendered in the user’s timezone.
- Enum changes require compatibility review.
### 16.3 Migration Sequence
| Step | Migration | Objects | Depends on | Notes |
|---:|---|---|---|---|
| 1.0 | `enable_extensions` | uuid-ossp / pgcrypto (pgvector deferred to scoring Stage 2) | - | Extensions before any table |
| 2.0 | `create_users` | USERS | Supabase Auth | Mirror of auth.users with role + is_active; RLS on |
| 3.0 | `create_organisations` | ORGANISATIONS | USERS (owner_id) | Core entity table |
| 4.0 | `create_org_children` | ORGANISATION_IDENTIFIERS, CONTACTS, FINANCIAL_PERIODS, GRANTS, ENRICHMENT_RESULTS, NOTES | ORGANISATIONS, USERS | All FK to ORGANISATIONS |
| 5.0 | `create_tags` | TAGS, ORG_TAGS | ORGANISATIONS, USERS | Bridge table ORG_TAGS |
| 6.0 | `create_ingestion` | INGESTION_RUNS, RAW_SOURCE_RECORDS | USERS, ORGANISATIONS | RAW_SOURCE_RECORDS FK to INGESTION_RUNS |
| 7.0 | `create_quality` | DATA_QUALITY_EVENTS, ENTITY_MATCH_CANDIDATES, MANUAL_ENTRY_RECORDS | RAW_SOURCE_RECORDS, ORGANISATIONS, USERS | Raw-data checks and the manual entry track |
| 8.0 | `create_model_config` | MODEL_VERSIONS, SCORING_WEIGHTS, FEATURE_DEFINITIONS, AGENT_PROMPTS | USERS | Intelligence configuration (tab 05) |
| 9.0 | `create_predictions` | AGENT_RUNS, LATEST_SCORES | ORGANISATIONS, MODEL_VERSIONS, USERS | LATEST_SCORES FK to AGENT_RUNS |
| 10.0 | `create_email_library` | EMAIL_PERFORMANCE_LIBRARY | OUTREACH_MESSAGES (nullable until step 11) | Or create after step 11 if the FK is NOT NULL |
| 11.0 | `create_outreach` | OUTREACH_MESSAGES, AI_GENERATIONS | ORGANISATIONS, CONTACTS, USERS, AGENT_RUNS | Draft and send records |
| 12.0 | `create_outreach_events` | SEND_EVENTS, REPLY_EVENTS, OUTCOMES | OUTREACH_MESSAGES, ORGANISATIONS, CONTACTS, USERS | Delivery, replies, ground truth |
| 13.0 | `create_analytics` | API_HEALTH_LOGS, INGESTION_SUMMARY, COST_TRACKING, ERROR_LOG, CAM_ACTIVITY_SUMMARY, PIPELINE_METRICS, SECTOR_PERFORMANCE | USERS | Tabs 08-09 |
| 14.0 | `create_pulse_view` | sector_trends (SQL view) | ORGANISATIONS, GRANTS, FINANCIAL_PERIODS | PULSE is a view, not a table |
| 15.0 | `enable_rls_policies` | RLS policies on every table | All tables | Per the Security Controls Register (tab 12) |
| 16.0 | `create_indexes` | Indexes: FKs, LATEST_SCORES.priority_score, ORGANISATIONS.outreach_status, RAW_SOURCE_RECORDS.checksum | All tables | Query performance for the dashboard |
| 17.0 | `configure_backups` | Daily backups + point-in-time recovery | - | Supabase |
### 16.4 Schema Summary
- **`INGESTION_RUNS`** (03 Raw Data): 13 defined fields.
- **`RAW_SOURCE_RECORDS`** (03 Raw Data): 14 defined fields.
- **`DATA_QUALITY_EVENTS`** (03 Raw Data): 14 defined fields.
- **`ENTITY_MATCH_CANDIDATES`** (03 Raw Data): 14 defined fields.
- **`MANUAL_ENTRY_RECORDS`** (03 Raw Data): 16 defined fields.
- **`ORGANISATIONS`** (04 Entities): 21 defined fields.
- **`ORGANISATION_IDENTIFIERS`** (04 Entities): 11 defined fields.
- **`CONTACTS`** (04 Entities): 11 defined fields.
- **`FINANCIAL_PERIODS`** (04 Entities): 10 defined fields.
- **`GRANTS`** (04 Entities): 10 defined fields.
- **`ENRICHMENT_RESULTS`** (04 Entities): 14 defined fields.
- **`USERS`** (04 Entities): 9 defined fields.
- **`NOTES`** (04 Entities): 6 defined fields.
- **`TAGS`** (04 Entities): 5 defined fields.
- **`ORG_TAGS`** (04 Entities): 5 defined fields.
- **`SCORING_WEIGHTS`** (05 - Features): 19 defined fields.
- **`FEATURE_DEFINITIONS`** (05 - Features): 21 defined fields.
- **`AGENT_PROMPTS`** (05 - Features): 4 defined fields.
- **`EMAIL_PERFORMANCE_LIBRARY`** (05 - Features): 2 defined fields.
- **`AGENT_RUNS`** (06 - Predictions): 12 defined fields.
- **`LATEST_SCORES`** (06 - Predictions): 16 defined fields.
- **`MODEL_VERSIONS`** (06 - Predictions): 10 defined fields.
- **`OUTREACH_MESSAGES`** (07 Outreach & Outcomes): 12 defined fields.
- **`AI_GENERATIONS`** (07 Outreach & Outcomes): 7 defined fields.
- **`SEND_EVENTS`** (07 Outreach & Outcomes): 6 defined fields.
- **`REPLY_EVENTS`** (07 Outreach & Outcomes): 10 defined fields.
- **`OUTCOMES`** (07 Outreach & Outcomes): 7 defined fields.
- **`API_HEALTH_LOGS`** (08 System Analytics): 7 defined fields.
- **`INGESTION_SUMMARY`** (08 System Analytics): 7 defined fields.
- **`COST_TRACKING`** (08 System Analytics): 6 defined fields.
- **`ERROR_LOG`** (08 System Analytics): 7 defined fields.
- **`CAM_ACTIVITY_SUMMARY`** (09 CAM Analytics): 8 defined fields.
- **`PIPELINE_METRICS`** (09 CAM Analytics): 8 defined fields.
- **`SECTOR_PERFORMANCE`** (09 CAM Analytics): 7 defined fields.
## 17. Analytics and Reporting
Required dashboards and reports include:

- CAM personal activity: organisations reviewed, messages sent, replies, conversions, response time, tone use, and trends;
- queue and pipeline funnel: database → contacted → replied → converted;
- team pipeline by owner, stage, sector, score range, and days in stage;
- stalled records and overdue actions;
- sector performance compared with average SCOUT score;
- ingestion volume, validation failures, and source freshness;
- API health, latency, and repeated failures;
- LLM/API token and cost tracking;
- unresolved platform errors;
- data-quality issues by source/severity.

Analytics snapshots must show their last successful update time. Personal performance analytics are for support and operational learning, not opaque punitive ranking.
## 18. Testing and Acceptance
### 18.1 Definition of Done
A story is Done only when every applicable condition is met:

- works end-to-end in staging;
- has peer review by someone who did not write it;
- is demonstrated live during the sprint review;
- writes only to the approved schema;
- includes a migration and updated Data Model for schema changes;
- proves that outreach cannot send without explicit CAM approval;
- records failures in `ERROR_LOG` and external calls in `API_HEALTH_LOGS`;
- has tests for main success, important failure, permission, and suppression paths;
- provides safe user-facing errors without secrets or stack traces;
- updates relevant documentation and acceptance evidence.

There is no “Done with a caveat.” Failed required criteria return the story to In Progress.
### 18.2 Test Layers
| Layer | Minimum coverage |
|---|---|
| Unit | Scoring calculations, validation, state transitions, feature engineering, permission helpers |
| Integration | Supabase writes/RLS, Gmail adapters, ingestion transformations, LLM schema validation |
| End-to-end | Login, search, profile, scoring, draft, approval, send, reply, pipeline, outcome, reassignment |
| Security | Cross-CAM access, suppression bypass, direct API attempts, injection, secret exposure |
| Reliability | Retry/idempotency, duplicate webhooks, partial ingestion, provider timeout reconciliation |
| Performance | Core page/search targets, nightly scoring, scheduled sends, concurrent users |
| Recovery | Backup restore and critical workflow verification |
| User acceptance | CAM/admin tester completes realistic workflows and records feedback |
### 18.3 MVP Acceptance Journeys
1. Admin creates and activates a CAM; CAM logs in and completes setup.
2. External records are ingested, validated, deduplicated, and promoted into a canonical organisation.
3. CAM manually submits an organisation; admin reviews and promotes/merges it.
4. Nightly weighted scoring produces a ranked, explainable queue.
5. CAM searches and opens the organisation Detail Drawer with complete context.
6. CAM generates a Client Booklet and email draft, edits it, and explicitly approves it.
7. Backend rejects a send to a suppressed or conflicting-owned record.
8. Approved message sends/schedules exactly once and is recorded with provider IDs.
9. Reply synchronises, is classified, appears on the timeline, and notifies the owner.
10. CAM updates pipeline and records a final outcome.
11. Admin deactivates a CAM and reassigns open work with complete history.
12. API failure, LLM failure, and scoring-job failure are surfaced and logged.
13. Backup restore is demonstrated and documented.
## 19. Delivery and Governance
- Six developers operate as two cross-functional teams of three.
- At each sprint start, the Project Leader assigns epics according to priority, dependencies, and capacity.
- Two Scrum Masters rotate and coordinate feature areas; they are not additional headcount.
- GitHub Projects is the authoritative sprint board: To Do → In Progress → In Review → Done.
- One story maps to one card, branch, and pull request where practical.
- Blockers lasting more than half a day are escalated immediately.
- Wednesday coordination resolves cross-team schema/interface decisions.
- Sprint-end Sunday review includes live software demonstration and retrospective.
- Testing happens throughout delivery. Week eight is final integration, regression, security, performance, hardening, documentation, and launch—not the first test period.
### 19.1 Milestones
| Milestone | Target | Evidence |
|---|---|---|
| Kick-off | 13 July 2026 | Backlog, ownership, environments, dependencies confirmed |
| Sprint 1 review | 26 July 2026 | Foundations, auth, schema, ingestion/list foundations |
| Sprint 2 review | 9 August 2026 | Scoring, ranked queues, related interfaces |
| Sprint 3 review | 23 August 2026 | Booklets, drafting, review, and outreach controls |
| MVP build complete | End of August 2026 | End-to-end staging workflow, QA, security, handover docs |
| Final presentation/handover | 6 September 2026 | Demo, test evidence, recommendations, rollout plan |
## 20. Risks and Mitigations
| Risk | Mitigation |
|---|---|
| External APIs fail or change | Modular adapters, API health logs, schema validation, retries, last-good data, source-level isolation |
| Duplicate or conflicting organisation records | Raw preservation, deterministic identifiers, confidence thresholds, human match review |
| LLM produces unreliable content | Trusted context, structured output validation, source labels, CAM review, no autonomous send |
| Wrong organisation details enter an email | Organisation-scoped queries, explicit IDs, preview context, tests, immutable final message record |
| Gmail credentials compromised | Encrypted OAuth, least privilege, revocation process, account deactivation, audit |
| High volume harms sender reputation | 100/day platform cap, throttling, bounce/objection monitoring, suppression, staged rollout |
| Parallel teams diverge | Cross-functional epic ownership, shared contracts, Wednesday dependency review, staging integration |
| Scope creep harms P1/P2 | No mid-sprint additions; change control; P3 yields first |
| Scoring lacks trust | Transparent factor contributions, versioning, CAM feedback, outcome-based future evaluation |
| Platform adds work rather than saving time | Usability testing with CAMs, fast actions, personal queue, integrated history |
| Monday.com coexistence creates duplication | Define rollout ownership and migration/retirement plan; avoid duplicate mandatory entry |
| Privacy or opt-out failure | LIA, minimisation, transparent templates, backend suppression, audit, incident process |
| Late integration defects | Continuous staging tests, E2E tests per sprint, week-eight hardening rather than first integration |
| Knowledge concentrated in one person | Documentation, peer review, demos, shared ownership, migration and runbooks |
## 21. Assumptions and Approved Defaults
- The platform is initially for 180DC Sheffield, not multiple independent tenants.
- The normal scale is fewer than 30 concurrent users and up to 100,000 organisations.
- The project may select a specific LLM provider, search provider, CAPTCHA provider, and email-verification provider during implementation without changing product behaviour, provided security/cost requirements are met.
- The weighted rule engine is the only required V1 scoring engine.
- P1 and P2 must be completed; P3 is delivered in priority order as capacity allows.
- No wireframes are required to begin; text-based view requirements in this PRD are authoritative until designs are approved.
- Gmail telemetry limitations are accepted; replies and confirmed outcomes are authoritative engagement measures.
- Admin role is database-controlled, not granted automatically by email domain.
## 22. Open Decisions Register
The following implementation choices may be resolved by the teams without blocking PRD approval. Decisions must be documented before the affected feature reaches In Review:

| Decision | Owner | Deadline/trigger |
|---|---|---|
| Final LLM provider and model | Project Leader + implementation team | Before first production generation |
| Live news search provider | Project Leader | Before Stage 2/news-hook implementation |
| Email verification provider | Backend/Data team | Before deliverability verification release |
| CAPTCHA provider | Foundation epic owner | Before login security acceptance |
| Secrets-management approach beyond Vercel/Supabase | Project Leader | Before production credentials |
| Gmail push vs polling implementation detail | Email epic owner | Before reply-sync acceptance |
| Attachment size/type limits | Security + email epic owner | Before attachment feature release |
| Exact retention periods | Data controller / project leadership | Before live personal data |
| Whether optional open/click tracking is activated | Data controller + leadership | Only after privacy/deliverability review |
## Appendix A — Authoritative 240-Feature Register
This register is generated from the backlog entries selected by the Gantt. Priority labels retain their backlog wording; `P1/P2` is treated as required, and `P2/P3` is treated according to the final prioritisation decision made during sprint planning without displacing mandatory P1/P2 work.
### Audit & Security
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F221` | P1 | Audit Logs | As an admin, I want audit logs, so that I know who changed what and when. | F001, F224 |
| `F222` | P1 | Input Validation | As an admin, I want all forms validated, so that bad data does not enter the system. | F232 |
| `F223` | P1 | API Key Protection | As a developer, I want secrets stored outside code, so that credentials are not exposed. | None |
| `F224` | P1 | Row-Level Security | As an admin, I want database permissions enforced, so that users only access allowed data. | F016, F017, F232 |
| `F225` | P1 | Database Backups | As an admin, I want database backups, so that data can be restored if something goes wrong. | F230, F232 |
| `F226` | P1/P2 | Error Logging | As a developer, I want application errors logged, so that bugs can be fixed quickly. | F229, F230 |
| `F227` | P1/P2 | Rate Limiting | As an admin, I want rate limits, so that login, email, and AI features cannot be abused. | F001, F123, F100 |
| `F228` | P2 | Spam Risk Warning | As an admin, I want warnings when outreach volume is risky, so that the branch email reputation is protected. | F123, F128, F241 |
### System
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F229` | P1 | Staging Environment | As a developer, I want a staging environment, so that features are tested before going live. | F231, F232 |
| `F230` | P1 | Production Environment | As a user, I want a stable live environment, so that the platform is available for real work. | F229, F225, F226 |
| `F231` | P1 | Environment Variables | As a developer, I want environment variables configured, so that secrets and config are managed safely. | F223 |
| `F232` | P1 | Database Migration Management | As a developer, I want database changes managed properly, so that schema updates do not break the app. | F041 |
| `F233` | P1 | Seed/Test Data | As a developer, I want test data, so that features can be developed without touching real client records. | F232, F041 |
| `F238` | P1 | Basic Documentation | As a developer, I want documentation, so that team members can understand how the system works. | F239, F240 |
| `F239` | P1 | Contributor Guide | As a developer, I want contribution rules, so that the team works consistently. | None |
| `F240` | P1 | Definition of Done Checklist | As a team member, I want every issue to have a definition of done, so that finished work meets the same standard. | None |
| `F234` | P1 | Loading States | As a user, I want loading states, so that I know when the platform is working. | F030 |
| `F235` | P1 | Empty States | As a user, I want helpful empty states, so that blank pages explain what to do next. | F030 |
| `F236` | P1 | Error States | As a user, I want clear error messages, so that I know what went wrong and what to do. | F226 |
| `F237` | P3 | Mobile Responsiveness | As a user, I want the platform to work on smaller screens, so that I can use it when needed. | F030 |
### Authentication
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F001` | P1 | Login with Email and Password | As a User, I want to log in with my 180DC email and password, so that I can securely access the platform. | F002, F222, F223, F224 |
| `F002` | P1 | Restrict Login to 180DC Emails | As an admin, I want only approved 180DC email addresses to access the platform, so that unauthorised users cannot join. | F001 |
| `F003` | P2 | CAPTCHA on Login | As an admin, I want login protected by CAPTCHA, so that bots cannot repeatedly attempt access. | F001, F227 |
| `F004` | P1 | Password Reset | As a user, I want to reset my password, so that I can regain access if I forget it. | F001 |
| `F006` | P1 | Logout | As a user, I want to log out, so that I can safely end my session. | F001 |
| `F007` | P2 | Session Expiry | As an admin, I want inactive sessions to expire, so that unattended accounts are protected. | F001 |
### Roles & Permissions
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F016` | P1 | Admin Role | As an admin, I want extra platform permissions, so that I can manage users, ownership, approvals, and settings. | F001, F224 |
| `F017` | P1 | CAM Role | As a CAM, I want access to client acquisition features, so that I can manage outreach work. | F001, F224 |
| `F019` | P1 | Read-Only Shared Client Visibility | As a CAM, I want to view past client communications and notes, so that I understand the relationship history. | F016, F017, F067, F070, F071, F075, F224 |
| `F020` | P2 | Restricted Editing | As an admin, I want CAM to request authorisation users to edit sensitive client fields, so that data stays clean. | F016, F017, F077, F078, F079, F221, F224 |
| `F018` | P1 | Contact Permission Rules | As an admin, I want only permitted CAMs to contact a client, so that duplicate or unauthorised outreach does not happen. | F016, F017, F162, F163, F164, F165, F224 |
### User Management
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F008` | P1 | Invite New CAM | As an admin, I want to invite a new CAM by email, so that they can join the platform. | F002, F016, F017, F223 |
| `F009` | P1 | Accept Invite | As a CAM, I want to accept my invitation, so that I can create my account. | F008, F010 |
| `F010` | P2 | Invite Expiry | As an admin, I want invite links to expire, so that old links cannot be reused. | F008 |
| `F011` | P1 | View Team Members | As an admin, I want to view all users, so that I can manage the team. | F008, F016, F017 |
| `F012` | P1 | Edit User Role | As an admin, I want to change a user’s role, so that the correct permissions apply. | F011, F016, F017, F224 |
| `F013` | P1 | Suspend User | As an admin, I want to suspend a user, so that they can no longer access the platform. | F011, F014, F257 |
| `F014` | P2 | Delete or Deactivate User | As an admin, I want to deactivate old accounts, so that former members cannot access data. | F011, F013, F257 |
| `F015` | P2 | User Profile | As a user, I want to view my profile, so that I can confirm my name, email, and role. | F001, F011 |
| `F252` | P1 | Resend Invite Link | As an admin, I want to resend an invite link to a CAM who has not yet accepted, so that they can still join the platform if the original link expired or was missed. | F008, F010 |
### Onboarding
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F255` | P2 | New CAM First-Run Guide | As a new CAM, I want a guided checklist when I first log in, so that I know how to set up my account and start using the platform without needing to ask for help. | F009, F015, F021 |
### Ownership / Admin
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F257` | P1 | Reassign CAM When Offboarded | As an admin, I want to reassign a CAM’s active clients, tasks, drafts, and pipeline responsibilities when they are offboarded, so that no client relationship or outreach work is lost. | F011, F014, F119 F162, F163, F164, F167, F168, F221 |
### Data Ingestion
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F031` | P1 | CharityBase Import | As an admin, I want to import charities from CharityBase, so that the database has charity records. | F038, F041, F042, F043, F045, F047, F223 |
| `F032` | P1 | Companies House Import | As an admin, I want to import company data from Companies House, so that client records can be enriched. | F038, F041, F042, F043, F047, F223 |
| `F033` | P1 | Charity Commission Import | As an admin, I want to import Charity Commission data, so that charity records are more complete. | F038, F041, F042, F043, F045, F047, F223 |
| `F034` | P2 | Find That Charity Import | As an admin, I want to import data from Find That Charity, so that we can improve charity profiles and contact details. | F038, F041, F042, F043, F045, F047, F223 |
| `F035` | P2 | 360Giving Import | As an admin, I want to import 360Giving data, so that partnership and grant history can inform prioritisation. | F038, F041, F042, F043, F047, F092, F223 |
| `F036` | P1 | Manual Client Entry | As a CAM, I want to manually add a charity, so that useful prospects not found through APIs can still be tracked. | F041, F042, F043, F045, F046, F047, F222 |
| `F038` | P1 | Modular Data Source Structure | As a developer, I want each external data source to be modular, so that future APIs can be added without breaking existing imports. | F223, F232 |
| `F039` | P2 | Import Status Tracking | As an admin, I want to see whether imports succeeded or failed, so that data issues are visible. | F031, F032, F033, F034, F035, F040 |
| `F256` | P3 | Manual URL Import Failure Handling | As a CAM, I want to be clearly informed when a URL import fails, returns insufficient data, or matches an existing record, so that I can decide whether to enter the charity manually or update the existing record instead. | F037, F046, F236 |
### Data Cleaning
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F041` | P1 | Standardise Client Fields | As an admin, I want all incoming records to use the same field structure, so that data is consistent across sources. | F038, F232 |
| `F042` | P1 | Deduplicate Clients | As an admin, I want duplicate records to be detected, so that the same charity is not contacted twice. | F041, F043 |
| `F043` | P1 | Source Tracking | As a user, I want to see where each client record came from, so that I can trust the data. | F041 |
| `F044` | P2 | Field-Level Source Tracking | As an admin, I want to know which source provided each field, so that conflicting data can be reviewed. | F043 |
| `F045` | P1 | Email Format Validation | As a CAM, I want invalid email formats flagged, so that emails are not sent to unusable addresses. | F041, F222 |
| `F046` | P2 | Website URL Validation | As a CAM, I want broken or invalid websites flagged, so that research is more reliable. | F041, F222 |
| `F047` | P1 | Client Criteria Check | As an admin, I want records checked against 180DC’s target client criteria, so that irrelevant organisations are filtered out. | F041 |
| `F048` | P2 | Data Discrepancy Detection | As an admin, I want conflicting data between sources flagged, so that incorrect records can be reviewed. | F043, F044 |
| `F049` | P2 | Weekly Data Refresh Job | As an admin, I want a scheduled job to compare existing records with API data, so that outdated records can be flagged. | F031, F032, F033, F034, F035, F043, F048, F226 |
| `F050` | P1 | Do-Not-Contact Protection | As a CAM, I want charities that asked not to be contacted to be protected, so that we do not accidentally email them again. | F248, F249, F254 |
### Compliance
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F246` | P1 | Public Data Handling Rules | As an admin, I want rules for what public data can be stored, so that the platform avoids storing inappropriate personal data. | F041, F043 |
| `F247` | P1 | Personal Data Exclusion | As an admin, I want private trustee/person data excluded where not needed, so that the platform reduces data risk. | F246, F041 |
| `F248` | P1 | Suppression List | As a CAM, I want charities that opted out to be added to a suppression list, so that they are not contacted again. | F050, F254 |
| `F249` | P1 | Suppression Warning Before Send | As a CAM, I want a warning if I try to email a suppressed client, so that mistakes are prevented. | F123, F248, F254 |
| `F250` | P1 | Human Approval Before Send | As an admin, I want AI emails blocked from automatic sending, so that every message is human-reviewed. | F100, F114, F121 |
### Client Profile
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F254` | P1 | Set Do Not Contact Flag | As a CAM, I want to flag a charity as Do Not Contact from their client profile, so that the team knows not to reach out to them again. | F067, F248, F249 |
| `F067` | P1 | Client Detail Page | As a CAM, I want to open a client profile, so that I can see all information about the organisation. | F051, F068 |
| `F068` | P1 | View Client Basic Info | As a CAM, I want to see name, type, mission, email, address, location, website, and status, so that I understand the client. | F041, F051 |
| `F069` | P1 | View Client Source Data | As a CAM, I want to see where client information came from, so that I can judge reliability. | F043, F067 |
| `F070` | P1 | View Previous Emails | As a CAM, I want to view emails previously sent to a client, so that I avoid repeating or contradicting past outreach. | F067, F123, F125 |
| `F071` | P1 | View Notes | As a CAM, I want to view notes left by other users, so that I understand the relationship history. | F067, F072 |
| `F072` | P1 | Add Note | As a CAM, I want to add notes to a client, so that research and relationship context is saved. | F067, F221, F222 |
| `F073` | P2 | Edit Own Note | As a CAM, I want to edit my own notes, so that I can correct mistakes. | F071, F072, F221 |
| `F074` | P3 | Delete Own Note | As a CAM, I want to delete my own note, so that irrelevant notes can be removed. | F071, F072, F221 |
| `F075` | P1 | View Communication Timeline | As a CAM, I want to view a timeline of all client interactions, so that I know what happened and when. | F067, F076, F159, F221 |
| `F076` | P1 | Timeline Event Types | As a CAM, I want timeline events labelled by type, so that I can understand emails, replies, notes, edits, and status changes. | F075 |
| `F077` | P1 | Suggest Client Edit | As a CAM, I want to suggest corrections to client information, so that inaccurate data can be fixed safely. | F016, F017, F067, F068, F221 |
| `F078` | P2 | Approve Client Edit | As an admin, I want to approve suggested client edits, so that only verified changes affect official records. | F077, F181, F221 |
| `F079` | P2 | Reject Client Edit | As an admin, I want to reject incorrect edit suggestions, so that bad data is not saved. | F077, F181, F221 |
| `F080` | P2/P3 | View Client Attachments | As a CAM, I want to see files attached to a client, so that important documents are easy to find. | F067, F217, F218 |
| `F081` | P3 | Upload Client Attachment | As a CAM, I want to upload files to a client, so that relevant documents are stored in context. | F067, F217, F243 |
| `F251` | P1 | Suppress Charity Record | As a CAM, I want to suppress a charity from the database, so that irrelevant or inappropriate records are hidden from the team's active working list. | F067, F248, F254 |
### Dashboard
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F030` | P1 | Sidebar Navigation | As a user, I want a sidebar with main pages, so that I can move around the platform easily. | F001 |
| `F021` | P1 | CAM Dashboard | As a CAM, I want to see a dashboard after login, so that I know what needs my attention. | F001, F030, F051, F145 |
| `F022` | P1 | Total Charities Count | As a CAM, I want to see how many charities are in the database, so that I understand the available outreach pool. | F021, F051 |
| `F023` | P1 | Contacted Charities Count | As a CAM, I want to see how many charities have been contacted, so that I can track outreach progress. | F021, F123, F125, F145, F157 |
| `F024` | P1 | Responses Received Count | As a CAM, I want to see how many responses have been received, so that I can judge outreach performance. | F021, F131, F132, F138 |
| `F025` | P1 | Converted Clients Count | As a CAM, I want to see how many clients have converted, so that I can understand success. | F021, F143, F150 |
| `F027` | P1 | Needs Attention Panel | As a CAM, I want to see client-specific items that need my attention, so that I can follow up quickly. | F021, F133, F160, F173, F175 |
| `F028` | P2 | Recent Updates | As a CAM, I want to see recent platform updates, so that I know what changed. | F021, F075, F221 |
| `F029` | P2 | Recent Team Activity | As a CAM, I want to see recent actions by other team members, so that the team stays coordinated. | F021, F221 |
### Client Database
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F051` | P1 | Charity List View | As a CAM, I want to view all charities in a list, so that I can browse potential clients. | F031, F032, F036, F041, F042 |
| `F052` | P1 | Search by Organisation Name | As a CAM, I want to search by organisation name, so that I can quickly find a specific charity. | F051 |
| `F053` | P1 | Filter by Organisation Type | As a CAM, I want to filter by organisation type, so that I can focus on relevant prospects. | F051, F041 |
| `F054` | P1 | Filter by Location | As a CAM, I want to filter by location, so that I can focus on a geographic area. | F051, F041 |
| `F055` | P1 | Filter by Sector | As a CAM, I want to filter by sector, so that I can target relevant organisations. | F051, F041 |
| `F056` | P1 | Filter by Outreach Status | As a CAM, I want to filter by outreach status, so that I can see who has or has not been contacted. | F051, F145 |
| `F057` | P1 | Filter by Owner | As a CAM, I want to filter by owner, so that I can see which charities belong to which CAM. | F051, F162, F163, F164 |
| `F058` | P1 | Filter by Priority Score | As a CAM, I want to filter by score, so that I can focus on high-priority charities. | F051, F088 |
| `F059` | P1 | Sort by Priority Score | As a CAM, I want to sort charities by score, so that the best opportunities appear first. | F051, F088 |
| `F060` | P2 | Sort by Location | As a CAM, I want to sort by location, so that similar charities are grouped together. | F051, F054 |
| `F061` | P1 | Sort by Outreach Status | As a CAM, I want to sort by outreach status, so that I can organise my workflow. | F051, F056, F145 |
| `F062` | P1 | Bulk Select Clients | As a CAM, I want to select multiple clients, so that I can update them together. | F051 |
| `F063` | P1 | Bulk Apply Tags | As a CAM, I want to tag multiple clients at once, so that organisation is faster. | F062, F188, F191 |
| `F064` | P2 | Bulk Update Status | As a CAM, I want to update multiple client statuses at once, so that admin work is reduced. | F062, F145, F156 |
| `F065` | P3 | Bulk Add Comment | As a CAM, I want to add a comment to multiple clients, so that shared context can be recorded quickly. | F062, F072 |
| `F066` | P3 | Saved Filter Views | As a CAM, I want to save filter combinations, so that I can return to common searches quickly. | F052, F053, F054, F055, F056, F057 |
### Scoring
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F088` | P1 | Base Client Priority Score | As a CAM, I want every client to have a priority score, so that I know who to contact first. | F041, F047, F089, F090, F091, F093 |
| `F089` | P1 | Score by Sector | As a CAM, I want sector to influence the score, so that relevant charities are prioritised. | F041, F055 |
| `F090` | P1 | Score by Geography | As a CAM, I want location to influence the score, so that outreach can match geographic focus. | F041, F054 |
| `F091` | P1 | Score by Organisation Size | As a CAM, I want size or income to influence the score, so that suitable organisations are prioritised. | F041 |
| `F092` | P2 | Score by Partnership History | As a CAM, I want previous partnership/grant history to influence the score, so that promising organisations are prioritised. | F035, F041 |
| `F093` | P1 | Score by Previous Contact | As a CAM, I want previous contact history to influence the score, so that we avoid poor-fit or over-contacted clients. | F070, F143, F144, F145 |
| `F094` | P1 | Personalised CAM Queue | As a CAM, I want my outreach preferences to adjust my queue, so that the platform reflects my focus area. | F088, F195, F196, F197, F198 |
| `F095` | P2 | Score Breakdown | As a CAM, I want to see why a client received a score, so that I can trust the ranking. | F088, F089, F090, F091, F092, F093 |
| `F096` | P2 | Admin Score Settings | As an admin, I want to adjust scoring weights, so that the team can tune prioritisation. | F088, F180 |
| `F097` | P1 | Outcome Feedback into Score | As an admin, I want outreach outcomes recorded for future scoring, so that the platform can improve over time. | F088, F143, F144, F156 |
| `F098` | P1 | ML-Ready Training Dataset | As the team, we want successful and unsuccessful outreach outcomes stored, so that a model can be trained later. | F112, F138, F143, F144, F097 |
| `F099` | P2 | Minimum Outcome Threshold Tracking | As an admin, I want to know how many labelled outcomes exist, so that we know when ML training is realistic. | F098 |
### Tags
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F188` | P1 | Create Tag | As a CAM, I want to create tags, so that I can organise clients. | F051, F222 |
| `F189` | P2 | Edit Tag | As a CAM, I want to edit tags, so that labels stay useful. | F188 |
| `F190` | P2 | Delete Tag | As an admin, I want to delete unused tags, so that the system stays clean. | F188, F192 |
| `F191` | P1 | Assign Tag to Client | As a CAM, I want to assign tags to clients, so that I can categorise them. | F067, F188 |
| `F192` | P1 | Remove Tag from Client | As a CAM, I want to remove tags from clients, so that categories stay accurate. | F191 |
| `F193` | P1 | Filter by Tag | As a CAM, I want to filter clients by tag, so that I can find grouped clients quickly. | F051, F191 |
| `F194` | P3 | Tag Colours | As a CAM, I want tags to have colours, so that they are easier to scan visually. | F188 |
### Settings
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F195` | P1 | Outreach Preferences | As a CAM, I want to set outreach preferences, so that my queue is personalised. | F015, F088 |
| `F196` | P1 | Geographic Preference | As a CAM, I want to prioritise specific locations, so that outreach matches my focus. | F195, F090 |
| `F197` | P1 | Sector Preference | As a CAM, I want to prioritise specific sectors, so that outreach matches branch strategy. | F195, F089 |
| `F198` | P1 | Size Preference | As a CAM, I want to prioritise charities by size, so that I target suitable clients. | F195, F091 |
| `F199` | P2 | Previous Donation/Grant Preference | As a CAM, I want previous donations or grant history to influence my queue, so that I can target experienced organisations. | F195, F092 |
| `F200` | P2 | Account Settings | As a user, I want to manage account settings, so that my profile stays accurate. | F015 |
| `F201` | P2 | Notification Frequency | As a user, I want to set notification frequency, so that the platform does not overwhelm me. | F173, F178, F200 |
| `F202` | P2 | Follow-Up Timing Settings | As a CAM, I want to set reminder timing, so that follow-ups match my workflow. | F160, F161, F200 |
| `F203` | P3 | Dark Mode | As a user, I want dark mode, so that the interface is comfortable to use. | F200 |
| `F204` | P3 | Light Mode | As a user, I want light mode, so that I can use the default interface. | F200 |
| `F205` | P3 | Text Accessibility Settings | As a user, I want text accessibility settings, so that the platform is easier to read. | F200 |
### Client Booklet
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F082` | P1 | Generate Client Booklet | As a CAM, I want to generate a client booklet, so that I can quickly understand the charity before outreach. | F067, F083, F112, F223 |
| `F083` | P1 | Use Client Data in Booklet | As a CAM, I want the booklet to use existing profile data, so that the summary is relevant. | F067, F068, F082 |
| `F084` | P2 | Use Website URL in Booklet | As a CAM, I want to paste a website URL for booklet generation, so that the booklet can use current website context. | F037, F046, F082 |
| `F085` | P2 | Save Generated Booklet | As a CAM, I want generated booklets saved to the client profile, so that future CAMs can reuse them. | F082, F112 |
| `F086` | P2 | Regenerate Client Booklet | As a CAM, I want to regenerate a booklet, so that outdated or poor summaries can be improved. | F082, F085 |
| `F087` | P2 | Booklet Source References | As a CAM, I want to see which sources were used in a booklet, so that I can trust the output. | F082, F083, F084 |
### Email Generation
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F100` | P1 | Generate Stage 1 Outreach Email | As a CAM, I want to generate an initial outreach email, so that I can contact a charity efficiently. | F067, F082, F102, F112, F113, F223, F250 |
| `F101` | P1 | Generate Stage 2 Follow-Up Email | As a CAM, I want to generate a follow-up email, so that I can continue outreach professionally. | F100, F103, F145, F148 |
| `F102` | P1 | Use Client Profile Data in Email | As a CAM, I want emails to use client profile data, so that outreach feels personalised. | F067, F068, F100 |
| `F103` | P1 | Use Client Booklet in Email | As a CAM, I want emails to use booklet insights, so that the message is more relevant. | F082, F100 |
| `F104` | P1 | Tone Template by Charity Size | As a CAM, I want different tone templates based on charity size, so that emails feel appropriate. | F091, F100 |
| `F105` | P1 | Email Length Setting | As a CAM, I want to adjust email length, so that the draft matches the situation. | F100 |
| `F106` | P1 | Email Voice Setting | As a CAM, I want to adjust email voice, so that the draft matches 180DC’s communication style. | F100 |
| `F107` | P1 | Email Tone Setting | As a CAM, I want to adjust tone, so that emails can be formal, warm, concise, etc. | F100 |
| `F108` | P2 | Opening Approach Setting | As a CAM, I want to choose the opening approach, so that the email starts in the right way. | F100 |
| `F109` | P2 | Closing Approach Setting | As a CAM, I want to choose the closing approach, so that the call-to-action is appropriate. | F100 |
| `F111` | P1 | Regenerate Email Draft | As a CAM, I want to regenerate a draft, so that I can get a better version if the first is weak. | F100, F112 |
| `F112` | P1 | Save AI Prompt and Output | As an admin, I want prompts and generated outputs stored, so that the team can audit and improve generation. | F100, F113, F221 |
| `F113` | P2 | Track Model Used | As an admin, I want to record which AI model generated each draft, so that performance and cost can be compared. | F100 |
### Email Review
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F114` | P1 | Email Editor | As a CAM, I want to edit generated emails before sending, so that no AI email is sent without human review. | F100, F115, F116, F117, F250 |
| `F115` | P1 | Review Subject Line | As a CAM, I want to review and edit the subject line, so that the email is appropriate. | F114 |
| `F116` | P1 | Review Recipient Email | As a CAM, I want to review the recipient email, so that messages are sent to the right address. | F114, F045 |
| `F117` | P1 | Review Formatting | As a CAM, I want to review email formatting, so that the final email looks professional. | F114 |
| `F118` | P2/P3 | Attachment Review | As a CAM, I want to review attachments before sending, so that the correct files are included. | F114, F217 |
| `F119` | P1 | Save Email Draft | As a CAM, I want to save an email as a draft, so that I can return to it later. | F114, F130 |
| `F120` | P1 | Discard Email Draft | As a CAM, I want to discard a draft, so that poor drafts do not clutter the system. | F114, F119 |
| `F121` | P1 | Human Review Checkpoint | As an admin, I want every AI-generated email to require human approval before sending, so that mistakes are not sent automatically. | F114, F250 |
| `F122` | P2 | Admin Approval Queue | As an admin, I want to review emails before they are sent, so that quality can be controlled. | F114, F121, F181 |

> **Descoped 26 Aug 2026:** F122 will not be built (#119 closed as not planned). The team decided the admin approval step is inefficient; after CAM review (F114/F121), the CAM sends directly with no admin gate. Human approval before send is still enforced at the CAM level by F121. F181 (Approval Tab) is unaffected — it also covers pending client-edit suggestions (F077–F079).

### Email Sending
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F123` | P1 | Send Email | As a CAM, I want to send a reviewed email, so that outreach can begin. | F114, F121, F124, F128, F241, F249, F250 |
| `F124` | P1 | Send via Branch Email | As the team, we want emails to send from the branch client email, so that outreach is consistent. | F241, F223 |
| `F125` | P1 | Save Sent Email to Client Profile | As a CAM, I want sent emails saved to the client profile, so that communication history is complete. | F123, F130, F159 |
| `F126` | P2 | Schedule Email | As a CAM, I want to schedule an email for a future time, so that outreach can be timed properly. | F119, F123, F130 |
| `F128` | P1 | Sending Limit Protection | As an admin, I want daily sending limits, so that the branch email is not flagged as spam. | F123, F124, F227, F228 |
| `F129` | P1 | Send Failure Handling | As a CAM, I want to know when sending fails, so that I can retry or fix the issue. | F123, F226, F236 |
| `F130` | P1 | Email Delivery Status | As a CAM, I want to see whether an email was draft, scheduled, sent, or failed, so that I know its state. | F119, F123, F126 |
### Integrations
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F241` | P1 | Gmail SMTP Integration | As a CAM, I want emails sent through Gmail SMTP, so that outreach uses the branch email system. | F223, F231 |
### Reply Handling
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F131` | P1 | Detect Replies | As a CAM, I want replies to be detected, so that I know when a charity responds. | F123, F125, F242 |
| `F132` | P1 | Link Reply to Client | As a CAM, I want replies linked to the correct client profile, so that conversations stay organised. | F067, F125, F131 |
| `F133` | P1 | Reply Notification | As a CAM, I want to be notified when my owned client replies, so that I can respond quickly. | F132, F173, F174, F162 |
| `F134` | P1 | View Full Email Thread | As a CAM, I want to see the full email thread, so that I can reply with context. | F070, F131, F132 |
| `F135` | P2 | Draft Reply Follow-Up | As a CAM, I want to draft a response from the reply view, so that I can continue the conversation. | F101, F114, F134 |
| `F136` | P2 | Add Note from Reply | As a CAM, I want to add a note while viewing a reply, so that important context is captured. | F072, F134 |
| `F137` | P1 | Update Status from Reply | As a CAM, I want to update pipeline status from the reply view, so that the CRM reflects the latest outcome. | F134, F145, F156 |
### Email Analytics
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F138` | P1 | Track Replies | As a CAM, I want reply counts tracked, so that I can measure outreach performance. | F131, F132 |
| `F139` | P2 | Track Response Time | As a CAM, I want response time tracked, so that I can understand how quickly clients reply. | F125, F131, F138 |
| `F143` | P1 | Track Conversion | As a CAM, I want conversions tracked, so that successful outreach is measurable. | F145, F150, F156 |
| `F144` | P1 | Track Email Outcome | As a CAM, I want each outreach attempt labelled with an outcome, so that performance can be analysed. | F138, F143, F145, F151, F152, F153, F154, F155 |
### CRM Pipeline
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F145` | P1 | Pipeline Status Field | As a CAM, I want every client to have a pipeline status, so that the team knows where they stand. | F067 |
| `F146` | P1 | Not Contacted Status | As a CAM, I want to mark clients as not contacted, so that they remain available for outreach. | F145 |
| `F147` | P1 | Initial Outreach Sent Status | As a CAM, I want to mark initial outreach as sent, so that progress is clear. | F145, F123 |
| `F148` | P1 | Follow-Up Sent Status | As a CAM, I want to mark follow-up sent, so that next actions are clear. | F145, F101, F123 |
| `F149` | P1 | Responded Status | As a CAM, I want to mark clients as responded, so that replies are visible. | F145, F131 |
| `F150` | P1 | Converted Status | As a CAM, I want to mark clients as converted, so that successful outreach is recorded. | F145, F143 |
| `F151` | P1 | Future Potential Status | As a CAM, I want to mark clients as future potential, so that we can revisit them later. | F145 |
| `F152` | P1 | Soft No Status | As a CAM, I want to mark soft no, so that the team knows the client declined but may be open later. | F145 |
| `F153` | P1 | Hard No Status | As a CAM, I want to mark hard no, so that the team avoids contacting unsuitable clients again. | F145, F248 |
| `F154` | P1 | No Response Status | As a CAM, I want to mark no response, so that inactive outreach is recorded. | F145 |
| `F155` | P2 | Loss Due to Timing Status | As a CAM, I want to mark loss due to timing, so that future outreach can be better timed. | F145 |
| `F156` | P1 | Manual Status Update | As a CAM, I want to manually update client status, so that the CRM reflects reality. | F145, F221 |
| `F157` | P1 | Automatic Status Update on Email Sent | As a CAM, I want the client status to update when an email is sent, so that manual admin is reduced. | F123, F125, F145, F147 |
| `F158` | P2 | Automatic Status Update on Reply | As a CAM, I want the client status to update when a reply is received, so that the CRM stays current. | F131, F132, F145, F149 |
| `F159` | P1 | Contact Log | As a CAM, I want an immutable contact log, so that the team has a reliable record of outreach. | F070, F075, F123, F131, F156, F221 |
| `F160` | P1 | Follow-Up Recommendations | As a CAM, I want the platform to recommend follow-ups after a set number of days, so that clients are not forgotten. | F145, F148, F156, F173, F175 |
| `F161` | P2 | Follow-Up Reminder Timing | As a CAM, I want to adjust follow-up reminder timing, so that it fits my workflow. | F160, F202 |
### Ownership
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F162` | P1 | Take Ownership of Client | As a CAM, I want to take ownership of a client, so that responsibility is clear. | F067, F016, F017, F018 |
| `F163` | P1 | Assign Client Owner | As an admin, I want to assign a client to a CAM, so that ownership is controlled. | F011, F016, F017, F067, F162 |
| `F164` | P1 | Change Client Owner | As an admin, I want to change ownership, so that clients can be reassigned when needed. | F163, F221 |
| `F165` | P1 | Ownership Conflict Warning | As a CAM, I want to be warned if someone else owns a client, so that duplicate outreach is avoided. | F162, F163, F164, F018 |
| `F166` | P1 | View My Owned Clients | As a CAM, I want to view clients I own, so that I can manage my workload. | F162, F051 |
| `F167` | P1 | View Team Ownership | As an admin, I want to see who owns which clients, so that team workload is clear. | F011, F163, F164, F182 |
| `F253` | P2 | Bulk Assign Client Owner | As an admin, I want to select multiple clients and assign them to a CAM in one action, so that ownership can be set up quickly when onboarding a new team member or redistributing workload. | F062, F163, F167 |
### Actions
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F168` | P1 | My Actions Tab | As a CAM, I want an actions tab, so that I can see work assigned to me. | F162, F170, F173 |
| `F169` | P2 | Admin-Assigned Actions | As an admin, I want to assign actions to CAMs, so that follow-up work is clear. | F011, F168, F170 |
| `F170` | P1 | Action Due Dates | As a CAM, I want actions to have due dates, so that I know what is urgent. | F168 |
| `F171` | P1 | Mark Action Complete | As a CAM, I want to mark actions complete, so that my queue stays accurate. | F168, F221 |
| `F172` | P2 | Overdue Action Warning | As a CAM, I want overdue actions highlighted, so that I can prioritise them. | F168, F170, F173 |
### Notifications
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F173` | P1 | In-App Notifications | As a user, I want in-app notifications, so that important updates are visible. | F001, F177 |
| `F174` | P1 | Reply Notifications | As a CAM, I want reply notifications, so that I can respond quickly. | F133, F173 |
| `F175` | P1 | Reminder Notifications | As a CAM, I want follow-up reminders, so that clients are not forgotten. | F160, F173 |
| `F176` | P2 | Team Activity Notifications | As a CAM, I want team activity notifications, so that I know what others are doing. | F173, F221 |
| `F177` | P1 | Notification Read Status | As a user, I want to mark notifications as read, so that I can manage my updates. | F173 |
| `F178` | P3 | Notification Preferences | As a user, I want to choose notification frequency, so that alerts are manageable. | F173, F201 |
| `F179` | P2 | Email Notifications | As a CAM, I want important notifications sent by email, so that I do not miss urgent items. | F173, F178, F223 |
### Admin
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F180` | P2 | Admin Dashboard | As an admin, I want a dashboard showing team-wide pipeline activity, so that I can manage performance. | F011, F021, F145, F167, F206, F212 |
| `F181` | P1 | Approval Tab | As an admin, I want an approvals tab, so that pending edits/emails/actions can be reviewed. | F078, F079, F122, F180 |
| `F182` | P2 | Team Pipeline View | As an admin, I want to see all clients and their pipeline stages, so that I can monitor progress. | F145, F167, F180 |
| `F183` | P2 | Stall Detection | As an admin, I want to detect clients that have not been followed up, so that no opportunity is lost. | F160, F170, F182 |
| `F184` | P2 | Whole-Team Stall Notification | As an admin, I want the team notified when a client is stalled, so that someone can take action. | F173, F175, F183 |
| `F185` | P2 | Remove Suppression | As an admin, I want to unsuppress hidden charities, so that mistakenly hidden records can be restored. | F251, F180, F248 |
| `F186` | P1 | View Client Change History | As an admin, I want to see changes made to clients, so that I can audit data quality. | F075, F221, F180 |
| `F187` | P3 | View CAM Settings | As an admin, I want to see relevant CAM settings, so that I understand how their queue is configured. | F195, F200, F180 |
### Analytics
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F206` | P2 | CAM Personal Analytics | As a CAM, I want to see my outreach analytics, so that I can understand my performance. | F138, F139, F143, F144, F166 |
| `F207` | P2 | Conversion vs No Response Ratio | As a CAM, I want to see conversions vs no responses, so that I can evaluate outreach quality. | F143, F144, F206 |
| `F208` | P2 | Typical Response Time | As a CAM, I want to see typical response time, so that I know when to follow up. | F139, F206 |
| `F209` | P3 | Tone Performance | As a CAM, I want to see which email tones perform best, so that future emails improve. | F104, F107, F138, F143, F144, F206 |
| `F210` | P2 | Conversions Over Time | As an admin, I want to see conversions over time, so that I can track progress. | F143, F150, F212 |
| `F211` | P3 | Time Spent Tracking | As a CAM, I want to see time spent on platform tasks, so that productivity can be understood. | F206, F221 |
| `F212` | P3 | Manager Analytics | As an admin, I want team-level analytics, so that I can see what is working and where support is needed. | F180, F206, F207, F208, F210 |
| `F213` | P2/P3 | LLM Cost Tracking | As an admin, I want AI usage and cost tracked, so that spending stays under control. | F100, F112, F113 |
### Search
| ID | Priority | Feature | User story | Dependencies |
|---|---|---|---|---|
| `F214` | P2 | Natural Language Charity Search | As a CAM, I want to search in natural language, so that I can find charities using plain English. | F051, F067, F088, F223 |
| `F215` | P2 | Search by Mission | As a CAM, I want to search by mission, so that I can find organisations aligned with specific causes. | F051, F068, F214 |
| `F216` | P3 | Search by Similarity | As a CAM, I want to find charities similar to a successful past client, so that I can discover better prospects. | F088, F143, F144, F214 |
## Appendix B — Complete Data Dictionary
The following field-level dictionary is compiled from the attached Data Model workbook. The workbook remains authoritative for implementation notes, collection methods, nullability, and future edits. Blank descriptions indicate fields that were defined without explanatory text in the dictionary source.
### INGESTION_RUNS (03 Raw Data)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | — |
| `api_source` | `enum` | — | — |
| `triggered_by` | `enum` | — | — |
| `triggered_by_user_id` | `uuid` | `USERS` | — |
| `started_at` | `timestamp` | — | — |
| `completed_at` | `timestamp` | — | — |
| `job_status` | `enum` | — | — |
| `records_fetched` | `int` | — | — |
| `records_inserted` | `int` | — | — |
| `records_skipped` | `int` | — | — |
| `records_failed` | `int` | — | — |
| `error_message` | `text` | — | — |
| `created_at` | `timestamp` | — | — |
### RAW_SOURCE_RECORDS (03 Raw Data)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | — |
| `ingestion_run_id` | `uuid` | `INGESTION_RUNS` | — |
| `record_source` | `enum` | — | — |
| `source_record_id` | `text` | — | — |
| `raw_payload` | `jsonb` | — | — |
| `received_at` | `timestamp` | — | — |
| `processing_status` | `enum` | — | — |
| `matched_organisation_id` | `uuid` | `ORGANISATIONS` | — |
| `checksum` | `text` | — | — |
| `source_last_modified` | `timestamp` | — | — |
| `ingestion_attempt` | `int` | — | — |
| `created_at` | `timestamp` | — | — |
| `source_country` | `text` | — | — |
| `source_registry_name` | `text` | — | — |
### DATA_QUALITY_EVENTS (03 Raw Data)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | — |
| `raw_source_record_id` | `uuid` | `RAW_SOURCE_RECORDS` | — |
| `rule_name` | `text` | — | — |
| `rule_category` | `enum` | — | — |
| `field_name` | `text` | — | — |
| `field_value` | `text` | `Yes` | — |
| `severity` | `enum` | — | — |
| `suggested_fix` | `text` | `Yes` | — |
| `auto_resolved` | `boolean` | — | — |
| `resolved` | `boolean` | — | — |
| `resolved_at` | `timestamp` | — | — |
| `resolved_by_user_id` | `uuid` | `USERS` | — |
| `rule_version` | `text` | — | — |
| `created_at` | `timestamp` | — | — |
### ENTITY_MATCH_CANDIDATES (03 Raw Data)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | — |
| `raw_source_record_id` | `uuid` | `RAW_SOURCE_RECORDS` | — |
| `candidate_organisation_id` | `uuid` | `ORGANISATIONS` | — |
| `match_score` | `float` | — | — |
| `match_method` | `enum` | — | — |
| `match_fields` | `jsonb` | — | — |
| `llm_reasoning` | `text` | `Yes` | — |
| `duplicate_group_id` | `uuid` | — | — |
| `source_priority` | `int` | — | — |
| `match_status` | `enum` | — | — |
| `reviewed_by_user_id` | `uuid` | `USERS` | — |
| `reviewed_at` | `timestamp` | — | — |
| `notes` | `text` | — | — |
| `created_at` | `timestamp` | — | — |
### MANUAL_ENTRY_RECORDS (03 Raw Data)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | — |
| `submitted_by_user_id` | `uuid` | `USERS` | — |
| `legal_name` | `text` | — | — |
| `country_code` | `text` | — | — |
| `website` | `text` | — | — |
| `contact_email` | `text` | — | — |
| `registry_name` | `text` | — | — |
| `registry_number` | `text` | — | — |
| `reason_for_manual_entry` | `text` | — | — |
| `converted_to_organisation_id` | `uuid` | `ORGANISATIONS` | — |
| `review_status` | `enum` | — | — |
| `reviewed_by_user_id` | `uuid` | `USERS` | — |
| `reviewed_at` | `timestamp` | — | — |
| `review_notes` | `text` | — | — |
| `created_at` | `timestamp` | — | — |
| `updated_at` | `timestamp` | — | — |
### ORGANISATIONS (04 Entities)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | — |
| `legal_name` | `text` | — | — |
| `trading_name` | `text` | — | — |
| `country_code` | `text` | — | — |
| `is_international` | `boolean` | — | — |
| `entry_method` | `enum` | — | — |
| `is_verified` | `boolean` | — | — |
| `organisation_type` | `enum` | — | — |
| `website` | `text` | — | — |
| `contact_email` | `text` | — | — |
| `address_line_1` | `text` | — | — |
| `city` | `text` | — | — |
| `postcode` | `text` | — | — |
| `geographic_reach` | `enum` | — | — |
| `outreach_status` | `enum` | — | — |
| `last_reply_sentiment` | `enum` | — | — |
| `last_reply_intent` | `enum` | — | — |
| `data_completeness_score` | `numeric` | — | — |
| `owner_id` | `uuid` | `USERS` | — |
| `created_at` | `timestamp` | — | — |
| `updated_at` | `timestamp` | — | — |
### ORGANISATION_IDENTIFIERS (04 Entities)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | — |
| `organisation_id` | `uuid` | — | ORGANISATIONS |
| `identifier_type` | `enum` | — | — |
| `identifier_value` | `text` | — | — |
| `registry_name` | `text` | — | — |
| `registry_country` | `text` | — | — |
| `is_primary` | `boolean` | — | — |
| `verified` | `boolean` | — | — |
| `verified_by_user_id` | `uuid` | — | USERS |
| `verified_at` | `timestamp` | — | — |
| `created_at` | `timestamp` | — | — |
### CONTACTS (04 Entities)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | — |
| `organisation_id` | `uuid` | `ORGANISATIONS` | — |
| `first_name` | `text` | — | — |
| `last_name` | `text` | — | — |
| `email` | `text` | — | — |
| `phone` | `text` | — | — |
| `job_title` | `text` | — | — |
| `is_primary` | `boolean` | — | — |
| `contact_source` | `enum` | — | — |
| `created_at` | `timestamp` | — | — |
| `updated_at` | `timestamp` | — | — |
### FINANCIAL_PERIODS (04 Entities)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | — |
| `organisation_id` | `uuid` | `ORGANISATIONS` | — |
| `period_start` | `date` | — | — |
| `period_end` | `date` | — | — |
| `total_income` | `numeric` | — | — |
| `total_expenditure` | `numeric` | — | — |
| `income_band` | `enum` | — | — |
| `filing_date` | `date` | — | — |
| `financial_source` | `enum` | — | — |
| `created_at` | `timestamp` | — | — |
### GRANTS (04 Entities)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | — |
| `organisation_id` | `uuid` | `ORGANISATIONS` | — |
| `grant_id` | `text` | — | — |
| `funder_name` | `text` | — | — |
| `amount_awarded` | `numeric` | — | — |
| `currency` | `text` | — | — |
| `award_date` | `date` | — | — |
| `grant_programme` | `text` | — | — |
| `description` | `text` | — | — |
| `created_at` | `timestamp` | — | — |
### ENRICHMENT_RESULTS (04 Entities)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | — |
| `organisation_id` | `uuid` | `ORGANISATIONS` | — |
| `mission_statement` | `text` | — | — |
| `mission_keywords` | `text[]` | — | — |
| `news_hooks` | `text[]` | — | — |
| `sector` | `text` | — | — |
| `sub_sector` | `text` | — | — |
| `website_url` | `text` | — | — |
| `email_validity_score` | `numeric` | — | — |
| `social_links` | `jsonb` | — | — |
| `confidence_score` | `numeric` | — | — |
| `needs_review` | `boolean` | — | — |
| `enriched_at` | `timestamp` | — | — |
| `created_at` | `timestamp` | — | — |
### USERS (04 Entities)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | — |
| `email` | `text` | — | — |
| `full_name` | `text` | — | — |
| `role` | `enum` | — | — |
| `is_active` | `boolean` | — | — |
| `invited_by_user_id` | `uuid` | `USERS` | — |
| `last_seen_at` | `timestamp` | — | — |
| `created_at` | `timestamp` | — | — |
| `updated_at` | `timestamp` | — | — |
### NOTES (04 Entities)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | — |
| `organisation_id` | `uuid` | `ORGANISATIONS` | — |
| `author_id` | `uuid` | `USERS` | — |
| `content` | `text` | — | — |
| `created_at` | `timestamp` | — | — |
| `updated_at` | `timestamp` | — | — |
### TAGS (04 Entities)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | — |
| `name` | `text` | — | — |
| `colour` | `text` | — | — |
| `created_by_user_id` | `uuid` | `USERS` | — |
| `created_at` | `timestamp` | — | — |
### ORG_TAGS (04 Entities)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | — |
| `organisation_id` | `uuid` | `ORGANISATIONS` | — |
| `tag_id` | `uuid` | `TAGS` | — |
| `added_by_user_id` | `uuid` | `USERS` | — |
| `created_at` | `timestamp` | — | — |
### SCORING_WEIGHTS (05 - Features)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `model_name` | — | feature_name |
| `1.0` | `SCOUT` | — | south_yorkshire_flag |
| `2.0` | `SCOUT` | — | mission_alignment_score |
| `3.0` | `SCOUT` | — | service_fit_score |
| `4.0` | `SCOUT` | — | never_contacted_flag |
| `5.0` | `SCOUT` | — | income_band |
| `6.0` | `SCOUT` | — | income_trend |
| `7.0` | `SCOUT` | — | days_since_last_contact |
| `8.0` | `SCOUT` | — | financial_stability_score |
| `9.0` | `SCOUT` | — | has_recent_grant_flag |
| `10.0` | `SCOUT` | — | digital_maturity_score |
| `11.0` | `SCOUT` | — | data_completeness_score |
| `12.0` | `SCOUT` | — | grant_count |
| `13.0` | `SCOUT` | — | has_partnership_history_flag |
| `14.0` | `COMPASS` | — | semester_fit_score |
| `15.0` | `COMPASS` | — | project_complexity_score |
| `16.0` | `COMPASS` | — | repeat_engagement_score |
| `17.0` | `COMPASS` | — | case_study_potential_score |
| `18.0` | `COMPASS` | — | portfolio_sector_score |
### FEATURE_DEFINITIONS (05 - Features)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `feature_name` | — | description |
| `1.0` | `south_yorkshire_flag` | — | Whether the organisation is based in South Yorkshire |
| `2.0` | `mission_alignment_score` | — | How well the organisation’s mission matches 180DC services |
| `3.0` | `service_fit_score` | — | Highest score across all 180DC service-fit categories |
| `4.0` | `income_band` | — | Bucketed organisation income level |
| `5.0` | `income_trend` | — | Year-over-year income direction |
| `6.0` | `never_contacted_flag` | — | Whether the organisation has never been sent an outreach email |
| `7.0` | `days_since_last_contact` | — | Number of days since the most recent outreach |
| `8.0` | `financial_stability_score` | — | Composite measure of overall financial health |
| `9.0` | `has_recent_grant_flag` | — | Whether the organisation received a grant during the previous 24 months |
| `10.0` | `digital_maturity_score` | — | How digitally developed the organisation is |
| `11.0` | `data_completeness_score` | — | Percentage of required organisation fields that are populated |
| `12.0` | `grant_count` | — | Total number of grants received |
| `13.0` | `has_partnership_history_flag` | — | Whether the organisation previously converted to a 180DC client |
| `14.0` | `semester_fit_score` | — | How well project timing aligns with the student semester |
| `15.0` | `project_complexity_score` | — | Whether the project has suitable complexity for a student team |
| `16.0` | `repeat_engagement_score` | — | Strength of the organisation’s prior relationship with 180DC |
| `17.0` | `case_study_potential_score` | — | Potential for the engagement to produce a publishable case study |
| `18.0` | `portfolio_sector_score` | — | How underrepresented the organisation’s sector is in the current portfolio |
| `19.0` | `performance_score` | — | How well an email performed based on its confirmed outcome |
| `20.0` | `used_as_example_count` | — | Number of times the email has been supplied to Gemini as a few-shot example |
### AGENT_PROMPTS (05 - Features)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `agent_name` | — | prompt_template |
| `1.0` | `SCOUT` | — | — |
| `2.0` | `COMPASS` | — | — |
| `3.0` | `VOICE` | — | You are writing a cold outreach email for 180 Degrees Consulting Sheffield, a student consultancy at the University of Sheffield working with social enterprises and non-profits. Organisation profile: {org_profile}. Service to pitch: {service}. Tone: {tone}. Here are {n} emails that successfully converted or received replies from similar organisations: {examples}. Write a new email following similar patterns. Return JSON: { subject, body, tone_used, hook_type } |
### EMAIL_PERFORMANCE_LIBRARY (05 - Features)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `outreach_message_id` | — | organisation_id |
| `—` | `links to OUTREACH_MESSAGES` | — | which org |
### AGENT_RUNS (06 - Predictions)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | Primary key |
| `organisation_id` | `uuid` | — | Organisation that was scored |
| `agent_name` | `enum` | — | SCOUT / VOICE / COMPASS / PULSE |
| `score_source` | `enum` | — | rule_engine / llm / ml_model |
| `triggered_by` | `enum` | — | manual / scheduled / api |
| `triggered_by_user_id` | `uuid` | — | CAM or user who triggered the run; null when scheduled |
| `input_snapshot` | `jsonb` | — | Exact organisation and feature data supplied to the scoring system at that moment |
| `output` | `jsonb` | — | Complete model output, including scores, reasoning, and recommendations |
| `model_version_id` | `uuid` | — | Links to the MODEL_VERSIONS record used for this run |
| `tokens_used` | `integer` | — | Number of LLM tokens used; null for rule-engine runs |
| `latency_ms` | `integer` | — | Total time taken to complete the scoring call in milliseconds |
| `created_at` | `timestamp` | — | Row creation timestamp |
### LATEST_SCORES (06 - Predictions)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | Primary key |
| `organisation_id` | `uuid` | — | Unique organisation identifier; one row per organisation |
| `priority_score` | `float` | — | Latest SCOUT priority score from 0.0 to 1.0 |
| `priority_band` | `enum` | — | high / medium / low |
| `fit_reason` | `text` | — | Plain-English explanation of the organisation’s score |
| `recommended_service` | `text` | — | 180DC service recommended as the primary outreach offer |
| `partnership_value_score` | `float` | — | Latest COMPASS partnership-value score from 0.0 to 1.0 |
| `partnership_band` | `enum` | — | high / medium / low |
| `estimated_project_type` | `text` | — | Type of consulting project the organisation is most likely to need |
| `semester_fit_score` | `float` | — | How well the potential project timing aligns with the student semester |
| `sector_growth_score` | `float` | — | Latest PULSE sector-momentum score |
| `score_source` | `enum` | — | rule_engine / llm / ml_model |
| `scout_run_id` | `uuid` | — | Links to the AGENT_RUNS row that produced the latest SCOUT score |
| `compass_run_id` | `uuid` | — | Links to the AGENT_RUNS row that produced the latest COMPASS score |
| `scored_at` | `timestamp` | — | Date and time the organisation was last scored |
| `updated_at` | `timestamp` | — | Date and time this latest-score record was last updated |
### MODEL_VERSIONS (06 - Predictions)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | Primary key |
| `model_name` | `enum` | — | SCOUT / VOICE / COMPASS / PULSE |
| `version` | `string` | — | Model version identifier, such as v1, v2, or v3 |
| `implementation_type` | `enum` | — | rules / llm / ml_model |
| `config` | `jsonb` | — | Weights snapshot for rules, prompt identifier and settings for LLMs, or model path and configuration for trained ML models |
| `is_active` | `boolean` | — | Whether this is the active version; only one version should be active per model at a time |
| `notes` | `text` | — | Description of what changed and why the new version was created |
| `created_by_user_id` | `uuid` | — | User who created or activated this model version |
| `created_at` | `timestamp` | — | Row creation timestamp |
| `deprecated_at` | `timestamp` | — | Date and time the version was replaced or retired; null while active |
### OUTREACH_MESSAGES (07 Outreach & Outcomes)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | Primary key |
| `organisation_id` | `uuid` | — | Organisation that received the outreach message |
| `contact_id` | `uuid` | — | Specific contact the message was sent to |
| `sent_by_user_id` | `uuid` | — | CAM or user who sent the message |
| `subject` | `text` | — | Final email subject line exactly as sent |
| `body` | `text` | — | Final email body exactly as sent |
| `send_status` | `enum` | — | draft / scheduled / sent / failed |
| `scheduled_at` | `timestamp` | — | Date and time the message was scheduled for sending; null if not scheduled |
| `sent_at` | `timestamp` | — | Date and time Gmail successfully sent the message; null until sent |
| `agent_run_id` | `uuid` | — | Links to the VOICE AGENT_RUNS record that generated the draft |
| `created_at` | `timestamp` | — | Row creation timestamp |
| `updated_at` | `timestamp` | — | Date and time the record was last updated |
### AI_GENERATIONS (07 Outreach & Outcomes)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | Primary key |
| `outreach_message_id` | `uuid` | — | Links to the associated OUTREACH_MESSAGES record |
| `generated_subject` | `text` | — | Original subject line generated by Gemini before CAM edits |
| `generated_body` | `text` | — | Original email body generated by Gemini before CAM edits |
| `cam_edited` | `boolean` | — | Whether the CAM changed the generated subject or body |
| `edit_distance` | `integer` | — | Number of characters changed between the generated draft and the final message; used as a proxy for how much editing was required |
| `created_at` | `timestamp` | — | Row creation timestamp |
### SEND_EVENTS (07 Outreach & Outcomes)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | Primary key |
| `outreach_message_id` | `uuid` | — | Links to the OUTREACH_MESSAGES record associated with the email |
| `event_type` | `enum` | — | sent / delivered / bounced / opened |
| `occurred_at` | `timestamp` | — | Date and time Gmail reported the delivery event |
| `metadata` | `jsonb` | — | Additional event information returned by the Gmail API |
| `created_at` | `timestamp` | — | Row creation timestamp |
### REPLY_EVENTS (07 Outreach & Outcomes)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | Primary key |
| `outreach_message_id` | `uuid` | — | Links to the OUTREACH_MESSAGES record this message replies to |
| `organisation_id` | `uuid` | — | Organisation that sent the reply |
| `contact_id` | `uuid` | — | Specific contact who sent the reply |
| `reply_body` | `text` | — | Full text of the received reply |
| `sentiment` | `enum` | — | positive / neutral / negative |
| `intent` | `enum` | — | interested / not_interested / more_info / referral |
| `received_at` | `timestamp` | — | Date and time the reply arrived in Gmail |
| `processed_at` | `timestamp` | — | Date and time sentiment and intent analysis was completed |
| `created_at` | `timestamp` | — | Row creation timestamp |
### OUTCOMES (07 Outreach & Outcomes)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | Primary key |
| `organisation_id` | `uuid` | — | Links to the ORGANISATIONS record associated with the outcome |
| `outreach_message_id` | `uuid` | — | Links to the OUTREACH_MESSAGES record that led to this outcome |
| `outcome_type` | `enum` | — | converted / no_response / rejected / follow_up / referral |
| `notes` | `text` | — | CAM notes describing what happened and any relevant context |
| `recorded_by_user_id` | `uuid` | — | Links to the USERS record for the CAM who logged the outcome |
| `created_at` | `timestamp` | — | Row creation timestamp |
### API_HEALTH_LOGS (08 System Analytics)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | Primary key |
| `api_name` | `enum` | — | API called: charitybase / companies_house / find_that_charity / three_sixty_giving / gmail / gemini |
| `called_at` | `timestamp` | — | Date and time of the API call |
| `response_status` | `int` | — | HTTP status code returned |
| `latency_ms` | `int` | — | Time taken for the call in milliseconds |
| `error_message` | `text` | — | Error detail when the call failed; null on success |
| `created_at` | `timestamp` | — | Row creation timestamp |
### INGESTION_SUMMARY (08 System Analytics)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | Primary key |
| `date` | `date` | — | Day the rollup covers |
| `source` | `enum` | — | Data source the rollup covers |
| `orgs_added` | `int` | — | New organisations created that day |
| `orgs_updated` | `int` | — | Existing organisations updated that day |
| `orgs_failed` | `int` | — | Records that failed validation that day |
| `created_at` | `timestamp` | — | Row creation timestamp |
### COST_TRACKING (08 System Analytics)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | Primary key |
| `date` | `date` | — | Day the spend was incurred |
| `service` | `enum` | — | Paid service: gemini / gmail / other |
| `tokens_used` | `int` | — | LLM tokens consumed; null for non-LLM services |
| `cost_usd` | `numeric` | — | Cost in USD |
| `created_at` | `timestamp` | — | Row creation timestamp |
### ERROR_LOG (08 System Analytics)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | Primary key |
| `component` | `text` | — | System component that raised the error (ingestion, scoring, email, sync, ui) |
| `error_type` | `text` | — | Class or category of the error |
| `message` | `text` | — | Human-readable error message |
| `stack_trace` | `text` | — | Full stack trace for debugging |
| `resolved_at` | `timestamp` | — | When the error was marked resolved; null while open |
| `created_at` | `timestamp` | — | Row creation timestamp |
### CAM_ACTIVITY_SUMMARY (09 CAM Analytics)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | Primary key |
| `user_id` | `uuid` | — | Links to USERS; the CAM the week covers |
| `week_start` | `date` | — | Monday of the week the rollup covers |
| `orgs_scored` | `int` | — | Organisations reviewed from the queue that week |
| `emails_sent` | `int` | — | Outreach emails sent that week |
| `replies_received` | `int` | — | Replies received that week |
| `conversions` | `int` | — | Outcomes logged as converted that week |
| `created_at` | `timestamp` | — | Row creation timestamp |
### PIPELINE_METRICS (09 CAM Analytics)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | Primary key |
| `date` | `date` | — | Day the snapshot covers |
| `orgs_in_database` | `int` | — | Total canonical organisations |
| `orgs_contacted` | `int` | — | Organisations with at least one sent email |
| `orgs_replied` | `int` | — | Organisations that have replied |
| `orgs_converted` | `int` | — | Organisations with a converted outcome |
| `conversion_rate` | `float` | — | orgs_converted / orgs_contacted |
| `created_at` | `timestamp` | — | Row creation timestamp |
### SECTOR_PERFORMANCE (09 CAM Analytics)
| Field | Type | Foreign key | Description |
|---|---|---|---|
| `id` | `uuid` | — | Primary key |
| `sector` | `text` | — | Sector the row covers |
| `orgs_contacted` | `int` | — | Organisations contacted in this sector |
| `reply_rate` | `float` | — | Replies received / emails sent |
| `conversion_rate` | `float` | — | Converted / contacted |
| `avg_priority_score` | `float` | — | Mean SCOUT priority score across the sector |
| `updated_at` | `timestamp` | — | Last recalculation timestamp |
## Appendix C — Requirement Traceability Rules
Every implementation issue or pull request must reference:

- the backlog feature ID;
- the relevant PRD section(s);
- affected tables and migration files;
- external integrations used;
- acceptance criteria and test evidence;
- security, permission, suppression, and error-handling impacts;
- any approved deviation or open decision.

A requirement is considered traceable when a reviewer can move from feature ID → PRD behaviour → schema/API change → tests → demo evidence.
## Appendix D — Glossary
| Term | Definition |
|---|---|
| CAM | Client Acquisition Manager |
| Canonical record | The trusted master record used by operational workflows |
| Client Booklet | AI-assisted, source-labelled organisation summary used for research and drafting |
| SCOUT | Priority scoring function; weighted rule engine in V1 |
| COMPASS | Partnership value/suitability recommendation function |
| VOICE | AI email-draft generation function |
| PULSE | Scheduled sector-trend signal derived from aggregated data |
| RLS | Row-level security enforced by the database |
| Suppression | Backend-enforced block preventing outreach to an organisation/contact |
| Frozen snapshot | Copy of input features/context stored at the time of a decision or outreach |
| Agent run | Auditable record of a scoring or generation execution |
| P1 | Required; platform cannot work acceptably without it |
| P2 | Required for MVP; important though core can technically operate without it |
| P3 | In MVP scope if time remains after P1/P2 |
## Appendix E — Change Log
| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0 | 14 July 2026 | Initial consolidated PRD generated from the Technical Brief, SOP, Gantt, Backlog, Data Model, and approved clarifications | Project Leader pending final sign-off |
