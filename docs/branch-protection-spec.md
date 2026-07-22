# Branch Protection Spec — `main` (F230)

**Status:** Proposed, not yet applied.
**Why this is a separate doc:** applying it requires GitHub repo **admin** permission, which this component owner does not have (`admin: false` confirmed via the GitHub API — see below). This is a ready-to-apply spec for whoever holds admin (Bashir), not something that can be delivered as a pull request — branch protection is a repo *setting*, not a file in the repo.

---

## The gap

`main` currently has **no GitHub branch protection** — confirmed 22 July 2026:

```
gh api repos/180dcconnect/180Connect/branches/main/protection
→ 404 Not Found
```

GitHub returns 404 for this endpoint specifically when no protection rule exists (not as an error — that response *is* the answer). `dev` was checked too and also has none.

This matters for [F230](https://github.com/180dcconnect/180Connect/issues/225)'s Acceptance Criterion 3: *"Deploying to production follows a defined process, such as only after passing staging, rather than being an ad hoc, undocumented action any team member could do differently."* The process is now documented (see [production-deployment.md](production-deployment.md)), but nothing technically stops a team member with push access from pushing straight to `main` or merging a PR into it without review — the "any team member could do differently" half of the AC is still true today.

---

## Recommended rule for `main`

| Setting | Value | Why |
|---|---|---|
| Require a pull request before merging | On | Blocks direct pushes; forces every production change through review |
| Required approvals | 1 | Matches the SOP's "human-controlled" and "reviewable changes" principles — a second person always looks before production changes |
| Require status checks to pass | On, once CI checks exist for `main` | Prevents merging a build that's already known to fail |
| Allow force pushes | Off | Force pushes can silently rewrite history and drop commits that were already deployed |
| Allow deletions | Off | Prevents the branch itself being deleted by accident |
| Do not allow bypassing the above settings | On, or restrict to a named list of admins if some exception is genuinely needed | Otherwise the rule has an unlogged back door |

## How to apply it

1. Go to the repo on GitHub → **Settings → Branches**.
2. Under **Branch protection rules**, click **Add branch protection rule** (or **Add ruleset**, GitHub's newer equivalent).
3. Branch name pattern: `main`.
4. Set the options per the table above.
5. Save.

Optional: repeat for `dev` with a lighter version (e.g. require PR, but 0 required approvals) if the team wants to stop accidental direct pushes there too, without slowing down the day-to-day merge-to-dev flow.

## Related files

- [Production Deployment](production-deployment.md)
