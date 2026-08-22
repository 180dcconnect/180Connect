<!--
  GENERATED FILE — DO NOT EDIT.
  Source: ~/Downloads/Data Model.xlsx (the Data Model spreadsheet is the source of truth, per SOP §7).
  To change anything here: edit the spreadsheet, then run `npm run export:data-model`.
-->

# 02 Data Dictionary

## 02 Data Dictionary: every field across all tabs (auto-compiled 12 Jul 2026; descriptions blank where the source tab has none)

| Tab | Table | Field | Type | Foreign key to | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 03 Raw Data | INGESTION_RUNS | id | uuid |  |  |
| 03 Raw Data | INGESTION_RUNS | api_source | enum |  |  |
| 03 Raw Data | INGESTION_RUNS | triggered_by | enum |  |  |
| 03 Raw Data | INGESTION_RUNS | triggered_by_user_id | uuid | USERS |  |
| 03 Raw Data | INGESTION_RUNS | started_at | timestamp |  |  |
| 03 Raw Data | INGESTION_RUNS | completed_at | timestamp |  |  |
| 03 Raw Data | INGESTION_RUNS | job_status | enum |  |  |
| 03 Raw Data | INGESTION_RUNS | records_fetched | int |  |  |
| 03 Raw Data | INGESTION_RUNS | records_inserted | int |  |  |
| 03 Raw Data | INGESTION_RUNS | records_skipped | int |  |  |
| 03 Raw Data | INGESTION_RUNS | records_failed | int |  |  |
| 03 Raw Data | INGESTION_RUNS | error_message | text |  |  |
| 03 Raw Data | INGESTION_RUNS | created_at | timestamp |  |  |
| 03 Raw Data | RAW_SOURCE_RECORDS | id | uuid |  |  |
| 03 Raw Data | RAW_SOURCE_RECORDS | ingestion_run_id | uuid | INGESTION_RUNS |  |
| 03 Raw Data | RAW_SOURCE_RECORDS | record_source | enum |  |  |
| 03 Raw Data | RAW_SOURCE_RECORDS | source_record_id | text |  |  |
| 03 Raw Data | RAW_SOURCE_RECORDS | raw_payload | jsonb |  |  |
| 03 Raw Data | RAW_SOURCE_RECORDS | received_at | timestamp |  |  |
| 03 Raw Data | RAW_SOURCE_RECORDS | processing_status | enum |  |  |
| 03 Raw Data | RAW_SOURCE_RECORDS | matched_organisation_id | uuid | ORGANISATIONS |  |
| 03 Raw Data | RAW_SOURCE_RECORDS | checksum | text |  |  |
| 03 Raw Data | RAW_SOURCE_RECORDS | source_last_modified | timestamp |  |  |
| 03 Raw Data | RAW_SOURCE_RECORDS | ingestion_attempt | int |  |  |
| 03 Raw Data | RAW_SOURCE_RECORDS | created_at | timestamp |  |  |
| 03 Raw Data | RAW_SOURCE_RECORDS | source_country | text |  |  |
| 03 Raw Data | RAW_SOURCE_RECORDS | source_registry_name | text |  |  |
| 03 Raw Data | DATA_QUALITY_EVENTS | id | uuid |  |  |
| 03 Raw Data | DATA_QUALITY_EVENTS | raw_source_record_id | uuid | RAW_SOURCE_RECORDS |  |
| 03 Raw Data | DATA_QUALITY_EVENTS | rule_name | text |  |  |
| 03 Raw Data | DATA_QUALITY_EVENTS | rule_category | enum |  |  |
| 03 Raw Data | DATA_QUALITY_EVENTS | field_name | text |  |  |
| 03 Raw Data | DATA_QUALITY_EVENTS | field_value | text | Yes |  |
| 03 Raw Data | DATA_QUALITY_EVENTS | severity | enum |  |  |
| 03 Raw Data | DATA_QUALITY_EVENTS | suggested_fix | text | Yes |  |
| 03 Raw Data | DATA_QUALITY_EVENTS | auto_resolved | boolean |  |  |
| 03 Raw Data | DATA_QUALITY_EVENTS | resolved | boolean |  |  |
| 03 Raw Data | DATA_QUALITY_EVENTS | resolved_at | timestamp |  |  |
| 03 Raw Data | DATA_QUALITY_EVENTS | resolved_by_user_id | uuid | USERS |  |
| 03 Raw Data | DATA_QUALITY_EVENTS | rule_version | text |  |  |
| 03 Raw Data | DATA_QUALITY_EVENTS | created_at | timestamp |  |  |
| 03 Raw Data | ENTITY_MATCH_CANDIDATES | id | uuid |  |  |
| 03 Raw Data | ENTITY_MATCH_CANDIDATES | raw_source_record_id | uuid | RAW_SOURCE_RECORDS |  |
| 03 Raw Data | ENTITY_MATCH_CANDIDATES | candidate_organisation_id | uuid | ORGANISATIONS |  |
| 03 Raw Data | ENTITY_MATCH_CANDIDATES | match_score | float |  |  |
| 03 Raw Data | ENTITY_MATCH_CANDIDATES | match_method | enum |  |  |
| 03 Raw Data | ENTITY_MATCH_CANDIDATES | match_fields | jsonb |  |  |
| 03 Raw Data | ENTITY_MATCH_CANDIDATES | llm_reasoning | text | Yes |  |
| 03 Raw Data | ENTITY_MATCH_CANDIDATES | duplicate_group_id | uuid |  |  |
| 03 Raw Data | ENTITY_MATCH_CANDIDATES | source_priority | int |  |  |
| 03 Raw Data | ENTITY_MATCH_CANDIDATES | match_status | enum |  |  |
| 03 Raw Data | ENTITY_MATCH_CANDIDATES | reviewed_by_user_id | uuid | USERS |  |
| 03 Raw Data | ENTITY_MATCH_CANDIDATES | reviewed_at | timestamp |  |  |
| 03 Raw Data | ENTITY_MATCH_CANDIDATES | notes | text |  |  |
| 03 Raw Data | ENTITY_MATCH_CANDIDATES | created_at | timestamp |  |  |
| 03 Raw Data | MANUAL_ENTRY_RECORDS | id | uuid |  |  |
| 03 Raw Data | MANUAL_ENTRY_RECORDS | submitted_by_user_id | uuid | USERS |  |
| 03 Raw Data | MANUAL_ENTRY_RECORDS | legal_name | text |  |  |
| 03 Raw Data | MANUAL_ENTRY_RECORDS | country_code | text |  |  |
| 03 Raw Data | MANUAL_ENTRY_RECORDS | website | text |  |  |
| 03 Raw Data | MANUAL_ENTRY_RECORDS | contact_email | text |  |  |
| 03 Raw Data | MANUAL_ENTRY_RECORDS | registry_name | text |  |  |
| 03 Raw Data | MANUAL_ENTRY_RECORDS | registry_number | text |  |  |
| 03 Raw Data | MANUAL_ENTRY_RECORDS | reason_for_manual_entry | text |  |  |
| 03 Raw Data | MANUAL_ENTRY_RECORDS | converted_to_organisation_id | uuid | ORGANISATIONS |  |
| 03 Raw Data | MANUAL_ENTRY_RECORDS | review_status | enum |  |  |
| 03 Raw Data | MANUAL_ENTRY_RECORDS | reviewed_by_user_id | uuid | USERS |  |
| 03 Raw Data | MANUAL_ENTRY_RECORDS | reviewed_at | timestamp |  |  |
| 03 Raw Data | MANUAL_ENTRY_RECORDS | review_notes | text |  |  |
| 03 Raw Data | MANUAL_ENTRY_RECORDS | created_at | timestamp |  |  |
| 03 Raw Data | MANUAL_ENTRY_RECORDS | updated_at | timestamp |  |  |
| 03 Raw Data | MANUAL_ENTRY_RECORDS | source_url | text |  | Source URL for the manual entry |
| 03 Raw Data | MANUAL_ENTRY_RECORDS | imported_field_paths | jsonb |  | Paths of imported fields |
| 03 Raw Data | MANUAL_ENTRY_RECORDS | import_notes | jsonb |  | Notes about the import |
| 03 Raw Data | MANUAL_ENTRY_RECORDS | import_raw_record_id | uuid | RAW_SOURCE_RECORDS | Raw record ID for the import |
| 04 Entities | ORGANISATIONS | id | uuid |  |  |
| 04 Entities | ORGANISATIONS | legal_name | text |  |  |
| 04 Entities | ORGANISATIONS | trading_name | text |  |  |
| 04 Entities | ORGANISATIONS | country_code | text |  |  |
| 04 Entities | ORGANISATIONS | is_international | boolean |  |  |
| 04 Entities | ORGANISATIONS | entry_method | enum |  |  |
| 04 Entities | ORGANISATIONS | is_verified | boolean |  |  |
| 04 Entities | ORGANISATIONS | organisation_type | enum |  |  |
| 04 Entities | ORGANISATIONS | website | text |  |  |
| 04 Entities | ORGANISATIONS | contact_email | text |  |  |
| 04 Entities | ORGANISATIONS | address_line_1 | text |  |  |
| 04 Entities | ORGANISATIONS | city | text |  |  |
| 04 Entities | ORGANISATIONS | postcode | text |  |  |
| 04 Entities | ORGANISATIONS | geographic_reach | enum |  |  |
| 04 Entities | ORGANISATIONS | outreach_status | enum |  |  |
| 04 Entities | ORGANISATIONS | last_reply_sentiment | enum |  |  |
| 04 Entities | ORGANISATIONS | last_reply_intent | enum |  |  |
| 04 Entities | ORGANISATIONS | data_completeness_score | numeric |  |  |
| 04 Entities | ORGANISATIONS | owner_id | uuid | USERS |  |
| 04 Entities | ORGANISATIONS | created_at | timestamp |  |  |
| 04 Entities | ORGANISATIONS | updated_at | timestamp |  |  |
| 04 Entities | ORGANISATIONS | is_seed | boolean |  |  |
| 04 Entities | ORGANISATION_IDENTIFIERS | id | uuid |  |  |
| 04 Entities | ORGANISATION_IDENTIFIERS | organisation_id | uuid |  | ORGANISATIONS |
| 04 Entities | ORGANISATION_IDENTIFIERS | identifier_type | enum |  |  |
| 04 Entities | ORGANISATION_IDENTIFIERS | identifier_value | text |  |  |
| 04 Entities | ORGANISATION_IDENTIFIERS | registry_name | text |  |  |
| 04 Entities | ORGANISATION_IDENTIFIERS | registry_country | text |  |  |
| 04 Entities | ORGANISATION_IDENTIFIERS | is_primary | boolean |  |  |
| 04 Entities | ORGANISATION_IDENTIFIERS | verified | boolean |  |  |
| 04 Entities | ORGANISATION_IDENTIFIERS | verified_by_user_id | uuid |  | USERS |
| 04 Entities | ORGANISATION_IDENTIFIERS | verified_at | timestamp |  |  |
| 04 Entities | ORGANISATION_IDENTIFIERS | created_at | timestamp |  |  |
| 04 Entities | CONTACTS | id | uuid |  |  |
| 04 Entities | CONTACTS | organisation_id | uuid | ORGANISATIONS |  |
| 04 Entities | CONTACTS | first_name | text |  |  |
| 04 Entities | CONTACTS | last_name | text |  |  |
| 04 Entities | CONTACTS | email | text |  |  |
| 04 Entities | CONTACTS | phone | text |  |  |
| 04 Entities | CONTACTS | job_title | text |  |  |
| 04 Entities | CONTACTS | is_primary | boolean |  |  |
| 04 Entities | CONTACTS | contact_source | enum |  |  |
| 04 Entities | CONTACTS | created_at | timestamp |  |  |
| 04 Entities | CONTACTS | updated_at | timestamp |  |  |
| 04 Entities | FINANCIAL_PERIODS | id | uuid |  |  |
| 04 Entities | FINANCIAL_PERIODS | organisation_id | uuid | ORGANISATIONS |  |
| 04 Entities | FINANCIAL_PERIODS | period_start | date |  |  |
| 04 Entities | FINANCIAL_PERIODS | period_end | date |  |  |
| 04 Entities | FINANCIAL_PERIODS | total_income | numeric |  |  |
| 04 Entities | FINANCIAL_PERIODS | total_expenditure | numeric |  |  |
| 04 Entities | FINANCIAL_PERIODS | income_band | enum |  |  |
| 04 Entities | FINANCIAL_PERIODS | filing_date | date |  |  |
| 04 Entities | FINANCIAL_PERIODS | financial_source | enum |  |  |
| 04 Entities | FINANCIAL_PERIODS | created_at | timestamp |  |  |
| 04 Entities | GRANTS | id | uuid |  |  |
| 04 Entities | GRANTS | organisation_id | uuid | ORGANISATIONS |  |
| 04 Entities | GRANTS | grant_id | text |  |  |
| 04 Entities | GRANTS | funder_name | text |  |  |
| 04 Entities | GRANTS | amount_awarded | numeric |  |  |
| 04 Entities | GRANTS | currency | text |  |  |
| 04 Entities | GRANTS | award_date | date |  |  |
| 04 Entities | GRANTS | grant_programme | text |  |  |
| 04 Entities | GRANTS | description | text |  |  |
| 04 Entities | GRANTS | created_at | timestamp |  |  |
| 04 Entities | ENRICHMENT_RESULTS | id | uuid |  |  |
| 04 Entities | ENRICHMENT_RESULTS | organisation_id | uuid | ORGANISATIONS |  |
| 04 Entities | ENRICHMENT_RESULTS | mission_statement | text |  |  |
| 04 Entities | ENRICHMENT_RESULTS | mission_keywords | text[] |  |  |
| 04 Entities | ENRICHMENT_RESULTS | news_hooks | text[] |  |  |
| 04 Entities | ENRICHMENT_RESULTS | sector | text |  |  |
| 04 Entities | ENRICHMENT_RESULTS | sub_sector | text |  |  |
| 04 Entities | ENRICHMENT_RESULTS | website_url | text |  |  |
| 04 Entities | ENRICHMENT_RESULTS | email_validity_score | numeric |  |  |
| 04 Entities | ENRICHMENT_RESULTS | social_links | jsonb |  |  |
| 04 Entities | ENRICHMENT_RESULTS | confidence_score | numeric |  |  |
| 04 Entities | ENRICHMENT_RESULTS | needs_review | boolean |  |  |
| 04 Entities | ENRICHMENT_RESULTS | enriched_at | timestamp |  |  |
| 04 Entities | ENRICHMENT_RESULTS | created_at | timestamp |  |  |
| 04 Entities | USERS | id | uuid |  |  |
| 04 Entities | USERS | email | text |  |  |
| 04 Entities | USERS | full_name | text |  |  |
| 04 Entities | USERS | role | enum |  |  |
| 04 Entities | USERS | is_active | boolean |  |  |
| 04 Entities | USERS | invited_by_user_id | uuid | USERS |  |
| 04 Entities | USERS | last_seen_at | timestamp |  | When the user was last active on any signed-in page — not just login |
| 04 Entities | USERS | created_at | timestamp |  |  |
| 04 Entities | USERS | updated_at | timestamp |  |  |
| 04 Entities | USERS | is_seed | boolean |  |  |
| 04 Entities | USERS | deactivated_at | timestamp |  |  |
| 04 Entities | USERS | invited_at | timestamp |  |  |
| 04 Entities | USERS | invite_accepted_at | timestamp |  |  |
| 04 Entities | USERS | onboarding_completed_at | timestamp |  | When the user finished the onboarding flow |
| 04 Entities | USERS | onboarding_dismissed_at | timestamp |  | When the user dismissed the onboarding flow |
| 04 Entities | USER_ONBOARDING_STEPS | user_id | uuid | USERS | User completing the step |
| 04 Entities | USER_ONBOARDING_STEPS | step_key | text |  | Key of the onboarding step |
| 04 Entities | USER_ONBOARDING_STEPS | completed_at | timestamp |  | When the step was completed |
| 04 Entities | NOTES | id | uuid |  |  |
| 04 Entities | NOTES | organisation_id | uuid | ORGANISATIONS |  |
| 04 Entities | NOTES | author_id | uuid | USERS |  |
| 04 Entities | NOTES | content | text |  |  |
| 04 Entities | NOTES | created_at | timestamp |  |  |
| 04 Entities | NOTES | updated_at | timestamp |  |  |
| 04 Entities | TAGS | id | uuid |  |  |
| 04 Entities | TAGS | name | text |  |  |
| 04 Entities | TAGS | colour | text |  |  |
| 04 Entities | TAGS | created_by_user_id | uuid | USERS |  |
| 04 Entities | TAGS | created_at | timestamp |  |  |
| 04 Entities | ORG_TAGS | id | uuid |  |  |
| 04 Entities | ORG_TAGS | organisation_id | uuid | ORGANISATIONS |  |
| 04 Entities | ORG_TAGS | tag_id | uuid | TAGS |  |
| 04 Entities | ORG_TAGS | added_by_user_id | uuid | USERS |  |
| 04 Entities | ORG_TAGS | created_at | timestamp |  |  |
| 04 Entities | ACTIONS | id | uuid |  | Primary key |
| 04 Entities | ACTIONS | organisation_id | uuid | ORGANISATIONS | Client this action belongs to |
| 04 Entities | ACTIONS | assignee_user_id | uuid | USERS | CAM responsible for doing the action |
| 04 Entities | ACTIONS | created_by_user_id | uuid | USERS | Who created the action |
| 04 Entities | ACTIONS | title | text |  | Short description of the work |
| 04 Entities | ACTIONS | description | text |  | Longer detail |
| 04 Entities | ACTIONS | due_date | date |  | When the action is due |
| 04 Entities | ACTIONS | remind_at | timestamp |  | When to remind the assignee |
| 04 Entities | ACTIONS | status | enum |  | open, completed, cancelled |
| 04 Entities | ACTIONS | completed_at | timestamp |  | When the action was marked complete |
| 04 Entities | ACTIONS | is_seed | boolean |  | Marks a row created by the seed script |
| 04 Entities | ACTIONS | created_at | timestamp |  | Row creation timestamp |
| 04 Entities | ACTIONS | updated_at | timestamp |  | Last edit timestamp |
| 04 Entities | OUTREACH_PREFERENCES | id | uuid |  | Primary key |
| 04 Entities | OUTREACH_PREFERENCES | user_id | uuid | USERS | CAM these preferences belong to |
| 04 Entities | OUTREACH_PREFERENCES | preferred_geographic_reach | enum[] |  | Subset of geographic_reach values the CAM wants prioritised |
| 04 Entities | OUTREACH_PREFERENCES | preferred_cities | text[] |  | City/location values to prioritise, matched against ORGANISATIONS.city |
| 04 Entities | OUTREACH_PREFERENCES | preferred_sectors | text[] |  | Sector values to prioritise, matched against ORGANISATIONS.sector |
| 04 Entities | OUTREACH_PREFERENCES | preferred_income_bands | enum[] |  | Subset of income_band values to prioritise |
| 04 Entities | OUTREACH_PREFERENCES | prioritise_grant_recipients | boolean |  | Prioritise organisations with previous grant/funding history (360Giving) |
| 04 Entities | OUTREACH_PREFERENCES | created_at | timestamp |  | Row creation timestamp |
| 04 Entities | OUTREACH_PREFERENCES | updated_at | timestamp |  | Last edit timestamp |
| 04 Entities | SUPPRESSIONS | id | uuid |  | Primary key |
| 04 Entities | SUPPRESSIONS | organisation_id | uuid | ORGANISATIONS | Charity being suppressed |
| 04 Entities | SUPPRESSIONS | status | enum |  | pending, active, rejected, lifted |
| 04 Entities | SUPPRESSIONS | reason | text |  | Why suppression was requested; required |
| 04 Entities | SUPPRESSIONS | requested_by | uuid | USERS | Who requested/triggered the suppression |
| 04 Entities | SUPPRESSIONS | decided_by | uuid | USERS | Admin who approved/rejected; null while pending |
| 04 Entities | SUPPRESSIONS | decided_at | timestamp |  | When decided; null while pending |
| 04 Entities | SUPPRESSIONS | decision_note | text |  | Optional admin note on the decision |
| 04 Entities | SUPPRESSIONS | created_at | timestamp |  | Row creation timestamp |
| 04 Entities | SAVED_VIEWS | id | uuid |  | Primary key |
| 04 Entities | SAVED_VIEWS | user_id | uuid | USERS | CAM the saved view belongs to |
| 04 Entities | SAVED_VIEWS | name | text |  | Name the CAM gave the view; unique per user |
| 04 Entities | SAVED_VIEWS | filters | jsonb |  | Filter combination the view re-applies (q, city, country, status, type, owner — arrays for the multi-selects) |
| 04 Entities | SAVED_VIEWS | created_at | timestamp |  | Row creation timestamp |
| 04 Entities | SAVED_VIEWS | updated_at | timestamp |  | Last edit timestamp |
| 04 Entities | OWNERSHIP_REQUESTS | id | uuid |  | Primary key |
| 04 Entities | OWNERSHIP_REQUESTS | organisation_id | uuid | ORGANISATIONS | Client being asked for |
| 04 Entities | OWNERSHIP_REQUESTS | requested_by | uuid | USERS | CAM making the ask |
| 04 Entities | OWNERSHIP_REQUESTS | current_owner_id | uuid | USERS | Owner at request time, snapshotted |
| 04 Entities | OWNERSHIP_REQUESTS | status | enum |  | pending, approved, rejected |
| 04 Entities | OWNERSHIP_REQUESTS | reason | text |  | Why this CAM should take it on |
| 04 Entities | OWNERSHIP_REQUESTS | decided_by | uuid | USERS | Admin who approved/rejected |
| 04 Entities | OWNERSHIP_REQUESTS | decided_at | timestamp |  | When decided |
| 04 Entities | OWNERSHIP_REQUESTS | decision_note | text |  | Optional admin note |
| 04 Entities | OWNERSHIP_REQUESTS | created_at | timestamp |  | Row creation timestamp |
| 05 - Features | SCORING_WEIGHTS | id | model_name |  | feature_name |
| 05 - Features | SCORING_WEIGHTS | 1.0 | SCOUT |  | south_yorkshire_flag |
| 05 - Features | SCORING_WEIGHTS | 2.0 | SCOUT |  | mission_alignment_score |
| 05 - Features | SCORING_WEIGHTS | 3.0 | SCOUT |  | service_fit_score |
| 05 - Features | SCORING_WEIGHTS | 4.0 | SCOUT |  | never_contacted_flag |
| 05 - Features | SCORING_WEIGHTS | 5.0 | SCOUT |  | income_band |
| 05 - Features | SCORING_WEIGHTS | 6.0 | SCOUT |  | income_trend |
| 05 - Features | SCORING_WEIGHTS | 7.0 | SCOUT |  | days_since_last_contact |
| 05 - Features | SCORING_WEIGHTS | 8.0 | SCOUT |  | financial_stability_score |
| 05 - Features | SCORING_WEIGHTS | 9.0 | SCOUT |  | has_recent_grant_flag |
| 05 - Features | SCORING_WEIGHTS | 10.0 | SCOUT |  | digital_maturity_score |
| 05 - Features | SCORING_WEIGHTS | 11.0 | SCOUT |  | data_completeness_score |
| 05 - Features | SCORING_WEIGHTS | 12.0 | SCOUT |  | grant_count |
| 05 - Features | SCORING_WEIGHTS | 13.0 | SCOUT |  | has_partnership_history_flag |
| 05 - Features | SCORING_WEIGHTS | 14.0 | COMPASS |  | semester_fit_score |
| 05 - Features | SCORING_WEIGHTS | 15.0 | COMPASS |  | project_complexity_score |
| 05 - Features | SCORING_WEIGHTS | 16.0 | COMPASS |  | repeat_engagement_score |
| 05 - Features | SCORING_WEIGHTS | 17.0 | COMPASS |  | case_study_potential_score |
| 05 - Features | SCORING_WEIGHTS | 18.0 | COMPASS |  | portfolio_sector_score |
| 05 - Features | FEATURE_DEFINITIONS | id | feature_name |  | description |
| 05 - Features | FEATURE_DEFINITIONS | 1.0 | south_yorkshire_flag |  | Whether the organisation is based in South Yorkshire |
| 05 - Features | FEATURE_DEFINITIONS | 2.0 | mission_alignment_score |  | How well the organisation’s mission matches 180DC services |
| 05 - Features | FEATURE_DEFINITIONS | 3.0 | service_fit_score |  | Highest score across all 180DC service-fit categories |
| 05 - Features | FEATURE_DEFINITIONS | 4.0 | income_band |  | Bucketed organisation income level |
| 05 - Features | FEATURE_DEFINITIONS | 5.0 | income_trend |  | Year-over-year income direction |
| 05 - Features | FEATURE_DEFINITIONS | 6.0 | never_contacted_flag |  | Whether the organisation has never been sent an outreach email |
| 05 - Features | FEATURE_DEFINITIONS | 7.0 | days_since_last_contact |  | Number of days since the most recent outreach |
| 05 - Features | FEATURE_DEFINITIONS | 8.0 | financial_stability_score |  | Composite measure of overall financial health |
| 05 - Features | FEATURE_DEFINITIONS | 9.0 | has_recent_grant_flag |  | Whether the organisation received a grant during the previous 24 months |
| 05 - Features | FEATURE_DEFINITIONS | 10.0 | digital_maturity_score |  | How digitally developed the organisation is |
| 05 - Features | FEATURE_DEFINITIONS | 11.0 | data_completeness_score |  | Percentage of required organisation fields that are populated |
| 05 - Features | FEATURE_DEFINITIONS | 12.0 | grant_count |  | Total number of grants received |
| 05 - Features | FEATURE_DEFINITIONS | 13.0 | has_partnership_history_flag |  | Whether the organisation previously converted to a 180DC client |
| 05 - Features | FEATURE_DEFINITIONS | 14.0 | semester_fit_score |  | How well project timing aligns with the student semester |
| 05 - Features | FEATURE_DEFINITIONS | 15.0 | project_complexity_score |  | Whether the project has suitable complexity for a student team |
| 05 - Features | FEATURE_DEFINITIONS | 16.0 | repeat_engagement_score |  | Strength of the organisation’s prior relationship with 180DC |
| 05 - Features | FEATURE_DEFINITIONS | 17.0 | case_study_potential_score |  | Potential for the engagement to produce a publishable case study |
| 05 - Features | FEATURE_DEFINITIONS | 18.0 | portfolio_sector_score |  | How underrepresented the organisation’s sector is in the current portfolio |
| 05 - Features | FEATURE_DEFINITIONS | 19.0 | performance_score |  | How well an email performed based on its confirmed outcome |
| 05 - Features | FEATURE_DEFINITIONS | 20.0 | used_as_example_count |  | Number of times the email has been supplied to Gemini as a few-shot example |
| 05 - Features | AGENT_PROMPTS | id | agent_name |  | prompt_template |
| 05 - Features | AGENT_PROMPTS | 1.0 | SCOUT |  |  |
| 05 - Features | AGENT_PROMPTS | 2.0 | COMPASS |  |  |
| 05 - Features | AGENT_PROMPTS | 3.0 | VOICE |  | You are writing a cold outreach email for 180 Degrees Consulting Sheffield, a student consultancy at the University of Sheffield working with social enterprises and non-profits. Organisation profile: {org_profile}. Service to pitch: {service}. Tone: {tone}. Here are {n} emails that successfully converted or received replies from similar organisations: {examples}. Write a new email following similar patterns. Return JSON: { subject, body, tone_used, hook_type } |
| 05 - Features | EMAIL_PERFORMANCE_LIBRARY | id | outreach_message_id |  | organisation_id |
| 05 - Features | EMAIL_PERFORMANCE_LIBRARY | — | links to OUTREACH_MESSAGES |  | which org |
| 06 - Predictions | AGENT_RUNS | id | uuid |  | Primary key |
| 06 - Predictions | AGENT_RUNS | organisation_id | uuid |  | Organisation that was scored |
| 06 - Predictions | AGENT_RUNS | agent_name | enum |  | SCOUT / VOICE / COMPASS / PULSE |
| 06 - Predictions | AGENT_RUNS | score_source | enum |  | rule_engine / llm / ml_model |
| 06 - Predictions | AGENT_RUNS | triggered_by | enum |  | manual / scheduled / api |
| 06 - Predictions | AGENT_RUNS | triggered_by_user_id | uuid |  | CAM or user who triggered the run; null when scheduled |
| 06 - Predictions | AGENT_RUNS | input_snapshot | jsonb |  | Exact organisation and feature data supplied to the scoring system at that moment |
| 06 - Predictions | AGENT_RUNS | output | jsonb |  | Complete model output, including scores, reasoning, and recommendations |
| 06 - Predictions | AGENT_RUNS | model_version_id | uuid |  | Links to the MODEL_VERSIONS record used for this run |
| 06 - Predictions | AGENT_RUNS | tokens_used | integer |  | Number of LLM tokens used; null for rule-engine runs |
| 06 - Predictions | AGENT_RUNS | latency_ms | integer |  | Total time taken to complete the scoring call in milliseconds |
| 06 - Predictions | AGENT_RUNS | created_at | timestamp |  | Row creation timestamp |
| 06 - Predictions | LATEST_SCORES | id | uuid |  | Primary key |
| 06 - Predictions | LATEST_SCORES | organisation_id | uuid |  | Unique organisation identifier; one row per organisation |
| 06 - Predictions | LATEST_SCORES | priority_score | float |  | Latest SCOUT priority score from 0.0 to 1.0 |
| 06 - Predictions | LATEST_SCORES | priority_band | enum |  | high / medium / low |
| 06 - Predictions | LATEST_SCORES | fit_reason | text |  | Plain-English explanation of the organisation’s score |
| 06 - Predictions | LATEST_SCORES | recommended_service | text |  | 180DC service recommended as the primary outreach offer |
| 06 - Predictions | LATEST_SCORES | partnership_value_score | float |  | Latest COMPASS partnership-value score from 0.0 to 1.0 |
| 06 - Predictions | LATEST_SCORES | partnership_band | enum |  | high / medium / low |
| 06 - Predictions | LATEST_SCORES | estimated_project_type | text |  | Type of consulting project the organisation is most likely to need |
| 06 - Predictions | LATEST_SCORES | semester_fit_score | float |  | How well the potential project timing aligns with the student semester |
| 06 - Predictions | LATEST_SCORES | sector_growth_score | float |  | Latest PULSE sector-momentum score |
| 06 - Predictions | LATEST_SCORES | score_source | enum |  | rule_engine / llm / ml_model |
| 06 - Predictions | LATEST_SCORES | scout_run_id | uuid |  | Links to the AGENT_RUNS row that produced the latest SCOUT score |
| 06 - Predictions | LATEST_SCORES | compass_run_id | uuid |  | Links to the AGENT_RUNS row that produced the latest COMPASS score |
| 06 - Predictions | LATEST_SCORES | scored_at | timestamp |  | Date and time the organisation was last scored |
| 06 - Predictions | LATEST_SCORES | updated_at | timestamp |  | Date and time this latest-score record was last updated |
| 06 - Predictions | MODEL_VERSIONS | id | uuid |  | Primary key |
| 06 - Predictions | MODEL_VERSIONS | model_name | enum |  | SCOUT / VOICE / COMPASS / PULSE |
| 06 - Predictions | MODEL_VERSIONS | version | string |  | Model version identifier, such as v1, v2, or v3 |
| 06 - Predictions | MODEL_VERSIONS | implementation_type | enum |  | rules / llm / ml_model |
| 06 - Predictions | MODEL_VERSIONS | config | jsonb |  | Weights snapshot for rules, prompt identifier and settings for LLMs, or model path and configuration for trained ML models |
| 06 - Predictions | MODEL_VERSIONS | is_active | boolean |  | Whether this is the active version; only one version should be active per model at a time |
| 06 - Predictions | MODEL_VERSIONS | notes | text |  | Description of what changed and why the new version was created |
| 06 - Predictions | MODEL_VERSIONS | created_by_user_id | uuid |  | User who created or activated this model version |
| 06 - Predictions | MODEL_VERSIONS | created_at | timestamp |  | Row creation timestamp |
| 06 - Predictions | MODEL_VERSIONS | deprecated_at | timestamp |  | Date and time the version was replaced or retired; null while active |
| 07 Outreach & Outcomes | OUTREACH_MESSAGES | id | uuid |  | Primary key |
| 07 Outreach & Outcomes | OUTREACH_MESSAGES | organisation_id | uuid |  | Organisation that received the outreach message |
| 07 Outreach & Outcomes | OUTREACH_MESSAGES | contact_id | uuid |  | Specific contact the message was sent to |
| 07 Outreach & Outcomes | OUTREACH_MESSAGES | sent_by_user_id | uuid |  | CAM or user who sent the message |
| 07 Outreach & Outcomes | OUTREACH_MESSAGES | subject | text |  | Final email subject line exactly as sent |
| 07 Outreach & Outcomes | OUTREACH_MESSAGES | body | text |  | Final email body exactly as sent |
| 07 Outreach & Outcomes | OUTREACH_MESSAGES | send_status | enum |  | draft / scheduled / sent / failed |
| 07 Outreach & Outcomes | OUTREACH_MESSAGES | scheduled_at | timestamp |  | Date and time the message was scheduled for sending; null if not scheduled |
| 07 Outreach & Outcomes | OUTREACH_MESSAGES | sent_at | timestamp |  | Date and time Gmail successfully sent the message; null until sent |
| 07 Outreach & Outcomes | OUTREACH_MESSAGES | agent_run_id | uuid |  | Links to the VOICE AGENT_RUNS record that generated the draft |
| 07 Outreach & Outcomes | OUTREACH_MESSAGES | created_at | timestamp |  | Row creation timestamp |
| 07 Outreach & Outcomes | OUTREACH_MESSAGES | updated_at | timestamp |  | Date and time the record was last updated |
| 07 Outreach & Outcomes | AI_GENERATIONS | id | uuid |  | Primary key |
| 07 Outreach & Outcomes | AI_GENERATIONS | outreach_message_id | uuid |  | Links to the associated OUTREACH_MESSAGES record |
| 07 Outreach & Outcomes | AI_GENERATIONS | generated_subject | text |  | Original subject line generated by Gemini before CAM edits |
| 07 Outreach & Outcomes | AI_GENERATIONS | generated_body | text |  | Original email body generated by Gemini before CAM edits |
| 07 Outreach & Outcomes | AI_GENERATIONS | cam_edited | boolean |  | Whether the CAM changed the generated subject or body |
| 07 Outreach & Outcomes | AI_GENERATIONS | edit_distance | integer |  | Number of characters changed between the generated draft and the final message; used as a proxy for how much editing was required |
| 07 Outreach & Outcomes | AI_GENERATIONS | created_at | timestamp |  | Row creation timestamp |
| 07 Outreach & Outcomes | SEND_EVENTS | id | uuid |  | Primary key |
| 07 Outreach & Outcomes | SEND_EVENTS | outreach_message_id | uuid |  | Links to the OUTREACH_MESSAGES record associated with the email |
| 07 Outreach & Outcomes | SEND_EVENTS | event_type | enum |  | sent / delivered / bounced / opened |
| 07 Outreach & Outcomes | SEND_EVENTS | occurred_at | timestamp |  | Date and time Gmail reported the delivery event |
| 07 Outreach & Outcomes | SEND_EVENTS | metadata | jsonb |  | Additional event information returned by the Gmail API |
| 07 Outreach & Outcomes | SEND_EVENTS | created_at | timestamp |  | Row creation timestamp |
| 07 Outreach & Outcomes | REPLY_EVENTS | id | uuid |  | Primary key |
| 07 Outreach & Outcomes | REPLY_EVENTS | outreach_message_id | uuid |  | Links to the OUTREACH_MESSAGES record this message replies to |
| 07 Outreach & Outcomes | REPLY_EVENTS | organisation_id | uuid |  | Organisation that sent the reply |
| 07 Outreach & Outcomes | REPLY_EVENTS | contact_id | uuid |  | Specific contact who sent the reply |
| 07 Outreach & Outcomes | REPLY_EVENTS | reply_body | text |  | Full text of the received reply |
| 07 Outreach & Outcomes | REPLY_EVENTS | sentiment | enum |  | positive / neutral / negative |
| 07 Outreach & Outcomes | REPLY_EVENTS | intent | enum |  | interested / not_interested / more_info / referral |
| 07 Outreach & Outcomes | REPLY_EVENTS | received_at | timestamp |  | Date and time the reply arrived in Gmail |
| 07 Outreach & Outcomes | REPLY_EVENTS | processed_at | timestamp |  | Date and time sentiment and intent analysis was completed |
| 07 Outreach & Outcomes | REPLY_EVENTS | created_at | timestamp |  | Row creation timestamp |
| 07 Outreach & Outcomes | OUTCOMES | id | uuid |  | Primary key |
| 07 Outreach & Outcomes | OUTCOMES | organisation_id | uuid |  | Links to the ORGANISATIONS record associated with the outcome |
| 07 Outreach & Outcomes | OUTCOMES | outreach_message_id | uuid |  | Links to the OUTREACH_MESSAGES record that led to this outcome |
| 07 Outreach & Outcomes | OUTCOMES | outcome_type | enum |  | converted / no_response / rejected / follow_up / referral |
| 07 Outreach & Outcomes | OUTCOMES | notes | text |  | CAM notes describing what happened and any relevant context |
| 07 Outreach & Outcomes | OUTCOMES | recorded_by_user_id | uuid |  | Links to the USERS record for the CAM who logged the outcome |
| 07 Outreach & Outcomes | OUTCOMES | created_at | timestamp |  | Row creation timestamp |
| 08 System Analytics | API_HEALTH_LOGS | id | uuid |  | Primary key |
| 08 System Analytics | API_HEALTH_LOGS | api_name | enum |  | API called: charitybase / companies_house / find_that_charity / three_sixty_giving / gmail / gemini |
| 08 System Analytics | API_HEALTH_LOGS | called_at | timestamp |  | Date and time of the API call |
| 08 System Analytics | API_HEALTH_LOGS | response_status | int |  | HTTP status code returned |
| 08 System Analytics | API_HEALTH_LOGS | latency_ms | int |  | Time taken for the call in milliseconds |
| 08 System Analytics | API_HEALTH_LOGS | error_message | text |  | Error detail when the call failed; null on success |
| 08 System Analytics | API_HEALTH_LOGS | created_at | timestamp |  | Row creation timestamp |
| 08 System Analytics | INGESTION_SUMMARY | id | uuid |  | Primary key |
| 08 System Analytics | INGESTION_SUMMARY | date | date |  | Day the rollup covers |
| 08 System Analytics | INGESTION_SUMMARY | source | enum |  | Data source the rollup covers |
| 08 System Analytics | INGESTION_SUMMARY | orgs_added | int |  | New organisations created that day |
| 08 System Analytics | INGESTION_SUMMARY | orgs_updated | int |  | Existing organisations updated that day |
| 08 System Analytics | INGESTION_SUMMARY | orgs_failed | int |  | Records that failed validation that day |
| 08 System Analytics | INGESTION_SUMMARY | created_at | timestamp |  | Row creation timestamp |
| 08 System Analytics | COST_TRACKING | id | uuid |  | Primary key |
| 08 System Analytics | COST_TRACKING | date | date |  | Day the spend was incurred |
| 08 System Analytics | COST_TRACKING | service | enum |  | Paid service: gemini / gmail / other |
| 08 System Analytics | COST_TRACKING | tokens_used | int |  | LLM tokens consumed; null for non-LLM services |
| 08 System Analytics | COST_TRACKING | cost_usd | numeric |  | Cost in USD |
| 08 System Analytics | COST_TRACKING | created_at | timestamp |  | Row creation timestamp |
| 08 System Analytics | ERROR_LOG | id | uuid |  | Primary key |
| 08 System Analytics | ERROR_LOG | component | text |  | System component that raised the error (ingestion, scoring, email, sync, ui) |
| 08 System Analytics | ERROR_LOG | error_type | text |  | Class or category of the error |
| 08 System Analytics | ERROR_LOG | message | text |  | Human-readable error message |
| 08 System Analytics | ERROR_LOG | stack_trace | text |  | Full stack trace for debugging |
| 08 System Analytics | ERROR_LOG | resolved_at | timestamp |  | When the error was marked resolved; null while open |
| 08 System Analytics | ERROR_LOG | created_at | timestamp |  | Row creation timestamp |
| 08 System Analytics | AUDIT_LOG | id | uuid |  | Primary key |
| 08 System Analytics | AUDIT_LOG | action_user_id | uuid | USERS | id of user who acted |
| 08 System Analytics | AUDIT_LOG | action | text |  | Machine token: role_changed, user_deactivated |
| 08 System Analytics | AUDIT_LOG | target_table | text |  | Table the action targeted |
| 08 System Analytics | AUDIT_LOG | target_id | uuid |  | Row targeted |
| 08 System Analytics | AUDIT_LOG | detail | jsonb |  | Action Context: before/after, reason |
| 08 System Analytics | AUDIT_LOG | created_at | timestamp |  | Row creation timestamp |
| 08 System Analytics | LOGIN_ATTEMPT | id | uuid |  | Primary Key |
| 08 System Analytics | LOGIN_ATTEMPT | email_hash | text |  | sha256 hex of the trimmed, lowercased submitted email; never the address itself |
| 08 System Analytics | LOGIN_ATTEMPT | failures | int |  | Consecutive failed logins inside the current window |
| 08 System Analytics | LOGIN_ATTEMPT | window_started_at | timestamp |  | Start of the counting window; failures stop accumulating 15 minutes after it |
| 08 System Analytics | LOGIN_ATTEMPT | blocked_until | timestamp |  | When this address may next attempt a login; null or past means allowed |
| 08 System Analytics | LOGIN_ATTEMPT | created_at | timestamp |  | Row creation timestamp |
| 08 System Analytics | LOGIN_ATTEMPT | updated_at | timestamp |  | Last time a failure was counted |
| 09 CAM Analytics | CAM_ACTIVITY_SUMMARY | id | uuid |  | Primary key |
| 09 CAM Analytics | CAM_ACTIVITY_SUMMARY | user_id | uuid |  | Links to USERS; the CAM the week covers |
| 09 CAM Analytics | CAM_ACTIVITY_SUMMARY | week_start | date |  | Monday of the week the rollup covers |
| 09 CAM Analytics | CAM_ACTIVITY_SUMMARY | orgs_scored | int |  | Organisations reviewed from the queue that week |
| 09 CAM Analytics | CAM_ACTIVITY_SUMMARY | emails_sent | int |  | Outreach emails sent that week |
| 09 CAM Analytics | CAM_ACTIVITY_SUMMARY | replies_received | int |  | Replies received that week |
| 09 CAM Analytics | CAM_ACTIVITY_SUMMARY | conversions | int |  | Outcomes logged as converted that week |
| 09 CAM Analytics | CAM_ACTIVITY_SUMMARY | created_at | timestamp |  | Row creation timestamp |
| 09 CAM Analytics | PIPELINE_METRICS | id | uuid |  | Primary key |
| 09 CAM Analytics | PIPELINE_METRICS | date | date |  | Day the snapshot covers |
| 09 CAM Analytics | PIPELINE_METRICS | orgs_in_database | int |  | Total canonical organisations |
| 09 CAM Analytics | PIPELINE_METRICS | orgs_contacted | int |  | Organisations with at least one sent email |
| 09 CAM Analytics | PIPELINE_METRICS | orgs_replied | int |  | Organisations that have replied |
| 09 CAM Analytics | PIPELINE_METRICS | orgs_converted | int |  | Organisations with a converted outcome |
| 09 CAM Analytics | PIPELINE_METRICS | conversion_rate | float |  | orgs_converted / orgs_contacted |
| 09 CAM Analytics | PIPELINE_METRICS | created_at | timestamp |  | Row creation timestamp |
| 09 CAM Analytics | SECTOR_PERFORMANCE | id | uuid |  | Primary key |
| 09 CAM Analytics | SECTOR_PERFORMANCE | sector | text |  | Sector the row covers |
| 09 CAM Analytics | SECTOR_PERFORMANCE | orgs_contacted | int |  | Organisations contacted in this sector |
| 09 CAM Analytics | SECTOR_PERFORMANCE | reply_rate | float |  | Replies received / emails sent |
| 09 CAM Analytics | SECTOR_PERFORMANCE | conversion_rate | float |  | Converted / contacted |
| 09 CAM Analytics | SECTOR_PERFORMANCE | avg_priority_score | float |  | Mean SCOUT priority score across the sector |
| 09 CAM Analytics | SECTOR_PERFORMANCE | updated_at | timestamp |  | Last recalculation timestamp |
| 03 Raw Data | FIELD_DISCREPANCIES | id | uuid |  | Primary key |
| 03 Raw Data | FIELD_DISCREPANCIES | organisation_id | uuid | ORGANISATIONS | Organisation the conflicting field belongs to |
| 03 Raw Data | FIELD_DISCREPANCIES | field_name | text |  | Which ORGANISATIONS field is in conflict |
| 03 Raw Data | FIELD_DISCREPANCIES | existing_value | text |  | Current value stored on the organisation |
| 03 Raw Data | FIELD_DISCREPANCIES | existing_source | text |  | Which source last wrote the existing value |
| 03 Raw Data | FIELD_DISCREPANCIES | incoming_value | text |  | New value proposed by the incoming record |
| 03 Raw Data | FIELD_DISCREPANCIES | incoming_source | text |  | Which API/source produced the incoming value |
| 03 Raw Data | FIELD_DISCREPANCIES | raw_source_record_id | uuid | RAW_SOURCE_RECORDS | The incoming record that triggered this conflict |
| 03 Raw Data | FIELD_DISCREPANCIES | entity_match_candidate_id | uuid | ENTITY_MATCH_CANDIDATES | Match candidate this discrepancy arose from, if any |
| 03 Raw Data | FIELD_DISCREPANCIES | status | enum |  | Review state of this discrepancy |
| 03 Raw Data | FIELD_DISCREPANCIES | resolved_choice | enum |  | Which side the reviewer picked |
| 03 Raw Data | FIELD_DISCREPANCIES | resolved_value | text |  | Final value written back to ORGANISATIONS |
| 03 Raw Data | FIELD_DISCREPANCIES | resolved_by_user_id | uuid | USERS | Admin who resolved this |
| 03 Raw Data | FIELD_DISCREPANCIES | resolved_at | timestamp |  | When resolved |
| 03 Raw Data | FIELD_DISCREPANCIES | notes | text |  | Reviewer notes explaining the decision |
| 03 Raw Data | FIELD_DISCREPANCIES | created_at | timestamp |  | Row creation timestamp |
| 03 Raw Data | FIELD_SOURCES | id | uuid |  | Primary key |
| 03 Raw Data | FIELD_SOURCES | organisation_id | uuid | ORGANISATIONS | Organisation this field value belongs to |
| 03 Raw Data | FIELD_SOURCES | field_name | text |  | Which ORGANISATIONS column this value is for |
| 03 Raw Data | FIELD_SOURCES | value | text |  | Value written for this field by this source |
| 03 Raw Data | FIELD_SOURCES | source | text |  | Which source produced this value |
| 03 Raw Data | FIELD_SOURCES | raw_source_record_id | uuid | RAW_SOURCE_RECORDS | The raw record this value was taken from |
| 03 Raw Data | FIELD_SOURCES | is_current | boolean |  | Whether this is the value currently live on ORGANISATIONS for this field |
| 03 Raw Data | FIELD_SOURCES | recorded_at | timestamp |  | When this field value was recorded |
| 03 Raw Data | RAW_SOURCE_RECORDS | excluded_fields | jsonb |  | Field paths stripped from raw_payload by the data handling rules before the record was written |
| 03 Raw Data | RAW_SOURCE_RECORDS | rule_version_applied | integer |  | Which version of the data handling rule set was in force when this record was written |
| 03 Raw Data | DATA_HANDLING_RULES | id | uuid |  | Primary key |
| 03 Raw Data | DATA_HANDLING_RULES | rule_version | integer |  | The global rule version at the time this rule was created or last toggled |
| 03 Raw Data | DATA_HANDLING_RULES | source | enum |  | Which source the rule applies to; null applies to every source |
| 04 Entities | NOTIFICATIONS | id | uuid |  | Primary key |
| 04 Entities | NOTIFICATIONS | recipient_user_id | uuid | USERS | User the notification is for |
| 04 Entities | NOTIFICATIONS | actor_user_id | uuid | USERS | User whose action triggered the notification |
| 04 Entities | NOTIFICATIONS | notification_type | enum |  | What kind of notification |
| 04 Entities | NOTIFICATIONS | title | text |  | Short headline shown in the bell panel |
| 04 Entities | NOTIFICATIONS | body | text |  | Optional longer description |
| 04 Entities | NOTIFICATIONS | link_path | text |  | In-app route to navigate to on click |
| 04 Entities | NOTIFICATIONS | target_table | text |  | Table of the linked record |
| 04 Entities | NOTIFICATIONS | target_id | uuid |  | ID of the linked record |
| 04 Entities | NOTIFICATIONS | read_at | timestamp |  | When the recipient marked it read |
| 04 Entities | NOTIFICATIONS | created_at | timestamp |  | Row creation timestamp |
| 04 Entities | BOOKLET_GENERATIONS | id | uuid |  | Primary key |
| 04 Entities | BOOKLET_GENERATIONS | organisation_id | uuid | ORGANISATIONS | Organisation this booklet belongs to |
| 04 Entities | BOOKLET_GENERATIONS | generated_by | uuid | USERS | User who generated the booklet |
| 04 Entities | BOOKLET_GENERATIONS | prompt_system | text |  | System prompt used |
| 04 Entities | BOOKLET_GENERATIONS | prompt_user | text |  | User prompt used |
| 04 Entities | BOOKLET_GENERATIONS | output | text |  | Generated output |
| 04 Entities | BOOKLET_GENERATIONS | model | text |  | Model used for generation |
| 04 Entities | BOOKLET_GENERATIONS | created_at | timestamptz |  | Row creation timestamp |
| 04 Entities | EDIT_SUGGESTIONS | id | uuid |  | Primary key |
| 04 Entities | EDIT_SUGGESTIONS | organisation_id | uuid | ORGANISATIONS | Client the correction is about |
| 04 Entities | EDIT_SUGGESTIONS | field_name | text |  | One of the six sensitive fields |
| 04 Entities | EDIT_SUGGESTIONS | current_value | text |  | Value at proposal time, captured server-side |
| 04 Entities | EDIT_SUGGESTIONS | proposed_value | text |  | The CAM's corrected value |
| 04 Entities | EDIT_SUGGESTIONS | status | enum |  | pending, approved, rejected, superseded |
| 04 Entities | EDIT_SUGGESTIONS | requested_by | uuid | USERS | CAM making the proposal |
| 04 Entities | EDIT_SUGGESTIONS | superseded_by | uuid | EDIT_SUGGESTIONS | Newer suggestion that replaced this one |
| 04 Entities | EDIT_SUGGESTIONS | decided_by | uuid | USERS | Admin who approved/rejected |
| 04 Entities | EDIT_SUGGESTIONS | decided_at | timestamp |  | When decided |
| 04 Entities | EDIT_SUGGESTIONS | rejection_reason | text |  | Optional admin note for the CAM |
| 04 Entities | EDIT_SUGGESTIONS | created_at | timestamp |  | Row creation timestamp |
| 04 Entities | EDIT_SUGGESTIONS | updated_at | timestamp |  | Last edit timestamp |
