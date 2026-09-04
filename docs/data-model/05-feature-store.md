<!--
  GENERATED FILE — DO NOT EDIT.
  Source: ~/180Connect/Data Model.xlsx (the Data Model spreadsheet is the source of truth, per SOP §7).
  To change anything here: edit the spreadsheet, then run `npm run export:data-model`.
-->

# 05 - Feature Store

## SCORING_WEIGHTS

| id | model_name | feature_name | weight | min_value | max_value | notes |  |  |  |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | SCOUT | south_yorkshire_flag | 0.2 | 0 | 1 | Sheffield branch priority: highest single weight |  |  |  |
| 2 | SCOUT | mission_alignment_score | 0.15 | 0 | 1 | How well the organisation’s mission fits 180DC services |  |  |  |
| 3 | SCOUT | service_fit_score | 0.1 | 0 | 1 | Match to a specific service offering |  |  |  |
| 4 | SCOUT | never_contacted_flag | 0.08 | 0 | 1 | Fresh opportunity not yet in the outreach pipeline |  |  |  |
| 5 | SCOUT | income_band | 0.08 | 1 | 5 | Organisation size and financial capacity |  |  |  |
| 6 | SCOUT | income_trend | 7.0000000000000007E-2 | -1 | 1 | Growing organisations may be more receptive to support |  |  |  |
| 7 | SCOUT | days_since_last_contact | 7.0000000000000007E-2 | 0 | 365 | Recency measure — stale contacts score lower |  |  |  |
| 8 | SCOUT | financial_stability_score | 0.05 | 0 | 1 | Overall financial health |  |  |  |
| 9 | SCOUT | has_recent_grant_flag | 0.05 | 0 | 1 | Active organisation that has recently received funding |  |  |  |
| 10 | SCOUT | digital_maturity_score | 0.05 | 0 | 1 | Readiness for digital-transformation work |  |  |  |
| 11 | SCOUT | data_completeness_score | 0.05 | 0 | 1 | Penalises incomplete organisation records |  |  |  |
| 12 | SCOUT | grant_count | 0.03 | 0 | 50 | Track record of external funding |  |  |  |
| 13 | SCOUT | has_partnership_history_flag | 0.02 | 0 | 1 | Prior consulting or partnership relationship |  |  |  |
| 14 | COMPASS | semester_fit_score | 0.3 | 0 | 1 | Project timing compared with the student semester calendar |  |  |  |
| 15 | COMPASS | project_complexity_score | 0.25 | 0 | 1 | Appropriate level of challenge for a student team |  |  |  |
| 16 | COMPASS | repeat_engagement_score | 0.2 | 0 | 1 | Prior relationship increases the likelihood of success |  |  |  |
| 17 | COMPASS | case_study_potential_score | 0.15 | 0 | 1 | Potential to produce a publishable case study |  |  |  |
| 18 | COMPASS | portfolio_sector_score | 0.1 | 0 | 1 | Sector-diversity contribution to the 180DC portfolio |  |  |  |

## FEATURE_DEFINITIONS

| id | feature_name | description | source_table | source_field | computation_method | data_type | used_by |  |  |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | south_yorkshire_flag | Whether the organisation is based in South Yorkshire | ORGANISATIONS | postcode | Direct lookup using an approved postcode-area mapping | boolean | SCOUT |  |  |
| 2 | mission_alignment_score | How well the organisation’s mission matches 180DC services | ENRICHMENT_RESULTS | mission_alignment_score | LLM-derived during enrichment | 0.0–1.0 | SCOUT |  |  |
| 3 | service_fit_score | Highest score across all 180DC service-fit categories | ENRICHMENT_RESULTS | multiple service-fit fields | Formula: MAX of digital, financial, marketing, operational, and impact fit scores | 0.0–1.0 | SCOUT |  |  |
| 4 | income_band | Bucketed organisation income level | FINANCIAL_PERIODS | total_income | Formul: latest annual income converted to a band from 1 to 5 | 1–5 | SCOUT |  |  |
| 5 | income_trend | Year-over-year income direction | FINANCIAL_PERIODS | total_income | Formula: current-year income minus prior-year income, divided by prior-year income and capped at ±1 | -1.0–1.0 | SCOUT |  |  |
| 6 | never_contacted_flag | Whether the organisation has never been sent an outreach email | OUTREACH_MESSAGES | organisation_id | SQL: true when outreach-message count equals zero | boolean | SCOUT |  |  |
| 7 | days_since_last_contact | Number of days since the most recent outreach | OUTREACH_MESSAGES | sent_at | SQL: current date minus MAX sent_at | integer | SCOUT |  |  |
| 8 | financial_stability_score | Composite measure of overall financial health | FINANCIAL_PERIODS | multiple | Formula combining income trend, expenditure ratio, and reserve level | 0.0–1.0 | SCOUT |  |  |
| 9 | has_recent_grant_flag | Whether the organisation received a grant during the previous 24 months | GRANTS | award_date | SQL: true when any award_date is within the previous two years | boolean | SCOUT |  |  |
| 10 | digital_maturity_score | How digitally developed the organisation is | ENRICHMENT_RESULTS | digital_maturity_score | LLM-derived during enrichment | 0.0–1.0 | SCOUT |  |  |
| 11 | data_completeness_score | Percentage of required organisation fields that are populated | ORGANISATIONS | multiple | Formula: populated key fields divided by total key fields | 0.0–1.0 | SCOUT |  |  |
| 12 | grant_count | Total number of grants received | GRANTS | organisation_id | SQL: COUNT of related grant records | integer | SCOUT |  |  |
| 13 | has_partnership_history_flag | Whether the organisation previously converted to a 180DC client | OUTCOMES | outcome_type | SQL: true when any outcome_type equals converted | boolean | SCOUT |  |  |
| 14 | semester_fit_score | How well project timing aligns with the student semester | computed | current_date | Formula: proximity to semester start dates in October and February | 0.0–1.0 | COMPASS |  |  |
| 15 | project_complexity_score | Whether the project has suitable complexity for a student team | ENRICHMENT_RESULTS | project_complexity_score | LLM-derived during enrichment | 0.0–1.0 | COMPASS |  |  |
| 16 | repeat_engagement_score | Strength of the organisation’s prior relationship with 180DC | OUTCOMES + OUTREACH_MESSAGES | multiple | Formula weighting conversions more heavily than replies and prior contacts | 0.0–1.0 | COMPASS |  |  |
| 17 | case_study_potential_score | Potential for the engagement to produce a publishable case study | ENRICHMENT_RESULTS | case_study_potential_score | LLM-derived during enrichment | 0.0–1.0 | COMPASS |  |  |
| 18 | portfolio_sector_score | How underrepresented the organisation’s sector is in the current portfolio | ORGANISATIONS + OUTCOMES | sector | SQL: inverse of the current portfolio-sector distribution | 0.0–1.0 | COMPASS |  |  |
| 19 | performance_score | How well an email performed based on its confirmed outcome | OUTCOMES | outcome_type | Formula — converted = 1.0; replied = 0.6; no_response = 0.1; rejected = 0.0 | 0.0–1.0 | VOICE |  |  |
| 20 | used_as_example_count | Number of times the email has been supplied to Gemini as a few-shot example | EMAIL_PERFORMANCE_LIBRARY | used_as_example_count | Incremented each time the email is selected as an example | integer | VOICE |  |  |

## AGENT_PROMPTS

| id | agent_name | prompt_template | model_used | version | is_active | notes |  |  |  |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | SCOUT |  |  | 0 | 0 | Populate when switching from the rule engine |  |  |  |
| 2 | COMPASS |  |  | 0 | 0 | Populate when switching from the rule engine |  |  |  |
| 3 | VOICE | You are writing a cold outreach email for 180 Degrees Consulting Sheffield, a student consultancy at the University of Sheffield working with social enterprises and non-profits. Organisation profile: {org_profile}. Service to pitch: {service}. Tone: {tone}. Here are {n} emails that successfully converted or received replies from similar organisations: {examples}. Write a new email following similar patterns. Return JSON: { subject, body, tone_used, hook_type } | gemini-1.5-pro | 1 | 1 | Active from day one. the examples array is initially empty and fills over time (see Email Performance library) |  |  |  |

## EMAIL_PERFORMANCE_LIBRARY

| id | outreach_message_id | organisation_id | sector | service_pitched | tone_used | outcome_type | performance_score | used_as_example_count | created_at |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| — | links to OUTREACH_MESSAGES | which org | org sector at send time | Digital Transformation / Financial Sustainability / etc. | inspiring / practical / urgent / peer | converted / replied / no_response / rejected | 0.0–1.0 | auto-incremented | — |
