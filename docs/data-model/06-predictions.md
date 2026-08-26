<!--
  GENERATED FILE — DO NOT EDIT.
  Source: ~/Downloads/Data Model.xlsx (the Data Model spreadsheet is the source of truth, per SOP §7).
  To change anything here: edit the spreadsheet, then run `npm run export:data-model`.
-->

# 06 - Predictions

## p

| Field | Type | Description |
| :--- | :--- | :--- |
| id | uuid | Primary key |
| organisation_id | uuid | Organisation that was scored |
| agent_name | enum | SCOUT / VOICE / COMPASS / PULSE |
| score_source | enum | rule_engine / llm / ml_model |
| triggered_by | enum | manual / scheduled / api |
| triggered_by_user_id | uuid | CAM or user who triggered the run; null when scheduled |
| input_snapshot | jsonb | Exact organisation and feature data supplied to the scoring system at that moment |
| output | jsonb | Complete model output, including scores, reasoning, and recommendations |
| model_version_id | uuid | Links to the MODEL_VERSIONS record used for this run |
| tokens_used | integer | Number of LLM tokens used; null for rule-engine runs |
| latency_ms | integer | Total time taken to complete the scoring call in milliseconds |
| created_at | timestamp | Row creation timestamp |

## LATEST_SCORES

| Field | Type | Description |
| :--- | :--- | :--- |
| id | uuid | Primary key |
| organisation_id | uuid | Unique organisation identifier; one row per organisation |
| priority_score | float | Latest SCOUT priority score from 0.0 to 1.0. Written by the F088 equal-weight rule engine at rescore time. |
| priority_band | enum | high / medium / low. Cut-offs applied by the rule engine at rescore time: high ≥ 0.70, medium ≥ 0.40, low < 0.40 (thresholds pending team confirmation). |
| fit_reason | text | Plain-English explanation of the organisation’s score |
| recommended_service | text | 180DC service recommended as the primary outreach offer |
| partnership_value_score | float | Latest COMPASS partnership-value score from 0.0 to 1.0 |
| partnership_band | enum | high / medium / low |
| estimated_project_type | text | Type of consulting project the organisation is most likely to need |
| semester_fit_score | float | How well the potential project timing aligns with the student semester |
| sector_growth_score | float | Latest PULSE sector-momentum score |
| score_source | enum | rule_engine / llm / ml_model |
| scout_run_id | uuid | Links to the AGENT_RUNS row that produced the latest SCOUT score. DEFERRED: column not created yet — migration 20260831200000 (F058/F059) omits it rather than creating a dangling FK; add it in whichever migration lands AGENT_RUNS. |
| compass_run_id | uuid | Links to the AGENT_RUNS row that produced the latest COMPASS score. DEFERRED: column not created yet — migration 20260831200000 (F058/F059) omits it rather than creating a dangling FK; add it in whichever migration lands AGENT_RUNS. |
| scored_at | timestamp | Date and time the organisation was last scored |
| updated_at | timestamp | Date and time this latest-score record was last updated |
| score_factors | jsonb | Per-factor inputs behind priority_score: {"factors": {sector, geography, size, partnershipHistory, previousContact}, "weights": {the SCOUT weights applied}}. Written by persistLatestScore with the score itself, so the breakdown always reproduces the stored number. Null for rows scored before F095; populated by backfill:scores. |

## MODEL_VERSIONS

| Field | Type | Description |
| :--- | :--- | :--- |
| id | uuid | Primary key |
| model_name | enum | SCOUT / VOICE / COMPASS / PULSE |
| version | string | Model version identifier, such as v1, v2, or v3 |
| implementation_type | enum | rules / llm / ml_model |
| config | jsonb | Weights snapshot for rules, prompt identifier and settings for LLMs, or model path and configuration for trained ML models. For SCOUT v1 this holds EQUAL_WEIGHTS verbatim (sector/geography/size/previousContact = 0.25 each) plus the band cut-offs, seeded by migration 20260831200000. |
| is_active | boolean | Whether this is the active version; only one version should be active per model at a time |
| notes | text | Description of what changed and why the new version was created |
| created_by_user_id | uuid | User who created or activated this model version |
| created_at | timestamp | Row creation timestamp |
| deprecated_at | timestamp | Date and time the version was replaced or retired; null while active |

## SCORE_SNAPSHOTS

| Field | Type | Description |
| :--- | :--- | :--- |
| id | uuid | Primary key. Point-in-time scoring features captured at send time; the feature half of the ML training set. Labels live in OUTCOMES joined by outreach_message_id. Admin read, service-role write via send RPCs. |
| organisation_id | uuid | FK→ORGANISATIONS |
| outreach_message_id | uuid | FK→OUTREACH_MESSAGES (unique) |
| model_version_id | uuid | FK→MODEL_VERSIONS (nullable) |
| sector | numeric | 0–1 |
| geography | numeric | 0–1 |
| size | numeric | 0–1 |
| partnership_history | numeric | 0–1 |
| previous_contact | numeric | 0–1 |
| priority_score | numeric | 0–1 |
| priority_band | enum | high/medium/low |
| scored_at | timestamp |  |
| created_at | timestamp |  |
