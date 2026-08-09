# Manual Client Entry (F036)

## Implemented in this branch

- CAM/admin submission form at `/clients/new`.
- Approved `MANUAL_ENTRY_RECORDS` fields from Data Model tab 03.
- Submitter identity, required reason, pending admin review and source-safe storage.
- Admin review queue at `/admin/manual-entries`.
- Audited, admin-only rejection through a `SECURITY DEFINER` RPC.
- No submission becomes an active `ORGANISATIONS` row automatically.

## Dependency integration contract

`src/lib/manual-entry.ts` defines `ManualEntryApprovalChecks`. Approval calls the
two remaining adapters plus F047's shared checker and fails closed unless every
result is `passed`:

- **F042** - duplicate candidate check and human duplicate decision.
- **F046** - website format/reachability result (an invalid website remains a field
  warning and does not discard the submission).
- **F047** - connected through `checkManualEntryCriteria`, which calls the shared
  `checkClientCriteria` policy. Missing organisation-type evidence blocks approval;
  ambiguous company/other records require an explicit admin eligibility decision.

The admin Approve control is intentionally disabled until the F042 and F046
adapters are connected. Reject remains available because it cannot create an
active client.

## Open field decision

The approved `MANUAL_ENTRY_RECORDS` model does not contain mission, organisation
type or full address. They have not been invented in this migration. If the team
confirms those as manual fields, update the Data Model spreadsheet first, run
`npm run export:data-model`, and add a later additive migration.

Organisation type will also be needed when an approved entry is converted into an
active organisation. It should be selected or derived during review rather than
silently defaulted.
