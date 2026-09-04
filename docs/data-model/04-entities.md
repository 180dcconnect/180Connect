<!--
  GENERATED FILE — DO NOT EDIT.
  Source: ~/180Connect/Data Model.xlsx (the Data Model spreadsheet is the source of truth, per SOP §7).
  To change anything here: edit the spreadsheet, then run `npm run export:data-model`.
-->

# 04 Entities

## ORGANISATIONS

| Field | Type | Foreign Key (Table Relation) | Nullable | Description | Collection Method | How | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| id | uuid |  | No | Primary key | System | Auto-generated on row creation | [service_role granted INSERT/SELECT (F041) for automated writes] |
| legal_name | text |  | No | Official registered name | API | From Companies House or CharityBase | Companies House takes priority over CharityBase |
| trading_name | text |  | Yes | Name the organisation operates under if different | API | Pulled from enrichment sources | Null if same as legal name |
| country_code | text |  | No | ISO country code for the organisation’s primary country of operation | System + Human | Set automatically for API records; CAM selects it for manually entered records | Default: GB |
| is_international | boolean |  | No | Whether the organisation is based outside the United Kingdom | System | Derived from country_code; set to true when country_code is not GB | Default: false |
| entry_method | enum |  | No | How the organisation record entered the system | System | Set when the record is created | api / manual |
| is_verified | boolean |  | No | Whether all identifiers for this organisation have been verified | System | Set to true automatically when all related ORGANISATION_IDENTIFIERS records are verified | Default is false the is_verified boolean on ORGANISATIONS just reflects whether the identifiers underneath it have been confirmed. It never stores the actual numbers itself that's always in ORGANISATION_IDENTIFIERS. |
| organisation_type | enum |  | No | Type of organisation | System | Derived from source and registration data | charity / cio / cic / social_enterprise / ngo / company / both / other |
| website | text |  | Yes | Organisation website URL | API | Pulled from external sources |  |
| contact_email | text |  | Yes | Primary contact email address | API | Pulled from external sources or enrichment |  |
| address_line_1 | text |  | Yes | First line of registered address | API | Pulled from Companies House or CharityBase |  |
| city | text |  | Yes | City | API | Pulled from address data |  |
| postcode | text |  | Yes | Postcode | API | Pulled from address data |  |
| geographic_reach | enum |  | Yes | How far the organisation operates | LLM | Derived from enrichment and mission data | local / regional / national / international |
| outreach_status | enum |  | No | Current status of the organisation in the outreach pipeline | System | Updated as organisation moves through pipeline | not_contacted / initial_outreach_sent / follow_up_sent / responded / converted / future_potential / soft_no / hard_no / no_response / loss_due_timing |
| last_reply_sentiment | enum |  | Yes | Sentiment of the most recent reply | LLM | Written when reply classification completes | Null until first reply received |
| last_reply_intent | enum |  | Yes | Intent of the most recent reply | LLM | Written when reply classification completes | Null until first reply received |
| data_completeness_score | numeric |  | Yes | How complete the organisation's data is | System | Computed from field coverage |  |
| owner_id | uuid | USERS | Yes | CAM responsible for this organisation | Human | Set when CAM claims the organisation | Null if unassigned |
| created_at | timestamp |  | No | Row creation timestamp | System | Auto-generated |  |
| updated_at | timestamp |  | No | Last updated timestamp | System | Auto-updated on any change |  |
| is_seed | boolean |  | No | Flag for seed data | System/Human | Set in the seed data script | False by default |
| registered_on | date |  | Yes | Date the organisation entered its register | API | Charity Commission date_of_registration | Lets the app distinguish "no accounts due yet" from "overdue" — without it both render as an empty Financials tab |
| charity_reporting_status | text |  | Yes | The register's own reporting status for a charity | API | Charity Commission reporting_status | Values are the regulator's: New / Submission Received / … Deliberately text, not an enum, so an unseen value can't fail an ingestion run |
| charity_activities | text |  | Yes | The charity's own description of its work, as filed with the register | API | Charity Commission publicextract.charity.charity_activities | Canonical register text, distinct from ENRICHMENT_RESULTS.mission_statement, which is LLM-derived — a reader showing both must not present them as the same kind of claim. Externally authored free text: treat as untrusted input anywhere it reaches a model. |

## ORGANISATION_IDENTIFIERS

| id | uuid |  | No | Primary key | System | Auto-generated on row creation |  |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| organisation_id | uuid | ORGANISATIONS | No | Organisation this identifier belongs to | System | Set when identifier is created |  |
| identifier_type | enum |  | No | What kind of identifier this is | System / Human | Set automatically for API sources; CAM selects for manual entries | uk_charity / uk_company / eu_company / international_registry / website / manual |
| identifier_value | text |  | No | The actual number or value | API / Human | Pulled from API response or entered by CAM |  |
| registry_name | text |  | Yes | Name of the specific registry | System / Human | Set by ingestion worker for API sources; entered by CAM for manual entries | Null for UK sources where registry is implied |
| registry_country | text |  | Yes | ISO country code of the registry | System / Human | Set automatically for known sources; CAM selects for manual entries | Null for non-registry identifiers like website |
| is_primary | boolean |  | No | Whether this is the main identifier used for deduplication | System / Human | Set automatically when only one identifier exists; CAM selects if multiple | Only one per organisation can be true |
| verified | boolean |  | No | Whether this identifier has been confirmed | System / Human | Auto-verified for UK API sources; manual sign-off for international | Default false |
| verified_by_user_id | uuid | USERS | Yes | Admin who verified this identifier | System | Set to logged-in admin at verification time | Null for auto-verified records |
| verified_at | timestamp |  | Yes | When this identifier was verified | System | Written when verified is set to true | Null until verified |
| created_at | timestamp |  | No | Row creation timestamp | System | Auto-generated |  |

## CONTACTS

| Field | Type | Foreign Key (Table Relation) | Nullable | Description | Collection Method | How | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| id | uuid |  | No | Primary key | System | Auto-generated on row creation |  |
| organisation_id | uuid | ORGANISATIONS | No | Organisation this contact belongs to | System | Set when contact is created |  |
| first_name | text |  | Yes | Contact's first name | API | Pulled from external sources or enrichment |  |
| last_name | text |  | Yes | Contact's last name | API | Pulled from external sources or enrichment |  |
| email | text |  | Yes | Contact email address | API | Pulled from external sources or enrichment |  |
| phone | text |  | Yes | Contact phone number | API | Pulled from external sources |  |
| job_title | text |  | Yes | Contact's role or job title | API | Pulled from external sources or enrichment |  |
| is_primary | boolean |  | No | Whether this is the primary contact for the org | Human | Set by CAM | Default false |
| contact_source | enum |  | Yes | Where this contact was found | System | Set when contact is created | api / manual / enrichment |
| created_at | timestamp |  | No | Row creation timestamp | System | Auto-generated |  |
| updated_at | timestamp |  | No | Last updated timestamp | System | Auto-updated on any change |  |

## FINANCIAL_PERIODS

| Field | Type | Foreign Key (Table Relation) | Nullable | Description | Collection Method | How | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| id | uuid |  | No | Primary key | System | Auto-generated on row creation |  |
| organisation_id | uuid | ORGANISATIONS | No | Organisation these financials belong to | System | Set when record is created |  |
| period_start | date |  | No | Start of the financial period | API | Pulled from CharityBase or Charity Commission |  |
| period_end | date |  | No | End of the financial period | API | Pulled from CharityBase or Charity Commission |  |
| total_income | numeric |  | Yes | Total income for the period | API | Pulled from financial filing |  |
| total_expenditure | numeric |  | Yes | Total expenditure for the period | API | Pulled from financial filing |  |
| income_band | enum |  | Yes | Banded income category | System | Computed from total_income | under_10k / 10k_100k / 100k_1m / over_1m |
| filing_date | date |  | Yes | Date the accounts were filed | API | Pulled from Charity Commission | Populated from the bulk register extract's ar_received_date. The Charity Commission API publishes no accounts-submission date at any endpoint, so API-sourced periods leave this null. |
| financial_source | enum |  | No | Which API provided this data | System | Set on ingestion | charitybase / charity_commission |
| income_donations_legacies | numeric |  | Yes | Income from donations and legacies for the period | API | Charity Commission | Annual-return breakdown. Parts are not guaranteed to sum to total_income — smaller charities file totals only. Null = not published, never zero |
| income_charitable_activities | numeric |  | Yes | Income from charitable activities | API | Charity Commission | " |
| income_other_trading | numeric |  | Yes | Income from other trading activities | API | Charity Commission | " |
| income_investment | numeric |  | Yes | Investment income | API | Charity Commission | " |
| income_endowments | numeric |  | Yes | Endowment income | API | Charity Commission | " |
| income_other | numeric |  | Yes | Other income | API | Charity Commission | " |
| income_govt_grants | numeric |  | Yes | Income from government grants | API | Charity Commission | Available from no other source we hold |
| income_govt_contracts | numeric |  | Yes | Income from government contracts | API | Charity Commission | Available from no other source we hold |
| expenditure_charitable_activities | numeric |  | Yes | Spend on charitable activities | API | Charity Commission | Annual-return breakdown; null = not published |
| expenditure_raising_funds | numeric |  | Yes | Spend on raising funds | API | Charity Commission | " |
| expenditure_governance | numeric |  | Yes | Governance costs | API | Charity Commission | " |
| expenditure_grants_institutions | numeric |  | Yes | Grants made to institutions | API | Charity Commission | " |
| expenditure_investment_management | numeric |  | Yes | Investment management costs | API | Charity Commission | " |
| expenditure_other | numeric |  | Yes | Other expenditure | API | Charity Commission | " |
| count_employees | integer |  | Yes | Employees reported on the annual return for this period | API | Charity Commission bulk annual return extract (Part A / Part B) | Part B. Null = not published (entry-level returns file totals only); 0 is a filed zero. Used with income to size an engagement — income alone cannot distinguish a charity run by 2 staff and 90 volunteers from one with 12 staff and none |
| count_volunteers | integer |  | Yes | Volunteers reported on the annual return for this period | API | Charity Commission bulk annual return extract (Part A / Part B) | Part A. Null = not published, 0 is a filed zero |
| receives_govt_grants | boolean |  | Yes | Whether the charity reported receiving government grant funding in this period | API | Charity Commission bulk annual return extract (Part A / Part B) | Part A. Read with income_govt_grants: the flag says whether the relationship exists, the amount how big, the count how many awards |
| receives_govt_contracts | boolean |  | Yes | Whether the charity reported income from government contracts in this period | API | Charity Commission bulk annual return extract (Part A / Part B) | Part A |
| count_govt_grants | integer |  | Yes | Number of government grants reported for this period | API | Charity Commission bulk annual return extract (Part A / Part B) | Part A |
| count_govt_contracts | integer |  | Yes | Number of government contracts reported for this period | API | Charity Commission bulk annual return extract (Part A / Part B) | Part A. One large contract and fifteen small ones are different funding profiles at the same total |
| created_at | timestamp |  | No | Row creation timestamp | System | Auto-generated |  |

## GRANTS

| Field | Type | Foreign Key (Table Relation) | Nullable | Description | Collection Method | How | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| id | uuid |  | No | Primary key | System | Auto-generated on row creation |  |
| organisation_id | uuid | ORGANISATIONS | No | Organisation that received this grant | System | Set when record is created |  |
| grant_id | text |  | No | ID assigned by 360Giving | API | Pulled directly from 360Giving |  |
| funder_name | text |  | No | Name of the grant funder | API | Pulled from 360Giving |  |
| amount_awarded | numeric |  | Yes | Amount of the grant | API | Pulled from 360Giving |  |
| currency | text |  | No | Currency of the grant | API | Pulled from 360Giving | Default GBP |
| award_date | date |  | Yes | When the grant was awarded | API | Pulled from 360Giving |  |
| grant_programme | text |  | Yes | Name of the funding programme | API | Pulled from 360Giving |  |
| description | text |  | Yes | What the grant was for | API | Pulled from 360Giving |  |
| created_at | timestamp |  | No | Row creation timestamp | System | Auto-generated |  |

## ENRICHMENT_RESULTS

| Field | Type | Foreign Key (Table Relation) | Nullable | Description | Collection Method | How | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| id | uuid |  | No | Primary key | System | Auto-generated on row creation |  |
| organisation_id | uuid | ORGANISATIONS | No | Organisation this enrichment belongs to | System | Set when enrichment runs |  |
| mission_statement | text |  | Yes | Organisation's mission or purpose | LLM | Extracted from website and published materials |  |
| mission_keywords | text[] |  | Yes | Key themes extracted from the mission | LLM | Classified by LLM from mission text |  |
| news_hooks | text[] |  | Yes | Recent news items relevant to outreach | LLM | Extracted from news sources |  |
| sector | text |  | Yes | Primary sector classification | LLM | Classified from mission and activity data |  |
| sub_sector | text |  | Yes | Sub-sector classification | LLM | Classified from mission and activity data |  |
| website_url | text |  | Yes | Confirmed active website URL | API | Retrieved and verified by enrichment worker |  |
| email_validity_score | numeric |  | Yes | Confidence that contact email is valid | System | Computed by email validation service | 0.0 to 1.0 |
| social_links | jsonb |  | Yes | Social media profile URLs | API | Scraped from website or enrichment API |  |
| confidence_score | numeric |  | Yes | Overall confidence in enrichment quality | System | Computed from field coverage and source reliability | 0.0 to 1.0 |
| needs_review | boolean |  | No | Whether low-confidence fields need human review | System | Set when confidence_score falls below threshold | Default false |
| enriched_at | timestamp |  | No | When enrichment last ran for this org | System | Updated each time enrichment runs |  |
| created_at | timestamp |  | No | Row creation timestamp | System | Auto-generated |  |

## USERS

| Field | Type | Foreign Key (Table Relation) | Nullable | Description | Collection Method | How | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| id | uuid |  | No | Primary key | System | Linked to Supabase Auth user ID |  |
| email | text |  | No | User's email address | System | Set at registration via Supabase Auth |  |
| full_name | text |  | Yes | User's full name | Human | Set by user in their profile |  |
| role | enum |  | No | User's role in the platform | Human | Set by admin at invite | cam / admin / viewer |
| is_active | boolean |  | No | Whether the user can log in | System | True on activation; false if deactivated | Default true |
| invited_by_user_id | uuid | USERS | Yes | Who sent the invite | System | Set when invite is created | Null for the first admin |
| last_seen_at | timestamp |  | Yes | When the user was last active on any signed-in page — not just login | System | Updated by touch_last_seen(), throttled to once per 5 min per user, on every signed-in page load and admin API request |  |
| created_at | timestamp |  | No | Row creation timestamp | System | Auto-generated |  |
| updated_at | timestamp |  | No | Last updated timestamp | System | Auto-updated on any change | Tracks when the account was last modified, used to audit role changes, name updates, and deactivations |
| is_seed | boolean |  | No | Flag for seed data | System/Human | Set in the seed data script | False by default |
| deactivated_at | timestamp |  | Yes | When the account was deactivated | System | Set by deactivate_user; cleared on reactivation | Null on active and on merely, suspended accounts; distinguishes deactivation from suspension |
| invited_at | timestamp |  | Yes | When an admin invite created this row | System | Set by app.handle_new_auth_user from the invite's raw_user_meta_data | Null for rows not created by an invite (seed rows, first bootstrapped admin). Set with invite_accepted_at null = a pending invite |
| invite_accepted_at | timestamp |  | Yes | When the invited person first confirmed their email | System | Set by app.handle_auth_user_confirmed when email_confirmed_at goes non-null | Null while invite pending. Setting it moves the row out of the admin's pending-invites list |
| onboarding_completed_at | timestamp | 246 | Yes | When the user finished the onboarding flow | System | Set when user completes onboarding | Null until completed |
| onboarding_dismissed_at | timestamp | 246 | Yes | When the user dismissed the onboarding flow | System | Set when user dismisses onboarding | Null until dismissed |

## NOTES

| Field | Type | Foreign Key (Table Relation) | Nullable | Description | Collection Method | How | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| id | uuid |  | No | Primary key | System | Auto-generated on row creation |  |
| organisation_id | uuid | ORGANISATIONS | No | Organisation this note is about | System | Set when note is created |  |
| author_id | uuid | USERS | No | CAM who wrote the note | System | Set to logged-in user at creation |  |
| content | text |  | No | The note content | Human | Written by CAM |  |
| created_at | timestamp |  | No | Row creation timestamp | System | Auto-generated |  |
| updated_at | timestamp |  | Yes | When the note was last edited | System | Updated on edit | Null if never edited |

## ATTACHMENTS

| Field | Type | Foreign Key (Table Relation) | Nullable | Description | Collection Method | How | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| id | uuid |  | No | Primary key | System | Auto-generated on row creation |  |
| organisation_id | uuid | ORGANISATIONS | No | Client the file is attached to | System | Set when attachment is created | Deleting the organisation deletes its attachments |
| filename | text |  | No | Original file name shown in the list | Human | From the uploaded file | Cannot be blank |
| storage_path | text |  | No | Path inside the private client-attachments Storage bucket | System | Generated at upload time | Not a URL — never store signed URLs |
| content_type | text |  | Yes | MIME type of the file | System | Detected at upload time |  |
| size_bytes | bigint |  | Yes | File size in bytes | System | From the upload metadata | Must be ≥ 0 if present |
| uploaded_by | uuid | USERS | Yes | Team member who attached the file | System | Set to logged-in user at creation | Nullable — a future automated import may have no human uploader (F081 decides) |
| timeline_context_type | text |  | No | Timeline source this file belongs to | System | Set to client for a general upload or to the linked event type | client, note, outreach_message, reply_event, or audit_log |
| timeline_context_id | uuid |  | Yes | Stable ID of the linked timeline source | System | Set when the attachment is linked to a specific event | Null only for a client-level File shared event |

## TAGS

| Field | Type | Foreign Key (Table Relation) | Nullable | Description | Collection Method | How | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| id | uuid |  | No | Primary key | System | Auto-generated on row creation |  |
| name | text |  | No | Tag label | Human | Created by CAM or admin | Must be unique |
| colour | text |  | Yes | Hex colour for display in the UI | Human | Chosen by CAM or admin |  |
| created_by_user_id | uuid | USERS | No | Who created the tag | System | Set to logged-in user |  |
| created_at | timestamp |  | No | Row creation timestamp | System | Auto-generated |  |

## ORG_TAGS

| Field | Type | Foreign Key (Table Relation) | Nullable | Description | Collection Method | How | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| id | uuid |  | No | Primary key | System | Auto-generated on row creation |  |
| organisation_id | uuid | ORGANISATIONS | No | Organisation being tagged | System | Set when tag is applied |  |
| tag_id | uuid | TAGS | No | Tag being applied | System | Set when tag is applied |  |
| added_by_user_id | uuid | USERS | No | Who applied the tag | System | Set to logged-in user |  |
| created_at | timestamp |  | No | Row creation timestamp | System | Auto-generated |  |

## ACTIONS

| Field | Type | Foreign Key (Table Relation) | Nullable | Description | Collection Method | How | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| id | uuid |  | No | Primary key | System | Auto-generated on row creation |  |
| organisation_id | uuid | ORGANISATIONS | No | Client this action belongs to | System | Set when the action is created | Deleting the organisation deletes its actions |
| assignee_user_id | uuid | USERS | Yes | CAM responsible for doing the action | Human | Set at creation; changed only by the F257 reassignment RPC | Null if the assignee's account row is deleted |
| created_by_user_id | uuid | USERS | Yes | Who created the action | System | Set to logged-in user at creation | Null if the creator's account row is deleted |
| title | text |  | No | Short description of the work | Human | Typed by CAM or admin |  |
| description | text |  | Yes | Longer detail | Human | Typed by CAM or admin |  |
| due_date | date |  | Yes | When the action is due | Human | Chosen by CAM or admin | Drives the F172 overdue warning |
| remind_at | timestamp |  | Yes | When to remind the assignee | Human | Chosen by CAM or admin | A reminder is a field on the action, not a separate table |
| status | enum |  | No | open, completed, cancelled | System | open at creation; changed by CAM or admin |  |
| completed_at | timestamp |  | Yes | When the action was marked complete | System | Set when status becomes completed | Null while open or cancelled |
| is_seed | boolean |  | No | Marks a row created by the seed script | System | Set by scripts/seed.mts | Mirrors ORGANISATIONS.is_seed |
| created_at | timestamp |  | No | Row creation timestamp | System | Auto-generated |  |
| updated_at | timestamp |  | No | Last edit timestamp | System | Updated on edit |  |

## USER_ONBOARDING_STEPS

| Field | Type | Foreign Key (Table Relation) | Nullable | Description | Collection Method | How | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| user_id | uuid | USERS | No | User completing the step | System | Set when step is completed | 246 |
| step_key | text | 246 | No | Key of the onboarding step | System | Set when step is completed | 246 |
| completed_at | timestamp | 246 | No | When the step was completed | System | Auto-generated | 246 |

## OUTREACH_PREFERENCES

| Field | Type | Foreign Key (Table Relation) | Nullable | Description | Collection Method | How | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| id | uuid |  | No | Primary key | System | Auto-generated |  |
| user_id | uuid | USERS | No | CAM these preferences belong to | System | Set on save | One row per user (unique) |
| preferred_geographic_reach | enum[] |  | No | Subset of geographic_reach values the CAM wants prioritised | Human | Chosen by CAM in settings | Same enum as ORGANISATIONS.geographic_reach; empty array = no preference set |
| preferred_cities | text[] |  |  |  |  |  |  |
| preferred_sectors | text[] |  | No | Sector values to prioritise | Human | Chosen by CAM in settings | Free text, matched against ORGANISATIONS.sector; empty array = no preference set |
| preferred_income_bands | enum[] |  | No | Subset of income_band values to prioritise | Human | Chosen by CAM in settings | Same enum as FINANCIAL_PERIODS.income_band; empty array = no preference set |
| prioritise_grant_recipients | boolean |  |  |  |  |  |  |
| created_at | timestamp |  | No | Row creation timestamp | System | Auto-generated |  |
| updated_at | timestamp |  | No | Last edit timestamp | System | Updated on save |  |

## SUPPRESSIONS

| Field | Type | Foreign Key (Table Relation) | Nullable | Description | Collection Method | How | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| id | uuid |  | No | Primary key | System | Auto-generated |  |
| organisation_id | uuid | ORGANISATIONS | No | Charity being suppressed | System | Set by request_suppression RPC | On delete cascade |
| status | enum |  | No | pending, active, rejected, lifted | System | pending or active at creation; active -> lifted is F185 |  |
| reason | text |  | No | Why suppression was requested | Human | Typed by CAM or admin | Required, cannot be blank |
| requested_by | uuid | USERS | No | Who requested/triggered it | System | auth.uid() at request time | Equals decided_by when an admin suppresses directly (self-approved, no pending step) |
| decided_by | uuid | USERS | Yes | Admin who approved/rejected | System | Set by decide_suppression_request | Null while pending |
| decided_at | timestamp |  | Yes | When decided | System | Set by decide_suppression_request | Null while pending |
| decision_note | text |  | Yes | Optional admin note on the decision | Human | Typed by admin |  |
| created_at | timestamp |  | No | Row creation timestamp | System | Auto-generated |  |

## SAVED_VIEWS

| Field | Type | Foreign Key (Table Relation) | Nullable | Description | Collection Method | How | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| id | uuid |  | No | Primary key | System | Auto-generated |  |
| user_id | uuid | USERS | No | CAM the saved view belongs to | System | auth.uid() at save time | On delete cascade; a view is private to its owner |
| name | text |  | No | Name the CAM gave the view | Human | Typed by CAM when saving | Required, cannot be blank; unique per user |
| filters | jsonb |  | No | The client-list filter combination the view re-applies | System | Captured from the active list filters at save time | Keys mirror /clients search params: q, city, country, status, type, owner — arrays for the multi-selects. jsonb rather than columns because the filter set grows |
| created_at | timestamp |  | No | Row creation timestamp | System | Auto-generated |  |
| updated_at | timestamp |  | No | Last edit timestamp | System | Updated when the view is renamed or re-saved | Rename/overwrite is not built by F066; column exists so adding it later needs no schema change |

## OWNERSHIP_REQUESTS

| Field | Type | Foreign Key (Table Relation) | Nullable | Description | Collection Method | How | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| id | uuid |  | No | Primary key |  |  | Auto-generated |
| organisation_id | uuid | ORGANISATIONS | No | Client being asked for |  |  | On delete cascade |
| requested_by | uuid | USERS | No | CAM making the ask |  |  | auth.uid() at request time |
| current_owner_id | uuid | USERS | Yes | Owner at request time, snapshotted |  |  | Live owner can change while pending; admin needs to see what the CAM saw |
| status | enum |  | No | pending, approved, rejected |  |  | pending at creation; only an admin moves it |
| reason | text |  | No | Why this CAM should take it on |  |  | Required, cannot be blank |
| decided_by | uuid | USERS | Yes | Admin who approved/rejected |  |  | Null while pending |
| decided_at | timestamp |  | Yes | When decided |  |  | Null while pending |
| decision_note | text |  | Yes | Optional admin note |  |  | Only reason is mandatory |
| created_at | timestamp |  | No | Row creation timestamp |  |  | Auto-generated |

## NOTIFICATIONS

| Field | Type | Foreign Key (Table Relation) | Nullable | Description | Collection Method | How | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| id | uuid |  | No | Primary key | System | Auto-generated on row creation |  |
| recipient_user_id | uuid | USERS | No | User the notification is for | System | Set when the triggering event creates the row | Wrong-recipient prevention relies on this + RLS |
| actor_user_id | uuid | USERS | Yes | User whose action triggered the notification | System | Set by the creating code path when human-triggered | Null for system/scheduled reminders |
| notification_type | enum |  | No | What kind of notification | System | Set when created | reply_received / reminder / team_activity / ownership_change / data_quality — extensible via migration |
| title | text |  | No | Short headline shown in the bell panel | System | Set when created |  |
| body | text |  | Yes | Optional longer description | System | Set when created |  |
| link_path | text |  | Yes | In-app route to navigate to on click | System | Set when created | e.g. /clients/{id} — drives linked-record navigation AC |
| target_table | text |  | Yes | Table of the linked record | System | Set when created | For future deep-linking/filtering |
| target_id | uuid |  | Yes | ID of the linked record | System | Set when created |  |
| read_at | timestamp |  | Yes | When the recipient marked it read | Human/System | Set by mark-as-read RPC; auto-set on click-open | Null = unread. Included now so F177 needs no second migration |
| created_at | timestamp |  | No | Row creation timestamp | System | Auto-generated |  |

## BOOKLET_GENERATIONS

| Field | Type | Foreign Key (Table Relation) | Nullable | Description | Collection Method | How | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| id | uuid |  | No | Primary key | System | Auto-generated on row creation |  |
| organisation_id | uuid | ORGANISATIONS | No | Organisation this booklet belongs to | System | Set when generated | On delete cascade. Index (organisation_id, created_at desc) |
| generated_by | uuid | USERS | No | User who generated the booklet | System | Set to logged-in user |  |
| prompt_system | text |  | No | System prompt used | System | Set when generated |  |
| prompt_user | text |  | No | User prompt used | System | Set when generated |  |
| output | text |  | No | Generated output | System | Set when generated |  |
| model | text |  | No | Model used for generation | System | Set when generated | Snapshotted at generation time; used with MODEL_PRICING to compute cost |
| activity | text |  | Yes | Activity identifier for observability | System | Set when generated |  |
| input_tokens | integer |  | Yes | Prompt tokens the AI provider reported for this call | System | Taken from the provider's API response | Blank when the provider reports nothing — never filled with 0 |
| output_tokens | integer |  | Yes | Response tokens the provider reported | System | Taken from the provider's API response | Same rule as above |
| total_tokens | integer |  | Yes | Total tokens as the provider reported them | System | Taken from the provider's API response | Stored as reported, may differ slightly from input + output |
| cost_usd | decimal(12,6) |  | Yes | Cost in US dollars, priced at generation time | System | Computed against MODEL_PRICING when the booklet is generated | Blank = unknown cost (no price configured yet); never 0 |
| created_at | timestamptz |  | No | Row creation timestamp | System | Auto-generated | Default now(). Append-only. |

## EDIT_SUGGESTIONS

| Field | Type | Foreign Key (Table Relation) | Nullable | Description | Collection Method | How | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| id | uuid |  | No | Primary key | System | Auto-generated on row creation |  |
| organisation_id | uuid | ORGANISATIONS | No | Client the correction is about | System | Set when correction is proposed |  |
| field_name | text |  | No | One of the six sensitive fields | System | Set when correction is proposed |  |
| current_value | text |  | Yes | Value at proposal time, captured server-side | System | Captured server-side at proposal time |  |
| proposed_value | text |  | No | The CAM's corrected value | Human | Proposed by CAM |  |
| status | enum |  | No | pending, approved, rejected, superseded | System | pending at creation; updated by admin decision or superseded |  |
| requested_by | uuid | USERS | No | CAM making the proposal | System | auth.uid() at request time |  |
| superseded_by | uuid | EDIT_SUGGESTIONS | Yes | Newer suggestion that replaced this one | System | Set when a new suggestion for the same field is made |  |
| decided_by | uuid | USERS | Yes | Admin who approved/rejected | System | Set by decide_edit_suggestion | Null while pending |
| decided_at | timestamp |  | Yes | When decided | System | Set by decide_edit_suggestion | Null while pending |
| rejection_reason | text |  | Yes | Optional admin note for the CAM | Human | Typed by admin |  |
| created_at | timestamp |  | No | Row creation timestamp | System | Auto-generated |  |
| updated_at | timestamp |  | No | Last edit timestamp | System | Updated on edit |  |

## RESTRICTED_EDIT_FIELDS

| Field | Type | Foreign Key (Table Relation) | Nullable | Description | Collection Method | How | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| id | uuid |  | No | Primary key | System | Auto-generated on row creation |  |
| field_name | text |  | No | An ORGANISATIONS column CAMs may not write directly | System | Seeded (six) or set by add_restricted_edit_field | Unique — FK target for EDIT_SUGGESTIONS.field_name and the trigger's loop key |
| active | boolean |  | No | False = retired: not enforced, not suggestible, row kept | Human | Set by deactivate_restricted_edit_field | Never delete; history and FK survive |
| reason | text |  | No | Why the field is restricted | Human | Typed by the admin adding it | Shown in the admin panel |
| added_by | uuid | USERS | Yes | Admin who added/re-added the restriction | System | auth.uid() at add time | Null for the system-seeded six |
| created_at | timestamp |  | No | Row creation timestamp | System | Auto-generated |  |

## AI_GENERATIONS

| Field | Type | Foreign Key (Table Relation) | Nullable | Description | Collection Method | How | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| id | uuid |  | No | Primary key | System | Auto-generated on row creation |  |
| outreach_message_id | uuid | OUTREACH_MESSAGES | No | The message this generation produced | System | Set when an outreach draft is generated | Deleted with its message |
| generated_subject | text |  | Yes | AI-drafted email subject line | System | Generated by the LLM at generation time |  |
| generated_body | text |  | Yes | AI-drafted email body | System | Generated by the LLM at generation time |  |
| cam_edited | boolean |  | No | Whether the CAM edited the draft before use | System | Set when the CAM saves changes | Defaults to false |
| edit_distance | integer |  | Yes | How far the CAM's final version moved from the raw draft | System | Computed when the CAM saves | Zero or more |
| model | text |  | No | Which specific AI model produced this draft | System | Snapshotted from app configuration at generation time | Historical rows keep the model that actually ran, never the current default |
| activity | text |  | Yes | Activity identifier for observability | System | Set when generated |  |
| input_tokens | integer |  | Yes | Prompt tokens the AI provider reported for this AI generation | System | Taken from the provider's API response | Blank when the provider reports nothing — never filled with 0 |
| output_tokens | integer |  | Yes | Response tokens the provider reported for this AI generation | System | Taken from the provider's API response | Same rule as above |
| total_tokens | integer |  | Yes | Total tokens as the provider reported them for this AI generation | System | Taken from the provider's API response | Stored as reported, may differ slightly from input + output |
| cost_usd | decimal(12,6) |  | Yes | Cost in US dollars for this AI generation, priced at generation time | System | Computed against MODEL_PRICING when the draft is generated | Blank = unknown cost (no price configured yet); never 0 |
| prompt_system | text |  | No | Exact system instruction sent to the model | System | Captured verbatim when the draft is generated | Constant today, but stored per row so a future edit never rewrites what an older row says was sent |
| prompt_user | text |  | No | Exact user-turn prompt sent to the model | System | Built from client context when the draft is generated |  |
| created_at | timestamp |  | No | Row creation timestamp | System | Auto-generated |  |

## MODEL_PRICING

| Field | Type | Foreign Key (Table Relation) | Nullable | Description | Collection Method | How | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| id | uuid |  | No | Primary key | System | Auto-generated on row creation |  |
| model | text |  | No | AI model name this price applies to | Human | Entered by an admin directly in the database | One row per model (unique) |
| input_usd_per_1k_tokens | decimal(12,6) |  | No | US dollars per 1,000 prompt tokens | Human | Copied from the provider's official pricing page by whoever owns billing | Zero or more |
| output_usd_per_1k_tokens | decimal(12,6) |  | No | US dollars per 1,000 response tokens | Human | Same as above | Zero or more |
| created_at | timestamp |  | No | Row creation timestamp | System | Auto-generated |  |
| updated_at | timestamp |  | No | Last time the rate changed | System | Auto-updated on change |  |

## IMPORT_FILTER_PRESETS

| Field | Type | Foreign Key (Table Relation) | Nullable | Description | Collection Method | How | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| id | uuid |  | No | Primary key | System | Auto-generated on row creation (gen_random_uuid()) | PK, gen_random_uuid(). RLS: enabled, no policies (service-role only). Purpose: saved import criteria — "Sheffield arts, any size" — so a cycle's selection is repeatable. |
| name | text |  | No | Filter preset name | Human | Typed by user when saving preset | Must not be blank; unique per source, case-insensitive |
| description | text |  | Yes | Filter preset description | Human / System | Entered by user or defaults to filter set written out in words | Defaults to the filter set written out in words |
| filters | jsonb |  | No | Saved filter criteria | System | Captured from active filter criteria at save time | Validated in TypeScript, not by constraint |
| source | text |  | No | Data source the preset applies to | Human / System | Selected data source (default 'charity_commission') | Default 'charity_commission' |
| created_by_user_id | uuid | USERS | Yes | User who created the preset | System | auth.uid() at save time | FK → users.id, ON DELETE SET NULL |
| created_at | timestamptz |  | No | Row creation timestamp | System | Auto-generated (now()) | now() |
| updated_at | timestamptz |  | No | Last updated timestamp | System | Auto-updated on change (now()) | now() |
