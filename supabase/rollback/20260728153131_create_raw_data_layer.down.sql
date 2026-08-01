-- Rollback for 20260728153131_create_raw_data_layer.sql (F038).
--
-- raw_source_records first: it holds the FK to ingestion_runs. Both tables are
-- dropped outright, which discards every raw payload fetched so far — that is the
-- intent of a rollback here, since nothing downstream reads these tables yet.
-- Policies, grants, indexes and the unique constraint go with the tables.

drop table if exists public.raw_source_records;
drop table if exists public.ingestion_runs;
