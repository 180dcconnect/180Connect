# Manual Client Entry (F036)

## Implemented in this branch

- CAM/admin submission form at `/clients/new`.
- Approved `MANUAL_ENTRY_RECORDS` fields from Data Model tab 03.
- Submitter identity, required reason, pending admin review and source-safe storage.
- Admin review queue at `/admin/manual-entries`.
- Audited, admin-only approval/rejection through `SECURITY DEFINER` RPCs.
- A submission becomes active only after the admin completes every check and
  makes the F042 duplicate decision.
- F045 email-format validation runs at submission and is visible in review.
- F046 website format/reachability validation runs at submission and review;
  field failures are warnings and do not discard the record.
- F047 client criteria can be reviewed with an explicit admin confirmation for
  ambiguous companies and other organisations.
- `buildManualOrganisation` produces the standard F041 payload with
  `entry_method = manual`, which F043 displays as `Manual Entry` after conversion.

## Dependency integration contract

`src/lib/manual-entry.ts` defines the approval boundary. F045 and F046 run as
field-quality warnings, F047 can block activation, and F042 surfaces a candidate
for an explicit human decision:

- **F042** - connected through the shared `findDuplicateMatch` rules. A likely
  duplicate can be linked to the existing client, or an admin can explain why it
  is genuinely separate before creating a new client.
- **F046** - website format/reachability result (an invalid website remains a field
  warning and does not discard the submission).
- **F047** - connected through `checkManualEntryCriteria`, which calls the shared
  `checkClientCriteria` policy. Missing organisation-type evidence blocks approval;
  ambiguous company/other records require an explicit admin eligibility decision.

`approve_manual_entry` re-checks the F042 result inside the database transaction,
so a stale or forged browser value cannot bypass matching. The RPC atomically:

1. verify the duplicate decision and admin permission;
2. link a confirmed duplicate or insert the standard `ORGANISATIONS` row;
3. create the manual registry identifier when supplied;
4. mark the submission approved and link `converted_to_organisation_id`; and
5. write the approval audit entry.

The expanded source RPC includes the creating CAM on the client profile and keeps
`Manual Entry` alongside any external API contributors.

## Open field decision

The approved `MANUAL_ENTRY_RECORDS` model does not contain mission, organisation
type or full address. They have not been invented in this migration. If the team
confirms those as manual fields, update the Data Model spreadsheet first, run
`npm run export:data-model`, and add a later additive migration.

Organisation type is selected during the current review checks rather than
silently defaulted. It cannot be persisted on `MANUAL_ENTRY_RECORDS` until the
Data Model is updated, so the reviewed value is passed directly into the atomic
approval RPC and recorded in its audit detail.
