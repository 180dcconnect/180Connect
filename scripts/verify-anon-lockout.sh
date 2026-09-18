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
# non-empty array is a data leak. Privileged RPCs must also be absent from the
# anon role's PostgREST OpenAPI document; checking only whether an RPC call is
# refused is insufficient because a callable function can reject inside its
# body and return the same HTTP status as a database privilege refusal.
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
#
# Names are lower_snake: PostgREST exposes tables under their real Postgres name,
# and these are created unquoted (public.users, not "USERS"). The Data Model writes
# them UPPER_SNAKE, but that is documentation, not the identifier.
TABLES=(
  users organisations organisation_identifiers contacts financial_periods
  grants enrichment_results notes tags org_tags
  ingestion_runs raw_source_records data_quality_events entity_match_candidates
  manual_entry_records model_versions scoring_weights feature_definitions
  agent_prompts agent_runs latest_scores email_performance_library
  outreach_messages ai_generations send_events reply_events outcomes
  api_health_logs ingestion_summary cost_tracking error_log
  cam_activity_summary pipeline_metrics sector_performance audit_log
)

# SECURITY DEFINER functions that are not anonymous APIs. PostgREST builds its
# OpenAPI paths for the database role represented by the supplied JWT, so their
# presence here proves anon still has EXECUTE even when the function body would
# subsequently reject auth.uid() = null.
PRIVATE_RPCS=(
  check_allowed_email_domain
  check_manual_entry_contact_email
  schedule_outreach_send
  suggest_organisation_edit
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

openapi_response="$(curl -sS -w '\n%{http_code}' \
  "${URL}/rest/v1/" \
  -H "apikey: ${KEY}" \
  -H "Authorization: Bearer ${KEY}")"

openapi_status="$(tail -n1 <<<"$openapi_response")"
openapi_body="$(sed '$d' <<<"$openapi_response")"

if [[ "$openapi_status" != "200" ]]; then
  leaked+=("PostgREST OpenAPI document (unexpected HTTP ${openapi_status})")
else
  for rpc in "${PRIVATE_RPCS[@]}"; do
    if grep -Fq "\"/rpc/${rpc}\"" <<<"$openapi_body"; then
      leaked+=("rpc/${rpc} (exposed to anon)")
    fi
  done
fi

if ((${#leaked[@]} > 0)); then
  echo "FAIL: found ${#leaked[@]} anonymous data or RPC exposure(s):" >&2
  printf '  - %s\n' "${leaked[@]}" >&2
  echo >&2
  echo "The anon key is public. Tables must return no rows and private RPCs must not be exposed." >&2
  exit 1
fi

echo "PASS: anon key returned no rows from ${checked} table(s). ${pending} table(s) not yet migrated."
