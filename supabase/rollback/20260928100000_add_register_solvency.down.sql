-- Rollback: add_register_solvency
--
-- Drops the two register-solvency columns and their partial indexes. Nothing
-- references them outside the charity register import (toRawPayload →
-- annotateOrganisation) and the client record header, so this is the whole
-- reversal: the code paths simply stop finding the columns and read null, which
-- they already treat as "not known".
--
-- The indexes go with the columns, but are dropped explicitly so a re-apply
-- after a partial failure does not depend on the cascade.

drop index if exists public.organisations_in_administration_idx;
drop index if exists public.organisations_insolvent_idx;

alter table public.organisations
  drop column if exists in_administration,
  drop column if exists insolvent;
