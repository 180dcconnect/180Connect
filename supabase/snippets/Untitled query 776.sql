select policyname, cmd, roles from pg_policies where tablename in ('ingestion_runs', 'raw_source_records');
