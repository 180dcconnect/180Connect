# Manual Client Entry (F036)

## Implemented in this branch

- CAM/admin submission form at `/clients/new`.
- Approved `MANUAL_ENTRY_RECORDS` fields from Data Model tab 03.
- Submitter identity, required reason, pending admin review and source-safe storage.
- Admin review queue at `/admin/manual-entries`.
- Audited, admin-only rejection through a `SECURITY DEFINER` RPC.
- No submission becomes an active `ORGANISATIONS` row automatically.
- F045 email-format validation runs at submission and is visible in review.
- F046 website format/reachability validation runs at submission and review;
  field failures are warnings and do not discard the record.
- F047 client criteria can be reviewed with an explicit admin confirmation for
  ambiguous companies and other organisations.
- `buildManualOrganisation` produces the standard F041 payload with
  `entry_method = manual`, which F043 displays as `Manual Entry` after conversion.

## Dependency integration contract

`src/lib/manual-entry.ts` defines the approval boundary. F045 and F046 run as
field-quality warnings, F047 can block activation, and F042 remains the final
unavailable dependency:

- **F042** - duplicate candidate check and human duplicate decision. Not yet
  merged or connected; the Approve control remains disabled.
- **F046** - website format/reachability result (an invalid website remains a field
  warning and does not discard the submission).
- **F047** - connected through `checkManualEntryCriteria`, which calls the shared
  `checkClientCriteria` policy. Missing organisation-type evidence blocks approval;
  ambiguous company/other records require an explicit admin eligibility decision.

No approval/conversion RPC is exposed before F042. Enforcing deduplication only
in a button or Server Action would be bypassable through a direct RPC call. Once
F042 provides its database-backed decision, the conversion RPC must atomically:

1. verify the duplicate decision and admin permission;
2. insert the standard `ORGANISATIONS` row built by `buildManualOrganisation`;
3. create the manual registry identifier when supplied;
4. mark the submission approved and link `converted_to_organisation_id`; and
5. write the approval audit entry.

Reject remains available because it cannot create an active client.

## Open field decision

The approved `MANUAL_ENTRY_RECORDS` model does not contain mission, organisation
type or full address. They have not been invented in this migration. If the team
confirms those as manual fields, update the Data Model spreadsheet first, run
`npm run export:data-model`, and add a later additive migration.

Organisation type is selected during the current review checks rather than
silently defaulted. It cannot be persisted on `MANUAL_ENTRY_RECORDS` until the
Data Model is updated, so the final F042-backed approval form will need to pass
the reviewed value into the atomic conversion RPC.
