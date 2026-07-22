## Schema change approval record

<!--
Required by SOP §7 whenever this PR adds or changes a migration, table, view,
function or policy. Delete this whole section if the PR touches no schema.
See supabase/MIGRATIONS.md for the workflow.
-->

- [ ] This PR changes the database schema (if unticked, delete this section)

| Field | Entry |
| :---- | :---- |
| Story / PR | |
| Affected tables | List every table, view, function or policy changed |
| Migration | Filename + sequence step number (Data Model tab 11) |
| Compatibility | Impact on other streams, jobs and dashboards |
| Data migration | Backfill or transformation required |
| Security | RLS enabled + policies added in the same migration? Service-role behaviour |
| Documentation | Data Model + tab 02 Data Dictionary updated (Y/N) |
| Reversibility | Paired `supabase/rollback/*.down.sql`, or `-- IRREVERSIBLE: <reason>` header |

## Definition of Done
- [ ] Works end-to-end in staging as part of the full flow — not tested as an isolated component.
- [ ] Reviewed and approved by someone who did not write it.
- [ ] Demonstrated live during the sprint demo.
- [ ] Any database writes follow the approved schema.
- [ ] Any schema change includes a migration and an updated data model / data dictionary.
- [ ] Any outreach feature proves that sending is impossible without explicit human approval.
- [ ] Every failure is visible and recorded in ERROR_LOG.
- [ ] Every new external API call writes to API_HEALTH_LOGS.
- [ ] Tests cover the main success path and important failure / permission paths.
- [ ] User-facing errors are clear and do not expose stack traces or secrets.