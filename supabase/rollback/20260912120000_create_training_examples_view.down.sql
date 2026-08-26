-- Rollback: create_training_examples_view
-- Reverses 20260912120000_create_training_examples_view.sql (F098).
-- A view owns no data — dropping it loses nothing.

drop view if exists public.training_examples;
