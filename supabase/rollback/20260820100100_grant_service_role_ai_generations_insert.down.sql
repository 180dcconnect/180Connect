-- Rollback for 20260820100100_grant_service_role_ai_generations_insert.sql
-- Warning: reverting this puts F100's generation route back into its currently
-- broken state (every generation fails with "permission denied for table
-- ai_generations"). Only run this if F100 itself is being reverted too.

revoke insert on public.ai_generations from service_role;
