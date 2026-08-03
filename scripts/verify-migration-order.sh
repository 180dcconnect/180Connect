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
stale=""
for name in $added; do
  stamp="$(printf '%s\n' "$name" | timestamps_of)"
  if [ -z "$stamp" ]; then
    echo "::error file=$MIGRATIONS_DIR/$name::'$name' is not named <14-digit-timestamp>_<name>.sql (see supabase/MIGRATIONS.md)."
    stale="yes"
    continue
  fi
  if [ "$stamp" \< "$base_head" ] || [ "$stamp" = "$base_head" ]; then
    echo "::error file=$MIGRATIONS_DIR/$name::'$name' is dated $stamp, which is not after $base_head — the newest migration already on '$BASE_REF'. 'supabase db push' will refuse it. Rename this file and its supabase/rollback/ counterpart to a timestamp after $base_head."
    stale="yes"
  fi
done

if [ -n "$stale" ]; then
  echo
  echo "Migration ordering check failed."
  echo "Rename the files listed above — both the migration and its rollback — to a"
  echo "timestamp after $base_head, then push again. Anyone who already applied the"
  echo "old name locally needs 'supabase db reset'."
  exit 1
fi

echo "All added migrations are dated after $base_head."
