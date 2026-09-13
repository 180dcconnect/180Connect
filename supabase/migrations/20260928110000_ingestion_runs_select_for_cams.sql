-- Migration: ingestion_runs_select_for_cams
-- Story: Data imports navigation — the group is opened to CAMs.
--
-- WHY THIS MIGRATION EXISTS: CAMs already reach the Companies House and Charity
-- Commission importers (both gate on `client:edit` — the team decided everyone
-- who works the client list can shape and run imports), and "Add a client" now
-- lives in the same Data imports group. What they could not see is whether an
-- import they ran worked: `ingestion_runs` SELECT was admin-only, so the Import
-- status tab and every importer's "recent runs" panel read back zero rows for a
-- CAM rather than an error — an empty history that looked like nothing had ever
-- run.
--
-- ── What widens, and what deliberately does not ──
--
-- Only SELECT on `ingestion_runs`: one row per run, holding the source, the
-- outcome, the record counts and the error message. No organisation data, no
-- third-party payload.
--
-- `raw_source_records` stays admin-only. It holds the unfiltered payloads, and
-- SOP §4.3 "View raw source records: Yes/technical admin, CAM no" is unchanged —
-- the run detail page that reads it keeps its admin gate, and the CAM
-- `select *` returning zero rows is still asserted in the RLS suite.
--
-- INSERT stays admin-only too: a run is recorded by the pipeline, not by a CAM
-- writing a row. Viewers get nothing — they cannot run an import either.

drop policy ingestion_runs_select on public.ingestion_runs;
create policy ingestion_runs_select on public.ingestion_runs
  for select to authenticated
  using (
    ((select app.is_admin()) or (select app.is_cam()))
    and (select app.is_active_user())
  );
