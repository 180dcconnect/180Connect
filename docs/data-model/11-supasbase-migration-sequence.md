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
| 21.4 | create_ownership_requests | OWNERSHIP_REQUESTS |  |  |
| 22.0 | enable_cron_extensions | pg_cron, pg_net | - | Weekly Companies House discovery + status watch. First use of pg_cron in this project. |
| 22.1 | add_companies_house_status_check_cursor | RAW_SOURCE_RECORDS.status_last_checked_at | RAW_SOURCE_RECORDS | Batch-ordering cursor for the status-recheck job. |
| 22.2 | create_organisation_status_flags | ORGANISATION_STATUS_FLAGS | ORGANISATIONS, USERS, AUDIT_LOG | RPCs record_organisation_status_flag (service_role only) and acknowledge_organisation_status_flag (admin). Never writes outreach_status. |
| 22.3 | create_resolve_data_quality_event_rpc | (RPC only, no new table) | DATA_QUALITY_EVENTS, AUDIT_LOG | Activates the resolved/resolved_at/resolved_by_user_id columns DATA_QUALITY_EVENTS has had since step 7.0 but never had a write path for. |
| 22.4 | schedule_companies_house_cron | pg_cron jobs: companies_house_discovery_weekly, companies_house_status_recheck_weekly | 22.0, 22.2 | Calls src/app/api/cron/companies-house-import and -status-recheck via net.http_post. Needs vault.create_secret for companies_house_cron_base_url and cron_secret, once per environment. |
| 22.5 | add_vercel_bypass_to_companies_house_cron | (re-schedules the two 22.4 jobs) | 22.4 | Fix-forward: this Vercel project SSO-protects every non-custom-domain deployment, which blocked the jobs outright. Adds vault secret vercel_protection_bypass, appended as a query param. |
| 22.6 | create_saved_views | SAVED_VIEWS | USERS | F066 (#68). A CAM saves the active client-list filter combination under a name and re-applies or deletes it. Filters stored as jsonb keyed to the /clients search params (arrays for the multi-selects), so a new filter needs no schema change. RLS on; own-row SELECT/INSERT/UPDATE/DELETE for active users, no admin read. No AUDIT_LOG write: it changes no ownership, status, role or approval state. |
| 22.7 | create_data_handling_rules | DATA_HANDLING_RULES, DATA_HANDLING_RULE_VERSIONS, RAW_SOURCE_RECORDS (excluded_fields, rule_version_applied) | 22.6 | Schema update for data handling rules. Also includes two read RPCs for the admin panel. |
| 22.8 | seed_data_handling_rules | DATA_HANDLING_RULES (seed data) | 22.7 | Seed the 16 opening rules. |
| 22.9 | add_preferred_cities_to_outreach_preferences | OUTREACH_PREFERENCES.preferred_cities | 21.0 | F196 (#192), timestamp 20260822131000 |
| 22.10 | add_grant_preference_to_outreach_preferences | OUTREACH_PREFERENCES.prioritise_grant_recipients | 21.0 | F199 (#346), timestamp 20260822140000 |
| 23.0 | create_notifications | NOTIFICATIONS | USERS |  |
| 24.5 | decide_edit_suggestion_dynamic_apply_back | (RPC rewrite, no new table) | EDIT_SUGGESTIONS, ORGANISATIONS | F020 (#23). Rewrites decide_edit_suggestion's apply-back as guarded dynamic SQL (%I identifier FK-validated against RESTRICTED_EDIT_FIELDS + information_schema existence check) so admin-added restricted fields are applied on approval, not silently dropped; also casts the status literals to the enum explicitly — the untyped case expression resolved as text under some planning paths (42804) despite passing the warmed pgTAP suite. |
| 24.4 | restrict_organisation_sensitive_columns | (trigger + function on ORGANISATIONS, no new table) | ORGANISATIONS, RESTRICTED_EDIT_FIELDS | F020 (#23). BEFORE UPDATE column-guard trigger enforce_restricted_org_columns: a non-admin write changing any active restricted column raises 42501 pointing at the suggestion flow — closes §3.2's owned-row direct-write gap (AC1). Skips unauthenticated sessions (background jobs); admins pass untouched. AC2 intact: non-restricted columns stay CAM-editable. |
| 24.3 | create_restricted_edit_fields | RESTRICTED_EDIT_FIELDS (+ seed of six) | ORGANISATIONS (columns), USERS, EDIT_SUGGESTIONS | F020 (#23 AC4). The sensitive-field allowlist becomes data: field_name unique, active soft-disable flag (never delete — FK target), reason, added_by. Seeded with the signed-off six. Admin-only audited RPCs add_restricted_edit_field / deactivate_restricted_edit_field; RLS: admins all rows, CAMs active rows, viewers none. edit_suggestions.field_name CHECK swapped for an FK; suggest_organisation_edit rewritten to validate against the table and snapshot values via jsonb extraction. |
| 24.2 | create_decide_edit_suggestion_rpc | (RPC only, no new table) | EDIT_SUGGESTIONS, ORGANISATIONS, AUDIT_LOG | F078/F079 (#80/#81). Admin-only decide_edit_suggestion: approval re-checks the live value still matches current_value (refuses on drift), applies proposed_value via six-column case UPDATE; rejection records the optional reason and changes nothing. Both branches settle the row and write one audit_log row in-transaction. Tabs 02/04 unchanged. |
| 24.1 | create_edit_suggestions | EDIT_SUGGESTIONS | ORGANISATIONS, USERS | F077 (#79). A CAM proposes a correction to one of six sensitive ORGANISATIONS fields; nothing reaches the client until an admin approves (F078/F079). RPC suggest_organisation_edit snapshots current_value server-side, supersedes the caller's own pending proposal, blocks while another CAM's is pending. No AUDIT_LOG write on submission — flagging is not a decision; the decide RPCs audit. RLS: admin sees all, CAMs see pending rows + own history, viewers see nothing. Same six-field allowlist as FIELD_DISCREPANCIES/FIELD_SOURCES. |
