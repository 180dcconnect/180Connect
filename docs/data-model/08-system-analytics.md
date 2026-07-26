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
