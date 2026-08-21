// Charity Commission discovery/status-watch tuning (F049), mirroring the shape of
// companies-house-criteria-config.ts. No tier/legal-form rules here, unlike
// Companies House: every Charity Commission record maps to organisation_type
// "charity", which F047's criteria config already accepts unconditionally
// (CLIENT_CRITERIA.acceptedOrganisationTypes) — there is no mission-fit ambiguity
// to filter for at discovery time the way there is for companies.

/** Charity Commission's reg_status field: "R" (registered) is the "alive" state,
 * "RM" (removed) is not. Any other value (or a missing one, read as "unknown")
 * transitioning away from "R" triggers an organisation_status_flags review flag. */
export const ALIVE_REG_STATUS = "R";

/** Tunable once real Charity Commission-sourced organisation volume is known —
 * same starting value as Companies House's STATUS_RECHECK_BATCH_SIZE. */
export const STATUS_RECHECK_BATCH_SIZE = 400;
