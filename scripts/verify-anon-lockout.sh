#!/usr/bin/env bash
# Anonymous lockout probe — F224 (#224).
# Spec: docs/rls-permission-matrix.md §5 test 11.
#
# This is the test for the acceptance criterion "even if the application-layer
# permission check were somehow bypassed". It deliberately does not use the app's
# Supabase client: it hits PostgREST directly with the publishable (anon) key, the
# way an attacker with a key lifted from the browser bundle would. The anon key is
# public by design — RLS is the only thing standing behind it.
#
# Every table must return either an empty array or a permission error. A single
# non-empty array is a data leak.
#
# Usage:
#   scripts/verify-anon-lockout.sh <supabase-url> <anon-key>
#   scripts/verify-anon-lockout.sh http://127.0.0.1:54321 eyJ...

set -euo pipefail

URL="${1:?usage: verify-anon-lockout.sh <supabase-url> <anon-key>}"
KEY="${2:?usage: verify-anon-lockout.sh <supabase-url> <anon-key>}"

# Every table in the migration sequence. Tables that do not exist yet return 404
# and are reported as pending, not as a pass — a typo in a table name must never
# read as a clean result.
TABLES=(
  USERS ORGANISATIONS ORGANISATION_IDENTIFIERS CONTACTS FINANCIAL_PERIODS
  GRANTS ENRICHMENT_RESULTS NOTES TAGS ORG_TAGS
  INGESTION_RUNS RAW_SOURCE_RECORDS DATA_QUALITY_EVENTS ENTITY_MATCH_CANDIDATES
  MANUAL_ENTRY_RECORDS MODEL_VERSIONS SCORING_WEIGHTS FEATURE_DEFINITIONS
  AGENT_PROMPTS AGENT_RUNS LATEST_SCORES EMAIL_PERFORMANCE_LIBRARY
  OUTREACH_MESSAGES AI_GENERATIONS SEND_EVENTS REPLY_EVENTS OUTCOMES
  API_HEALTH_LOGS INGESTION_SUMMARY COST_TRACKING ERROR_LOG
  CAM_ACTIVITY_SUMMARY PIPELINE_METRICS SECTOR_PERFORMANCE AUDIT_LOG
)

leaked=()
pending=0
checked=0

for table in "${TABLES[@]}"; do
  response="$(curl -sS -w '\n%{http_code}' \
    "${URL}/rest/v1/${table}?select=*&limit=1" \
    -H "apikey: ${KEY}" \
    -H "Authorization: Bearer ${KEY}")"

  status="$(tail -n1 <<<"$response")"
  body="$(sed '$d' <<<"$response")"

  case "$status" in
    404)
      pending=$((pending + 1))
      ;;
    200)
      checked=$((checked + 1))
      # 200 with an empty array is the expected pass: RLS filtered every row.
      if [[ "$(tr -d '[:space:]' <<<"$body")" != "[]" ]]; then
        leaked+=("${table} (HTTP 200, rows returned)")
      fi
      ;;
    401|403)
      # Blocked outright. Also a pass.
      checked=$((checked + 1))
      ;;
    *)
      checked=$((checked + 1))
      leaked+=("${table} (unexpected HTTP ${status}: ${body})")
      ;;
  esac
done

if ((${#leaked[@]} > 0)); then
  echo "FAIL: the anon key reached data on ${#leaked[@]} table(s):" >&2
  printf '  - %s\n' "${leaked[@]}" >&2
  echo >&2
  echo "The anon key is public. Any table listed above is readable by anyone." >&2
  exit 1
fi

echo "PASS: anon key returned no rows from ${checked} table(s). ${pending} table(s) not yet migrated."
