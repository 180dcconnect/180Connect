#!/usr/bin/env bash
# Migration ordering gate — F232 (#227).
# See supabase/MIGRATIONS.md for the naming convention this enforces.
#
# WHAT THIS CATCHES
#
# `supabase db push` refuses to apply a migration whose timestamp sits *behind*
# the last one already applied on the remote:
#
#   Found local migration files to be inserted before the last migration on
#   remote database. Rerun the command with --include-all flag to apply these
#   migrations
#
# The workflow runs `db push` bare and non-interactive, so that is a hard failure.
# It is also invisible until it is too late: the apply job only runs on `dev`, so
# a branch carrying a stale timestamp passes every PR check, merges green, and
# then breaks the push for everyone — the next person to touch `supabase/` gets a
# red build they did not cause. That happened twice in one week (F014 on 3 Aug
# 2026, and F008 caught in review the same day), which is why this exists.
#
# The cause is mundane: you branch off `dev`, date a migration for today, and the
# branch then sits in review for a few days while other migrations land ahead of
# it. Nothing warns you, because the file was correctly dated when you wrote it.
#
# THE RULE
#
# Every migration this branch adds must be dated after every migration already on
# the base branch. Base branch, not staging: it needs no credentials and no
# network, so it runs on the PR itself rather than only where the secrets live.
# `dev` is what feeds staging, so being ahead of `dev` is what actually matters.
#
# KNOWN GAP
#
# Two PRs open at once, both branched from the same point: A merges, then B is
# still measured against the base as it was when B last ran. Re-running B's checks
# (any push to B, or a manual re-run) re-measures against the current base and
# catches it. Nothing here can detect it without the PR being re-run, since GitHub
# does not re-run a PR's checks when the base branch moves.
#
# RESTORATION CARVE-OUT (added 3 Sep 2026, after the F044 incident)
#
# A migration can be deleted from the repo after it was already merged and
# applied (F044's create_field_sources was, swept up in an unrelated PR's
# "drop duplicate" fix). Restoring that file is the correct repair — the remote
# ledger already has its version recorded, so `db push` would skip it — but
# "present here, absent on the base tree" reads it as newly introduced and the
# timestamp check fails it. So: when a file IS stale, this script deepens the
# base fetch and looks for that exact filename anywhere in the base branch's
# history. Found = a restoration under its original, already-applied timestamp
# → waived with a notice. Not found = the error stands. Fails closed: if the
# deep fetch cannot prove the history, the check is not waived.
#
# Usage:
#   scripts/verify-migration-order.sh [base-ref]   # default: dev

set -euo pipefail

BASE_REF="${1:-dev}"
MIGRATIONS_DIR="supabase/migrations"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "No $MIGRATIONS_DIR directory — nothing to check."
  exit 0
fi

# A shallow checkout will not have the base branch. Fetch just enough to list its
# tree; the file names are all this needs, never their contents.
git fetch --quiet --depth=1 origin "$BASE_REF"

# Timestamps only — the 14 leading digits of each migration file name.
timestamps_of() {
  sed -n 's#^\([0-9]\{14\}\)_.*\.sql$#\1#p' | sort
}

base_names="$(git ls-tree --name-only FETCH_HEAD "$MIGRATIONS_DIR/" \
  | xargs -r -n1 basename | sort)"
head_names="$(ls -1 "$MIGRATIONS_DIR" | sort)"

# Present here, absent on the base branch: the migrations this PR introduces.
added="$(comm -13 <(printf '%s\n' "$base_names") <(printf '%s\n' "$head_names"))"

if [ -z "$added" ]; then
  echo "This branch adds no migrations — nothing to check."
  exit 0
fi

base_head="$(printf '%s\n' "$base_names" | timestamps_of | tail -1)"

if [ -z "$base_head" ]; then
  echo "Base branch '$BASE_REF' has no migrations — nothing to be behind."
  exit 0
fi

echo "Base branch '$BASE_REF' is at $base_head."
echo "This branch adds:"
printf '  %s\n' $added

# Equal timestamps fail too: two migrations sharing one timestamp have no defined
# order between them, which is the same problem wearing a different hat.
#
# ::error annotations are withheld until after the restoration carve-out below
# has had its say: an error emitted here and then waived would still render as
# a red annotation on a green check on GitHub.
stale=""
for name in $added; do
  stamp="$(printf '%s\n' "$name" | timestamps_of)"
  if [ -z "$stamp" ]; then
    stale="$stale $name"
    continue
  fi
  if [ "$stamp" \< "$base_head" ] || [ "$stamp" = "$base_head" ]; then
    stale="$stale $name"
  fi
done

# Restoration carve-out — see the header. Only runs when something is stale,
# so the happy path keeps its shallow one-commit fetch. The deepen is retried
# and verified (rev-list count > 1): a silently failed fetch would otherwise
# leave depth at 1, find no history, and fail the very restoration this exists
# to allow.
if [ -n "$stale" ]; then
  for _attempt in 1 2; do
    git fetch --quiet --depth=2000 origin "$BASE_REF" 2>/dev/null || true
    depth="$(git rev-list --count FETCH_HEAD 2>/dev/null || echo 0)"
    [ "$depth" -gt 1 ] && break
  done
  still_stale=""
  for name in $stale; do
    # A malformed name is never waivable: the carve-out is about timestamps,
    # not about letting badly-named files through.
    stamp="$(printf '%s\n' "$name" | timestamps_of)"
    if [ -z "$stamp" ]; then
      still_stale="$still_stale $name"
      continue
    fi
    # Captured, not piped into grep -q: git log streams, grep -q closes the
    # pipe on the first match, and under `set -o pipefail` that SIGPIPEs git
    # log into exit 141 — turning every successful match into a failure.
    seen="$(git log --format=%H --full-history FETCH_HEAD -- "$MIGRATIONS_DIR/$name" 2>/dev/null || true)"
    if [ -n "$seen" ]; then
      echo "::notice file=$MIGRATIONS_DIR/$name::$name was previously merged into '$BASE_REF' (restored under its original, already-applied timestamp) — staleness check waived."
      continue
    fi
    still_stale="$still_stale $name"
  done
  stale="$still_stale"
fi

if [ -n "$stale" ]; then
  echo
  echo "Migration ordering check failed."
  echo "Rename the files listed above — both the migration and its rollback — to a"
  echo "timestamp after $base_head, then push again. Anyone who already applied the"
  echo "old name locally needs 'supabase db reset'."
  # Annotations after the verdict, so only files that genuinely fail the gate
  # land as red annotations on the PR.
  for name in $stale; do
    stamp="$(printf '%s\n' "$name" | timestamps_of)"
    if [ -z "$stamp" ]; then
      echo "::error file=$MIGRATIONS_DIR/$name::'$name' is not named <14-digit-timestamp>_<name>.sql (see supabase/MIGRATIONS.md)."
    else
      echo "::error file=$MIGRATIONS_DIR/$name::'$name' is dated $stamp, which is not after $base_head — the newest migration already on '$BASE_REF'. 'supabase db push' will refuse it. Rename this file and its supabase/rollback/ counterpart to a timestamp after $base_head."
    fi
  done
  exit 1
fi

# ---------------------------------------------------------------------------
# Every version must be UNIQUE, not merely late.
#
# supabase_migrations.schema_migrations is keyed on the 14-digit version alone,
# so two files sharing one is not a style problem -- it is a silent skip. The
# first to land records the version; the second is then considered
# already-applied and never runs, on staging and on production, with CI green
# throughout. It only surfaces on a fresh database, where `db reset` dies on
# the primary key and nobody can rebuild locally until it is fixed.
#
# This happened: 20260912170300 was used by both notify_on_gmail_reply (#510)
# and auto_transition_no_response (#545), and F154 AC3's two functions reached
# no environment at all. The staleness check above could not see it -- both
# files were correctly dated later than everything before them.
duplicates="$(
  ls "$MIGRATIONS_DIR" 2>/dev/null \
    | grep -E '^[0-9]{14}_.*\.sql$' \
    | cut -d_ -f1 \
    | sort \
    | uniq -d
)"

if [ -n "$duplicates" ]; then
  echo
  echo "Migration version collision."
  echo
  for stamp in $duplicates; do
    echo "  $stamp is used by:"
    for f in "$MIGRATIONS_DIR/${stamp}"_*.sql; do
      echo "    $(basename "$f")"
      echo "::error file=$f::Version $stamp is used by more than one migration. schema_migrations is keyed on the version alone, so only the first to be applied ever runs -- the other is silently skipped on every environment. Re-date this file and its supabase/rollback/ counterpart."
    done
  done
  echo
  echo "Re-date all but one of each group -- migration and rollback together --"
  echo "to a timestamp after $base_head, then push again."
  exit 1
fi

echo "All added migrations are dated after $base_head."
