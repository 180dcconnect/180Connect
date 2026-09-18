-- Rollback for 20261004200000_create_outreach_cycles.sql: drops the table. Cycle
-- definitions are labels only — no outreach row references them, so nothing
-- else loses data. Re-creating the same names afterwards restores the labels.

drop table if exists public.outreach_cycles;
