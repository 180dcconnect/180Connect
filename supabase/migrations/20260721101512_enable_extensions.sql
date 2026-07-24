-- Migration: enable_extensions
-- Sequence step 1/17 (Data Model tab "11 Supabase Migration Sequence")
-- Story: F232 (#227) — Database Migration Management
-- Purpose: enable Postgres extensions required before any table is created.
--   uuid-ossp / pgcrypto -> uuid primary keys (SOP §7: every table has id uuid PK)
--   pgvector is DEFERRED to scoring Stage 2 (not enabled here).
-- Reversibility: paired rollback in ../rollback/20260721101512_enable_extensions.down.sql

create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists "pgcrypto" with schema extensions;
