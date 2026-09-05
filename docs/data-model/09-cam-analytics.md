<!--
  GENERATED FILE — DO NOT EDIT.
  Source: ~/180Connect/Data Model.xlsx (the Data Model spreadsheet is the source of truth, per SOP §7).
  To change anything here: edit the spreadsheet, then run `npm run export:data-model`.
-->

# 09 CAM Analytics

## CAM_ACTIVITY_SUMMARY

| Field | Type | Description |
| :--- | :--- | :--- |
| id | uuid | Primary key |
| user_id | uuid | Links to the USERS record for the CAM this weekly rollup covers |
| week_start | date | Monday of the week the rollup covers |
| orgs_scored | int | Organisations reviewed from the queue that week |
| emails_sent | int | Outreach emails sent that week |
| replies_received | int | Replies received that week |
| conversions | int | Outcomes logged as converted that week |
| created_at | timestamp | Row creation timestamp |
| week_start | date |  |
| orgs_scored | int |  |
| emails_sent | int |  |
| emails_sent_today | int |  |
| emails_sent_week | int |  |
| emails_sent_month | int |  |
| replies_received | int |  |
| conversions | int |  |
| active_charities | int |  |
| ai_recommendations_accepted | int |  |
| ai_recommendations_skipped | int |  |
| conversion_rate_sector | float |  |
| conversion_rate_geography | float |  |
| created_at | timestamp |  |

## PIPELINE_METRICS

| Field | Type | Description |
| :--- | :--- | :--- |
| id | uuid | Primary key |
| date | date | Day the funnel snapshot covers |
| orgs_in_database | int | Total canonical organisations |
| orgs_contacted | int | Organisations with at least one sent email |
| orgs_replied | int | Organisations that have replied |
| orgs_converted | int | Organisations with a converted outcome |
| conversion_rate | float | orgs_converted divided by orgs_contacted |
| created_at | timestamp | Row creation timestamp |

## SECTOR_PERFORMANCE

| Field | Type | Description |
| :--- | :--- | :--- |
| id | uuid | Primary key |
| sector | text | Sector the row covers |
| orgs_contacted | int | Organisations contacted in this sector |
| reply_rate | float | Replies received divided by emails sent |
| conversion_rate | float | Converted divided by contacted |
| avg_priority_score | float | Mean SCOUT priority score across the sector; checks scoring accuracy against real outcomes |
| updated_at | timestamp | Last recalculation timestamp |

## SCOUT_PRIORITY_SCORE

## Records counts priority score at the time of CAM interation
