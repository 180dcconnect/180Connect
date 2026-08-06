<!--
  GENERATED FILE — DO NOT EDIT.
  Source: ~/Downloads/Data Model.xlsx (the Data Model spreadsheet is the source of truth, per SOP §7).
  To change anything here: edit the spreadsheet, then run `npm run export:data-model`.
-->

# 08 System Analytics

## API_HEALTH_LOGS

| Field | Type | Description |
| :--- | :--- | :--- |
| id | uuid | Primary key |
| api_name | enum | API called: charitybase / companies_house / find_that_charity / three_sixty_giving / gmail / gemini |
| called_at | timestamp | Date and time of the API call |
| response_status | int | HTTP status code returned |
| latency_ms | int | Time taken for the call in milliseconds |
| error_message | text | Error detail when the call failed; null on success |
| created_at | timestamp | Row creation timestamp |

## INGESTION_SUMMARY

| Field | Type | Description |
| :--- | :--- | :--- |
| id | uuid | Primary key |
| date | date | Day the rollup covers |
| source | enum | Data source the rollup covers |
| orgs_added | int | New organisations created that day |
| orgs_updated | int | Existing organisations updated that day |
| orgs_failed | int | Records that failed validation that day |
| created_at | timestamp | Row creation timestamp |

## COST_TRACKING

| Field | Type | Description |
| :--- | :--- | :--- |
| id | uuid | Primary key |
| date | date | Day the spend was incurred |
| service | enum | Paid service: gemini / gmail / other |
| tokens_used | int | LLM tokens consumed; null for non-LLM services; drawn from AGENT_RUNS token counts |
| cost_usd | numeric | Cost in USD |
| created_at | timestamp | Row creation timestamp |

## ERROR_LOG

| Field | Type | Description |
| :--- | :--- | :--- |
| id | uuid | Primary key |
| component | text | System component that raised the error: ingestion / scoring / email / sync / ui |
| error_type | text | Class or category of the error |
| message | text | Human-readable error message |
| stack_trace | text | Full stack trace for debugging |
| resolved_at | timestamp | Date and time the error was marked resolved; null while open |
| created_at | timestamp | Row creation timestamp |

## AUDIT_LOG

| id | uuid | Primary Key |
| :--- | :--- | :--- |
| actor_user_id | uuid | Foreign Key to USERS for user who acted; null for system actions |
| action | text | Machine Token: role changed, user_deactivated, etc |
| target_table | text | Table the action targeted |
| target_id | uuid | Row targeted |
| detail | jsonb | Action context: before/after, reason |
| created_at | timestamp | Row creation timestamp |

## LOGIN_ATTEMPT

| id | uuid | Primary Key |
| :--- | :--- | :--- |
| email_hash | text | sha256 hex of the trimmed, lowercased submitted email; never the address itself |
| failures | int | Consecutive failed logins inside the current window |
| window_started_at | timestamp | Start of the counting window; failures stop accumulating 15 minutes after it |
| blocked_until | timestamp | When this address may next attempt a login; null or past means allowed |
| created_at | timestamp | Row creation timestamp |
| updated_at | timestamp | Last time a failure was counted. |
