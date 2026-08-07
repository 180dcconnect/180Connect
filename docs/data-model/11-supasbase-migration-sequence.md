<!--
  GENERATED FILE — DO NOT EDIT.
  Source: ~/Downloads/Data Model.xlsx (the Data Model spreadsheet is the source of truth, per SOP §7).
  To change anything here: edit the spreadsheet, then run `npm run export:data-model`.
-->

# 11 Supasbase Migration Sequence

## 11 Supabase Migration Sequence: run in this order; every step is one migration file in /supabase/migrations

| Step | Migration name | Tables / objects created | Depends on | Notes |
| :--- | :--- | :--- | :--- | :--- |
| 1.0 | enable_extensions | uuid-ossp / pgcrypto (pgvector deferred to scoring Stage 2) | - | Extensions before any table |
| 2.0 | create_users | USERS | Supabase Auth | Mirror of auth.users with role + is_active; RLS on |
| 3.0 | create_organisations | ORGANISATIONS | USERS (owner_id) | Core entity table |
| 4.0 | create_org_children | ORGANISATION_IDENTIFIERS, CONTACTS, FINANCIAL_PERIODS, GRANTS, ENRICHMENT_RESULTS, NOTES | ORGANISATIONS, USERS | All FK to ORGANISATIONS |
| 5.0 | create_tags | TAGS, ORG_TAGS | ORGANISATIONS, USERS | Bridge table ORG_TAGS |
| 6.0 | create_ingestion | INGESTION_RUNS, RAW_SOURCE_RECORDS | USERS, ORGANISATIONS | RAW_SOURCE_RECORDS FK to INGESTION_RUNS;  the two source columns use the public.data_source_name domain, not per-table check<br>  constraints. Also record that it landed as 20260728153131_create_raw_data_layer.sql, since the sequence calls it create_ingestion. |
| 7.0 | create_quality | DATA_QUALITY_EVENTS, ENTITY_MATCH_CANDIDATES, MANUAL_ENTRY_RECORDS | RAW_SOURCE_RECORDS, ORGANISATIONS, USERS | Raw-data checks and the manual entry track |
| 8.0 | create_model_config | MODEL_VERSIONS, SCORING_WEIGHTS, FEATURE_DEFINITIONS, AGENT_PROMPTS | USERS | Intelligence configuration (tab 05) |
| 9.0 | create_predictions | AGENT_RUNS, LATEST_SCORES | ORGANISATIONS, MODEL_VERSIONS, USERS | LATEST_SCORES FK to AGENT_RUNS |
| 10.0 | create_email_library | EMAIL_PERFORMANCE_LIBRARY | OUTREACH_MESSAGES (nullable until step 11) | Or create after step 11 if the FK is NOT NULL |
| 11.0 | create_outreach | OUTREACH_MESSAGES, AI_GENERATIONS | ORGANISATIONS, CONTACTS, USERS, AGENT_RUNS | Draft and send records |
| 12.0 | create_outreach_events | SEND_EVENTS, REPLY_EVENTS, OUTCOMES | OUTREACH_MESSAGES, ORGANISATIONS, CONTACTS, USERS | Delivery, replies, ground truth |
| 13.0 | create_analytics | API_HEALTH_LOGS, INGESTION_SUMMARY, COST_TRACKING, ERROR_LOG, CAM_ACTIVITY_SUMMARY, PIPELINE_METRICS, SECTOR_PERFORMANCE, AUDIT_LOG | USERS | Tabs 08-09 |
| 14.0 | create_pulse_view | sector_trends (SQL view) | ORGANISATIONS, GRANTS, FINANCIAL_PERIODS | PULSE is a view, not a table |
| 15.0 | enable_rls_policies | RLS policies on every table | All tables | Per the Security Controls Register (tab 12) |
| 16.0 | create_indexes | Indexes: FKs, LATEST_SCORES.priority_score, ORGANISATIONS.outreach_status, RAW_SOURCE_RECORDS.checksum | All tables | Query performance for the dashboard |
| 17.0 | configure_backups | Daily backups + point-in-time recovery | - | Supabase |
| 18.0 | create_login_attempt | LOGIN_ATTEMPT + RPCs login_throttle_state, record_login_failure, clear_login_failures, prune_login_attempts | pgcrypto (Step 1) | F003 brute-force throttle. No FK. RPCs granted to service_role only; RLS on, admin SELECT, no write policy |
| 19.0 | create_actions | ACTIONS + enum action_status | ORGANISATIONS, USERS | F168/F257 client actions and reminders. RLS on; assignee_user_id carries no UPDATE grant — it is changed only by the F257 reassignment RPC, which writes audit_log. Reminder is a column (remind_at), not a table. |
| 20.0 | create_user_onboarding | USER_ONBOARDING_STEPS | USERS | F255 first-run guide state. One row per (user, step) completed. RLS on; own-row SELECT/INSERT for active users; no admin read (not needed yet), no UPDATE/DELETE grant — a step is inserted once on completion, never edited. |
| 21.0 | create_outreach_preferences | OUTREACH_PREFERENCES | USERS | F195 (#191). One row per CAM, upserted. Read by F094 (#93, not yet built) to personalise the queue — does not itself score or reorder. RLS on; own-row SELECT/INSERT/UPDATE for active users; no DELETE grant (clearing preferences is an UPDATE to empty arrays, not a row removal); no admin read. |
| 21.1 | create_suppressions | SUPPRESSIONS | ORGANISATIONS, USERS, AUDIT_LOG | F251 (#82). A CAM requests suppression (reason required) or an admin suppresses directly (self-approved, skips pending); a separate admin-only RPC approves or rejects a pending request. RPCs: request_suppression, decide_suppression_request — both write AUDIT_LOG in the same transaction. Extends app.can_contact_organisation() so an active suppression blocks outreach for every role, admin included. status includes 'lifted', reserved for F185 (#181) — not built by this migration. Not the contact-level email/phone-hash GDPR suppression list from the data lifecycle policy (§7) — that stays a separate, not-yet-built concern. |
