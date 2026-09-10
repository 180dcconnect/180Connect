-- Migration: add_charity_scale_and_govt_funding
-- Sequence: no new step in Data Model tab "11 Supabase Migration Sequence" — this
--   widens an existing table, it does not add one. Same shape as
--   20260923103000_add_charity_financial_breakdown.sql.
-- Story: Charity Commission bulk register import — the annual return carries more
--   than money, and two of those figures decide how a consulting engagement is
--   scoped before anyone opens a conversation.
--
-- What each column is for, because "we had the data" is not a reason to store it:
--
--   count_employees / count_volunteers
--     How the organisation is actually staffed. A £400k charity run by two
--     employees and ninety volunteers is a different engagement from a £400k
--     charity with twelve employees and none — same income band, same score,
--     completely different project. This is the minimisation purpose: sizing the
--     engagement, which income alone cannot do.
--
--   receives_govt_grants / receives_govt_contracts / count_govt_grants /
--   count_govt_contracts
--     We already store the government income *amounts*
--     (20260923103000). The flags and counts say whether that money is one
--     standing relationship or fifteen small awards — a different funding
--     profile, and a different conversation.
--
-- Deliberately NOT stored: the sixteen count_salary_band_* fields the same annual
-- return publishes. "One employee in the £450,001–£500,000 band" at a small
-- charity identifies a specific person, which fails the identifiability test in
-- docs/data-lifecycle-policy.md §5.7. They are aggregate in form only. See
-- docs/personal-data-exclusions.md for the recorded decision.
--
-- Also not stored: a trustee count. No bulk extract we ingest carries one — the
-- only route is the trustee-name extract, and trustee identities are banned
-- (docs/personal-data-exclusions.md, rules seeded by 20260818100400). Deriving a
-- count would mean fetching the names to count them.
--
-- Every column is nullable and a null means "not published for this year", never
-- zero — an entry-level annual return files totals only. A charity that filed
-- "0 employees" is a different fact from one that filed nothing, and the two must
-- stay distinguishable.
--
-- Data classification and retention (docs/data-lifecycle-policy.md §3, §6):
--   Classification | Public — published regulatory data, organisation-level,
--                  | identifying no natural person. Same class as total_income.
--   Retention      | Retained for the life of the FINANCIAL_PERIODS row, with the
--                  | rest of that filed period. No separate purge rule; nothing
--                  | here is personal data, so no erasure right attaches.
--
-- Schema change approval record (SOP §7):
--   Change        | 6 nullable columns on FINANCIAL_PERIODS (4 integer, 2 boolean).
--   Reason        | Scale (employees, volunteers) and the shape of public funding
--                 | decide how an engagement is scoped; income alone does not.
--                 | Both come from the annual return we are already reading.
--   Compatibility | Additive and nullable. No existing column changes; no row is
--                 | rewritten; every current select keeps working.
--   Data migration| None. The bulk import populates these as it runs.
--   Security      | No new table, so no new RLS surface. Published regulatory
--                 | data — nothing personal. Salary bands and trustee counts are
--                 | excluded by design, see above.
--   Documentation | Data Model spreadsheet (SOP §7) must be updated to match
--                 | before this reaches production, then npm run export:data-model.
--                 | The salary-band and trustee-count exclusions are recorded in
--                 | docs/personal-data-exclusions.md.
--   Approved by   | Bashir (Project Leader).
--
-- Reversibility: paired rollback in
-- ../rollback/20260923112000_add_charity_scale_and_govt_funding.down.sql

alter table public.financial_periods
  add column if not exists count_employees        integer,
  add column if not exists count_volunteers       integer,
  add column if not exists receives_govt_grants   boolean,
  add column if not exists receives_govt_contracts boolean,
  add column if not exists count_govt_grants      integer,
  add column if not exists count_govt_contracts   integer;

comment on column public.financial_periods.count_employees is
  'Employees reported on the annual return for this period. Null = not published '
  '(entry-level returns file totals only); 0 is a filed zero. Used to size an '
  'engagement alongside income.';

comment on column public.financial_periods.count_volunteers is
  'Volunteers reported on the annual return for this period. Null = not published, '
  '0 is a filed zero.';

comment on column public.financial_periods.receives_govt_grants is
  'Whether the charity reported receiving government grant funding in this period. '
  'Read with income_govt_grants: the flag says whether the relationship exists, the '
  'amount says how big it is, count_govt_grants says how many awards.';

comment on column public.financial_periods.count_govt_contracts is
  'Number of government contracts reported for this period. One large contract and '
  'fifteen small ones are different funding profiles at the same total.';
