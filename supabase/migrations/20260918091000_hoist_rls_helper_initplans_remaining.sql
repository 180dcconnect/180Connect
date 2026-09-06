-- Migration: hoist_rls_helper_initplans_remaining
-- Sequence: no schema change — the same policy-expression rewrite as
--   20260918090000_hoist_rls_helper_initplans.sql, applied to the other 40 tables.
-- Story: performance — intermittent slow page loads.
--
-- WHAT THIS DOES
--
-- Wraps every zero-argument `app.*` helper call, and every bare `auth.uid()`,
-- in `(select ...)` across the 82 remaining policies. Nothing else changes: the
-- same helpers, the same operators, the same order, the same role, the same
-- `with check` clauses. Access is byte-for-byte identical.
--
-- WHY
--
-- The full reasoning and the measurements are in the migration this follows
-- (20260918090000). In short: these helpers are `STABLE SECURITY DEFINER`,
-- Postgres cannot inline a SECURITY DEFINER function, and so inside a policy's
-- security qualifier a bare call is invoked once per row rather than once per
-- statement. On the seven tables `/clients` reads, hoisting took the client-list
-- query from 629ms to 39ms. These 40 tables share the defect; they simply carry
-- less traffic, which is why they are a second migration rather than the same one.
--
-- Every list-shaped read in the app pays this: the inbox, the audit log, the
-- admin queues, notifications, saved views.
--
-- HOW THIS FILE WAS WRITTEN
--
-- Generated from `pg_policies` on staging rather than typed by hand — the
-- `create policy` statements are Postgres's own deparsed expressions with only
-- the helper calls rewritten. Eighty-two policies transcribed by hand is eighty-two
-- chances to quietly widen a permission.
--
-- WHAT IS DELIBERATELY NOT WRAPPED
--
-- The argument-taking helpers — `app.owns_organisation(organisation_id)`,
-- `app.organisation_is_unowned(...)`, `app.can_contact_organisation(...)` — are
-- genuinely row-correlated and are left exactly as they were. Column comparisons
-- such as `author_id = (select auth.uid())` keep their per-row half; only
-- `auth.uid()` is hoisted out of them.
--
-- Policies are dropped and recreated. The Supabase CLI applies each migration in
-- a single transaction, so no table is ever readable without its policy and
-- `scripts/verify-rls-coverage.sql` never sees an intermediate state.
--
-- The guard against this regressing is `tests.suite_rls_initplan` in
-- `supabase/tests/rls_policies.test.sql`; extend its table list if a new table
-- needs covering.

-- ── actions ─────────────────────────────────────────────────────────────

drop policy actions_delete_admin on public.actions;
create policy actions_delete_admin on public.actions
  for delete to authenticated
  using (((select app.is_active_user()) AND (select app.is_admin())));

drop policy actions_delete_own_open on public.actions;
create policy actions_delete_own_open on public.actions
  for delete to authenticated
  using (((select app.is_active_user()) AND (select app.is_cam()) AND COALESCE((created_by_user_id = (select auth.uid())), false) AND COALESCE((assignee_user_id = (select auth.uid())), false) AND (status = 'open'::action_status)));

drop policy actions_insert_admin on public.actions;
create policy actions_insert_admin on public.actions
  for insert to authenticated
  with check (((select app.is_active_user()) AND (select app.is_admin())));

drop policy actions_insert_cam on public.actions;
create policy actions_insert_cam on public.actions
  for insert to authenticated
  with check (((select app.is_active_user()) AND (select app.is_cam()) AND (created_by_user_id = (select auth.uid())) AND (assignee_user_id = (select auth.uid())) AND (app.owns_organisation(organisation_id) OR app.organisation_is_unowned(organisation_id))));

drop policy actions_select_active on public.actions;
create policy actions_select_active on public.actions
  for select to authenticated
  using ((select app.is_active_user()));

drop policy actions_update_admin on public.actions;
create policy actions_update_admin on public.actions
  for update to authenticated
  using (((select app.is_active_user()) AND (select app.is_admin())))
  with check (((select app.is_active_user()) AND (select app.is_admin())));

drop policy actions_update_assignee on public.actions;
create policy actions_update_assignee on public.actions
  for update to authenticated
  using (((select app.is_active_user()) AND (select app.is_cam()) AND COALESCE((assignee_user_id = (select auth.uid())), false)))
  with check (((select app.is_active_user()) AND (select app.is_cam()) AND COALESCE((assignee_user_id = (select auth.uid())), false)));

-- ── ai_generation_rate_limit ────────────────────────────────────────────

drop policy ai_generation_rate_limit_select_admin on public.ai_generation_rate_limit;
create policy ai_generation_rate_limit_select_admin on public.ai_generation_rate_limit
  for select to authenticated
  using (((select app.is_active_user()) AND (select app.is_admin())));

-- ── ai_generations ──────────────────────────────────────────────────────

drop policy ai_generations_delete_admin on public.ai_generations;
create policy ai_generations_delete_admin on public.ai_generations
  for delete to authenticated
  using (((select app.is_active_user()) AND (select app.is_admin())));

drop policy ai_generations_select_active on public.ai_generations;
create policy ai_generations_select_active on public.ai_generations
  for select to authenticated
  using ((select app.is_active_user()));

-- ── attachments ─────────────────────────────────────────────────────────

drop policy attachments_select_active on public.attachments;
create policy attachments_select_active on public.attachments
  for select to authenticated
  using ((select app.is_active_user()));

-- ── audit_log ───────────────────────────────────────────────────────────

drop policy audit_log_select_admin on public.audit_log;
create policy audit_log_select_admin on public.audit_log
  for select to authenticated
  using ((select app.is_admin()));

drop policy audit_log_select_client_timeline on public.audit_log;
create policy audit_log_select_client_timeline on public.audit_log
  for select to authenticated
  using (((select app.is_active_user()) AND (target_table = 'organisations'::text) AND (action = ANY (ARRAY['status_changed'::text, 'ownership_reassigned'::text]))));

-- ── booklet_generations ─────────────────────────────────────────────────

drop policy booklet_generations_insert on public.booklet_generations;
create policy booklet_generations_insert on public.booklet_generations
  for insert to authenticated
  with check (((select app.is_active_user()) AND app.can_contact_organisation(organisation_id) AND (generated_by = (select auth.uid()))));

drop policy booklet_generations_select on public.booklet_generations;
create policy booklet_generations_select on public.booklet_generations
  for select to authenticated
  using (((select app.is_active_user()) AND app.can_contact_organisation(organisation_id)));

-- ── client_booklets ─────────────────────────────────────────────────────

drop policy client_booklets_delete_admin on public.client_booklets;
create policy client_booklets_delete_admin on public.client_booklets
  for delete to authenticated
  using (((select app.is_active_user()) AND (select app.is_admin())));

drop policy client_booklets_insert_can_contact on public.client_booklets;
create policy client_booklets_insert_can_contact on public.client_booklets
  for insert to authenticated
  with check (((select app.is_active_user()) AND app.can_contact_organisation(organisation_id)));

drop policy client_booklets_select_active on public.client_booklets;
create policy client_booklets_select_active on public.client_booklets
  for select to authenticated
  using ((select app.is_active_user()));

-- ── contacts ────────────────────────────────────────────────────────────

drop policy contacts_delete_admin on public.contacts;
create policy contacts_delete_admin on public.contacts
  for delete to authenticated
  using (((select app.is_active_user()) AND (select app.is_admin())));

drop policy contacts_select_active on public.contacts;
create policy contacts_select_active on public.contacts
  for select to authenticated
  using ((select app.is_active_user()));

drop policy contacts_update_can_write on public.contacts;
create policy contacts_update_can_write on public.contacts
  for update to authenticated
  using (((select app.is_active_user()) AND (select app.can_write())))
  with check (((select app.is_active_user()) AND (select app.can_write())));

drop policy contacts_write_can_write on public.contacts;
create policy contacts_write_can_write on public.contacts
  for insert to authenticated
  with check (((select app.is_active_user()) AND (select app.can_write())));

-- ── data_handling_rule_versions ─────────────────────────────────────────

drop policy rule_versions_select on public.data_handling_rule_versions;
create policy rule_versions_select on public.data_handling_rule_versions
  for select to authenticated
  using (((select app.is_admin()) AND (select app.is_active_user())));

-- ── data_handling_rules ─────────────────────────────────────────────────

drop policy data_handling_rules_select on public.data_handling_rules;
create policy data_handling_rules_select on public.data_handling_rules
  for select to authenticated
  using (((select app.is_admin()) AND (select app.is_active_user())));

-- ── data_quality_events ─────────────────────────────────────────────────

drop policy data_quality_events_select_admin on public.data_quality_events;
create policy data_quality_events_select_admin on public.data_quality_events
  for select to authenticated
  using ((select app.is_admin()));

-- ── edit_suggestions ────────────────────────────────────────────────────

drop policy edit_suggestions_select_visible on public.edit_suggestions;
create policy edit_suggestions_select_visible on public.edit_suggestions
  for select to authenticated
  using (((select app.is_active_user()) AND ((select app.is_admin()) OR (requested_by = (select auth.uid())) OR ((status = 'pending'::edit_suggestion_status) AND (select app.is_cam())))));

-- ── enrichment_results ──────────────────────────────────────────────────

drop policy enrichment_results_delete_admin on public.enrichment_results;
create policy enrichment_results_delete_admin on public.enrichment_results
  for delete to authenticated
  using (((select app.is_active_user()) AND (select app.is_admin())));

drop policy enrichment_results_select_active on public.enrichment_results;
create policy enrichment_results_select_active on public.enrichment_results
  for select to authenticated
  using ((select app.is_active_user()));

-- ── entity_match_candidates ─────────────────────────────────────────────

drop policy entity_match_candidates_select_admin on public.entity_match_candidates;
create policy entity_match_candidates_select_admin on public.entity_match_candidates
  for select to authenticated
  using (((select app.is_admin()) AND (select app.is_active_user())));

-- ── feedback ────────────────────────────────────────────────────────────

drop policy feedback_insert on public.feedback;
create policy feedback_insert on public.feedback
  for insert to authenticated
  with check (((select app.is_active_user()) AND (user_id = (select auth.uid()))));

drop policy feedback_select_admin on public.feedback;
create policy feedback_select_admin on public.feedback
  for select to authenticated
  using (((select app.is_active_user()) AND (select app.is_admin())));

drop policy feedback_select_own on public.feedback;
create policy feedback_select_own on public.feedback
  for select to authenticated
  using (((select app.is_active_user()) AND (user_id = (select auth.uid()))));

-- ── field_discrepancies ─────────────────────────────────────────────────

drop policy field_discrepancies_select_admin on public.field_discrepancies;
create policy field_discrepancies_select_admin on public.field_discrepancies
  for select to authenticated
  using (((select app.is_admin()) AND (select app.is_active_user())));

-- ── field_sources ───────────────────────────────────────────────────────

drop policy field_sources_select on public.field_sources;
create policy field_sources_select on public.field_sources
  for select to authenticated
  using ((select app.is_active_user()));

-- ── ingestion_runs ──────────────────────────────────────────────────────

drop policy ingestion_runs_insert on public.ingestion_runs;
create policy ingestion_runs_insert on public.ingestion_runs
  for insert to authenticated
  with check (((select app.is_admin()) AND (select app.is_active_user())));

drop policy ingestion_runs_select on public.ingestion_runs;
create policy ingestion_runs_select on public.ingestion_runs
  for select to authenticated
  using (((select app.is_admin()) AND (select app.is_active_user())));

-- ── login_attempt ───────────────────────────────────────────────────────

drop policy login_attempt_select_admin on public.login_attempt;
create policy login_attempt_select_admin on public.login_attempt
  for select to authenticated
  using ((select app.is_admin()));

-- ── manual_entry_records ────────────────────────────────────────────────

drop policy manual_entry_records_select_own_or_admin on public.manual_entry_records;
create policy manual_entry_records_select_own_or_admin on public.manual_entry_records
  for select to authenticated
  using (((select app.is_active_user()) AND ((submitted_by_user_id = (select auth.uid())) OR (select app.is_admin()))));

-- ── model_pricing ───────────────────────────────────────────────────────

drop policy model_pricing_select_active on public.model_pricing;
create policy model_pricing_select_active on public.model_pricing
  for select to authenticated
  using ((select app.is_active_user()));

-- ── model_versions ──────────────────────────────────────────────────────

drop policy model_versions_select_admin on public.model_versions;
create policy model_versions_select_admin on public.model_versions
  for select to authenticated
  using (((select app.is_active_user()) AND (select app.is_admin())));

-- ── notes ───────────────────────────────────────────────────────────────

drop policy notes_delete_own on public.notes;
create policy notes_delete_own on public.notes
  for delete to authenticated
  using (((select app.is_active_user()) AND ((select app.is_admin()) OR COALESCE((author_id = (select auth.uid())), false))));

drop policy notes_insert_author on public.notes;
create policy notes_insert_author on public.notes
  for insert to authenticated
  with check (((select app.is_active_user()) AND (select app.can_write()) AND (author_id = (select auth.uid()))));

drop policy notes_select_active on public.notes;
create policy notes_select_active on public.notes
  for select to authenticated
  using ((select app.is_active_user()));

drop policy notes_update_own on public.notes;
create policy notes_update_own on public.notes
  for update to authenticated
  using (((select app.is_active_user()) AND ((select app.is_admin()) OR COALESCE((author_id = (select auth.uid())), false))))
  with check (((select app.is_active_user()) AND ((select app.is_admin()) OR COALESCE((author_id = (select auth.uid())), false))));

-- ── notifications ───────────────────────────────────────────────────────

drop policy notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (((select app.is_active_user()) AND (recipient_user_id = (select auth.uid()))));

drop policy notifications_update_own_read_state on public.notifications;
create policy notifications_update_own_read_state on public.notifications
  for update to authenticated
  using (((select app.is_active_user()) AND (recipient_user_id = (select auth.uid()))))
  with check (((select app.is_active_user()) AND (recipient_user_id = (select auth.uid()))));

-- ── organisation_identifiers ────────────────────────────────────────────

drop policy organisation_identifiers_select_active on public.organisation_identifiers;
create policy organisation_identifiers_select_active on public.organisation_identifiers
  for select to authenticated
  using ((select app.is_active_user()));

drop policy organisation_identifiers_write_admin on public.organisation_identifiers;
create policy organisation_identifiers_write_admin on public.organisation_identifiers
  for all to authenticated
  using (((select app.is_active_user()) AND (select app.is_admin())))
  with check (((select app.is_active_user()) AND (select app.is_admin())));

-- ── organisation_status_flags ───────────────────────────────────────────

drop policy organisation_status_flags_select_admin on public.organisation_status_flags;
create policy organisation_status_flags_select_admin on public.organisation_status_flags
  for select to authenticated
  using ((select app.is_admin()));

-- ── outcomes ────────────────────────────────────────────────────────────

drop policy outcomes_delete_admin on public.outcomes;
create policy outcomes_delete_admin on public.outcomes
  for delete to authenticated
  using (((select app.is_active_user()) AND (select app.is_admin())));

drop policy outcomes_insert_admin on public.outcomes;
create policy outcomes_insert_admin on public.outcomes
  for insert to authenticated
  with check (((select app.is_active_user()) AND (select app.is_admin())));

drop policy outcomes_select_active on public.outcomes;
create policy outcomes_select_active on public.outcomes
  for select to authenticated
  using ((select app.is_active_user()));

drop policy outcomes_update_admin on public.outcomes;
create policy outcomes_update_admin on public.outcomes
  for update to authenticated
  using (((select app.is_active_user()) AND (select app.is_admin())))
  with check (((select app.is_active_user()) AND (select app.is_admin())));

-- ── outreach_daily_send_limit ───────────────────────────────────────────

drop policy outreach_daily_send_limit_select_active on public.outreach_daily_send_limit;
create policy outreach_daily_send_limit_select_active on public.outreach_daily_send_limit
  for select to authenticated
  using ((select app.is_active_user()));

-- ── outreach_messages ───────────────────────────────────────────────────

drop policy outreach_messages_delete_admin on public.outreach_messages;
create policy outreach_messages_delete_admin on public.outreach_messages
  for delete to authenticated
  using (((select app.is_active_user()) AND (select app.is_admin()) AND (send_status = 'draft'::send_status)));

drop policy outreach_messages_delete_own_draft on public.outreach_messages;
create policy outreach_messages_delete_own_draft on public.outreach_messages
  for delete to authenticated
  using (((select app.is_active_user()) AND (select app.is_cam()) AND COALESCE((sent_by_user_id = (select auth.uid())), false) AND (send_status = 'draft'::send_status)));

drop policy outreach_messages_insert_admin on public.outreach_messages;
create policy outreach_messages_insert_admin on public.outreach_messages
  for insert to authenticated
  with check (((select app.is_active_user()) AND (select app.is_admin()) AND app.can_contact_organisation(organisation_id)));

drop policy outreach_messages_insert_cam on public.outreach_messages;
create policy outreach_messages_insert_cam on public.outreach_messages
  for insert to authenticated
  with check (((select app.is_active_user()) AND (select app.is_cam()) AND (sent_by_user_id = (select auth.uid())) AND app.can_contact_organisation(organisation_id)));

drop policy outreach_messages_select_active on public.outreach_messages;
create policy outreach_messages_select_active on public.outreach_messages
  for select to authenticated
  using ((select app.is_active_user()));

drop policy outreach_messages_update_admin on public.outreach_messages;
create policy outreach_messages_update_admin on public.outreach_messages
  for update to authenticated
  using (((select app.is_active_user()) AND (select app.is_admin()) AND (send_status = 'draft'::send_status)))
  with check (((select app.is_active_user()) AND (select app.is_admin())));

drop policy outreach_messages_update_own_draft on public.outreach_messages;
create policy outreach_messages_update_own_draft on public.outreach_messages
  for update to authenticated
  using (((select app.is_active_user()) AND (select app.is_cam()) AND COALESCE((sent_by_user_id = (select auth.uid())), false) AND (send_status = 'draft'::send_status)))
  with check (((select app.is_active_user()) AND (select app.is_cam()) AND COALESCE((sent_by_user_id = (select auth.uid())), false)));

-- ── outreach_preferences ────────────────────────────────────────────────

drop policy outreach_preferences_insert_own on public.outreach_preferences;
create policy outreach_preferences_insert_own on public.outreach_preferences
  for insert to authenticated
  with check (((select app.is_active_user()) AND (user_id = (select auth.uid()))));

drop policy outreach_preferences_select_admin on public.outreach_preferences;
create policy outreach_preferences_select_admin on public.outreach_preferences
  for select to authenticated
  using (((select app.is_active_user()) AND (select app.is_admin())));

drop policy outreach_preferences_select_own on public.outreach_preferences;
create policy outreach_preferences_select_own on public.outreach_preferences
  for select to authenticated
  using (((select app.is_active_user()) AND (user_id = (select auth.uid()))));

drop policy outreach_preferences_update_own on public.outreach_preferences;
create policy outreach_preferences_update_own on public.outreach_preferences
  for update to authenticated
  using (((select app.is_active_user()) AND (user_id = (select auth.uid()))))
  with check (((select app.is_active_user()) AND (user_id = (select auth.uid()))));

-- ── ownership_requests ──────────────────────────────────────────────────

drop policy ownership_requests_select_involved on public.ownership_requests;
create policy ownership_requests_select_involved on public.ownership_requests
  for select to authenticated
  using (((select app.is_active_user()) AND ((select app.is_admin()) OR (requested_by = (select auth.uid())) OR app.owns_organisation(organisation_id))));

-- ── personal_email_role_parts ───────────────────────────────────────────

drop policy personal_email_role_parts_select on public.personal_email_role_parts;
create policy personal_email_role_parts_select on public.personal_email_role_parts
  for select to authenticated
  using (((select app.is_admin()) AND (select app.is_active_user())));

-- ── raw_source_records ──────────────────────────────────────────────────

drop policy raw_source_records_delete on public.raw_source_records;
create policy raw_source_records_delete on public.raw_source_records
  for delete to authenticated
  using (((select app.is_admin()) AND (select app.is_active_user())));

drop policy raw_source_records_select on public.raw_source_records;
create policy raw_source_records_select on public.raw_source_records
  for select to authenticated
  using (((select app.is_admin()) AND (select app.is_active_user())));

-- ── reply_events ────────────────────────────────────────────────────────

drop policy reply_events_select_active on public.reply_events;
create policy reply_events_select_active on public.reply_events
  for select to authenticated
  using ((select app.is_active_user()));

-- ── restricted_edit_fields ──────────────────────────────────────────────

drop policy restricted_edit_fields_select_admin on public.restricted_edit_fields;
create policy restricted_edit_fields_select_admin on public.restricted_edit_fields
  for select to authenticated
  using (((select app.is_active_user()) AND ((select app.is_admin()) OR ((select app.is_cam()) AND active))));

-- ── saved_views ─────────────────────────────────────────────────────────

drop policy saved_views_delete_own on public.saved_views;
create policy saved_views_delete_own on public.saved_views
  for delete to authenticated
  using (((select app.is_active_user()) AND (user_id = (select auth.uid()))));

drop policy saved_views_insert_own on public.saved_views;
create policy saved_views_insert_own on public.saved_views
  for insert to authenticated
  with check (((select app.is_active_user()) AND (user_id = (select auth.uid()))));

drop policy saved_views_select_own on public.saved_views;
create policy saved_views_select_own on public.saved_views
  for select to authenticated
  using (((select app.is_active_user()) AND (user_id = (select auth.uid()))));

drop policy saved_views_update_own on public.saved_views;
create policy saved_views_update_own on public.saved_views
  for update to authenticated
  using (((select app.is_active_user()) AND (user_id = (select auth.uid()))))
  with check (((select app.is_active_user()) AND (user_id = (select auth.uid()))));

-- ── score_snapshots ─────────────────────────────────────────────────────

drop policy score_snapshots_select_admin on public.score_snapshots;
create policy score_snapshots_select_admin on public.score_snapshots
  for select to authenticated
  using (((select app.is_active_user()) AND (select app.is_admin())));

-- ── send_events ─────────────────────────────────────────────────────────

drop policy send_events_select_active on public.send_events;
create policy send_events_select_active on public.send_events
  for select to authenticated
  using ((select app.is_active_user()));

-- ── tags ────────────────────────────────────────────────────────────────

drop policy tags_insert_can_write on public.tags;
create policy tags_insert_can_write on public.tags
  for insert to authenticated
  with check (((select app.is_active_user()) AND (select app.can_write()) AND (created_by_user_id = (select auth.uid()))));

drop policy tags_select_active on public.tags;
create policy tags_select_active on public.tags
  for select to authenticated
  using ((select app.is_active_user()));

drop policy tags_update_admin_only on public.tags;
create policy tags_update_admin_only on public.tags
  for update to authenticated
  using (((select app.is_active_user()) AND (select app.is_admin())))
  with check (((select app.is_active_user()) AND (select app.is_admin())));

-- ── user_onboarding_steps ───────────────────────────────────────────────

drop policy user_onboarding_steps_insert_own on public.user_onboarding_steps;
create policy user_onboarding_steps_insert_own on public.user_onboarding_steps
  for insert to authenticated
  with check (((select app.is_active_user()) AND (user_id = (select auth.uid()))));

drop policy user_onboarding_steps_select_own on public.user_onboarding_steps;
create policy user_onboarding_steps_select_own on public.user_onboarding_steps
  for select to authenticated
  using (((select app.is_active_user()) AND (user_id = (select auth.uid()))));
