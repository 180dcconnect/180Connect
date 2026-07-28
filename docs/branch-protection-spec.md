# Branch Protection Spec — `main` (F230)

**Status:** Blocked — **cannot be applied on the repo's current GitHub plan.** Not a permissions problem.
**Why this is a separate doc:** branch protection is a repo *setting*, not a file in the repo, so it can never be delivered as a pull request. This doc records the gap, what the rule should be if the plan ever allows it, and what we do instead in the meantime.

---

## The gap

`main` has **no GitHub branch protection**, and cannot have any while the repo stays private on the GitHub Free plan.

Confirmed 28 July 2026:

```
gh api repos/180dcconnect/180Connect/rulesets
→ 403 "Upgrade to GitHub Pro or make this repository public to enable this feature."

gh api repos/180dcconnect/180Connect/branches/main/protection
→ 404 Not Found
```

Both branch protection rules and their newer equivalent, rulesets, are gated behind a paid plan for **private** repositories. The 403 on `/rulesets` is the load-bearing response: it names the constraint outright. The 404 on `/branches/main/protection` is *not* independent evidence — that endpoint returns 404 both when no rule exists and when the feature is unavailable, so on this repo it cannot distinguish the two. `dev` returns the same 404 for the same reason.

An earlier version of this doc read that 404 as "no rule has been created yet" and treated the fix as an admin-permission task. That was wrong: no amount of admin access unlocks the setting on this plan. (Repo admin is Bashir; the component owner's `admin: false` is real but beside the point.)

This matters for [F230](https://github.com/180dcconnect/180Connect/issues/225)'s Acceptance Criterion 3: *"Deploying to production follows a defined process, such as only after passing staging, rather than being an ad hoc, undocumented action any team member could do differently."* The process is now documented (see [production-deployment.md](production-deployment.md)), but nothing technically stops a team member with push access from pushing straight to `main` or merging a PR into it without review — the "any team member could do differently" half of the AC is still true today, and stays true until the plan changes.

---

## Unblocking it costs money or privacy

| Option | Cost | Trade-off |
|---|---|---|
| GitHub Pro on the account owning the repo | ~$4/user/month | Cheapest path; keeps the repo private. Note the repo is owned by a **user** account (`180dcconnect`), not an org, so Pro is the relevant tier, not Team. |
| GitHub Team (requires moving the repo to an organisation) | ~$4/user/month, billed per member | Also unlocks org-level rulesets and `CODEOWNERS` review, but means an org migration mid-project. |
| Make the repo public | Free | Branch protection becomes available immediately, but the codebase and its issue history become world-readable. Not acceptable while the project handles real organisation data. |
| Stay as-is | Free | AC3 enforced by convention only — the current state. Recorded as an accepted deviation in [open-questions.md](open-questions.md) (D-04). |

**Recommendation:** stay as-is for the MVP and keep the convention documented, unless someone merges to `main` without review in practice — at which point ~$4/month is cheap insurance. This is a Project Leader call, not a component-owner one.

---

## Recommended rule for `main` — *if and when the plan allows it*

| Setting | Value | Why |
|---|---|---|
| Require a pull request before merging | On | Blocks direct pushes; forces every production change through review |
| Required approvals | 1 | Matches the SOP's "human-controlled" and "reviewable changes" principles — a second person always looks before production changes |
| Require status checks to pass | On, once CI checks exist for `main` | Prevents merging a build that's already known to fail |
| Allow force pushes | Off | Force pushes can silently rewrite history and drop commits that were already deployed |
| Allow deletions | Off | Prevents the branch itself being deleted by accident |
| Do not allow bypassing the above settings | On, or restrict to a named list of admins if some exception is genuinely needed | Otherwise the rule has an unlogged back door |

## How to apply it — after upgrading, not before

These steps only work once the repo is on a plan that offers protection for private repos (or has been made public). On the current plan the **Add branch protection rule** button is present but shows an upgrade prompt.

1. Go to the repo on GitHub → **Settings → Branches**.
2. Under **Branch protection rules**, click **Add branch protection rule** (or **Add ruleset**, GitHub's newer equivalent).
3. Branch name pattern: `main`.
4. Set the options per the table above.
5. Save.
6. Verify: `gh api repos/180dcconnect/180Connect/branches/main/protection` should now return the rule instead of 404.

Optional: repeat for `dev` with a lighter version (e.g. require PR, but 0 required approvals) if the team wants to stop accidental direct pushes there too, without slowing down the day-to-day merge-to-dev flow.

## What we do instead, today

Until the above is possible, AC3 rests entirely on convention, documented in [production-deployment.md](production-deployment.md):

- Only the PM opens and merges the `dev` → `main` release PR.
- Every change reaches `main` via `dev`, never directly.
- The release PR is reviewed before merge, same as any other.

None of this is enforced by GitHub. It holds because the team follows it.

## Related files

- [Production Deployment](production-deployment.md)
- [Open Questions](open-questions.md) — D-04 records this as an accepted deviation
