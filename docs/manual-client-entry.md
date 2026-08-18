# Manual Client Entry (F036)

## Workflow

CAMs and admins use `/clients/new` to create a charity or organisation that is
not available from an external source. A user may save an incomplete draft and
resume it later. Drafts are visible only to their creator and admins, and they do
not appear in the admin review queue or active client list.

Submission requires all confirmed standard fields:

- organisation name, mission and organisation type;
- address line, town/city, postcode and country;
- email and website;
- registry name and registration number; and
- a reason for using Manual Entry.

A CAM submission becomes `pending` and requires an admin decision. An admin's
own complete submission does not require a second admin: after the same server
checks pass, it is approved in the admin's own audited workflow. If a duplicate
candidate appears during that automatic decision, the record remains pending so
the admin can explicitly link it or confirm that it is a separate organisation.

## Validation and dependency integration

Every submitted record uses the shared dependency boundaries:

- **F042 — duplicate detection:** matching registry numbers and normalised
  organisation identity are checked before activation. A likely duplicate is
  never silently merged or discarded; an admin must link the existing client or
  explain why a new one should be created.
- **F045 — email format:** invalid email format is retained as a visible field
  warning and does not discard the rest of the record.
- **F046 — website URL:** format and reachability checks run before submission
  and again during review. A broken website is retained as a warning.
- **F047 — client criteria:** charities can proceed; ambiguous company/other
  records require explicit admin confirmation that they are eligible.

Draft saving deliberately does not run the submission-only checks because fields
may still be incomplete. The complete submission is validated again server-side;
browser validation is not trusted as the approval boundary.

## Activation and source tracking

`approve_manual_entry` re-checks permissions and the duplicate decision inside
the database transaction. It then links the confirmed duplicate or creates the
standard F041 organisation, stores the registry identifier and mission, marks
the manual record approved, and writes the audit entry atomically.

New organisations use `entry_method = manual`. F043 therefore displays
`Manual Entry` on the client profile and identifies the creating CAM/admin. If
the record is linked to an organisation with API provenance, all contributing
sources remain visible and existing internal organisation data is preserved.

## Data model

`MANUAL_ENTRY_RECORDS` stores draft inputs, workflow status, submitter, reviewer,
review notes and the activated organisation link. Inputs are nullable only while
the status is `draft`; a database constraint requires the full confirmed field
set for `pending`, `approved` and `rejected` rows.

The Data Model spreadsheet and generated projection were updated with the new
mission, organisation type and address fields. The migration is paired with a
rollback and all workflow status/approval changes are recorded in `AUDIT_LOG`.
