-- supabase/rollback/<same-timestamp-as-your-migration>_create_raw_data_layer.down.sql
drop table if exists public.raw_source_records;
drop table if exists public.ingestion_runs;

