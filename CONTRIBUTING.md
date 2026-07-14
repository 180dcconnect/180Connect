# Contributing

Read this before your first pull request. Setup instructions (Node, Git, VS Code, running the app) live in [README.md](README.md).

## Branches

```
main                                  production — demo-able at all times
 └── dev                              staging — everything lands here first
      ├── feature/F001-client-profile
      ├── feature/F002-email-generation
      └── fix/login-redirect
```

**`main`** is the released version. It only ever receives merges from `dev`, once a week.

**`dev`** is where the team's work accumulates. Every feature branch merges here.

**Feature branches** are yours. Branch from `dev`, merge back into `dev`.

Both `main` and `dev` are protected: you cannot push to them directly, and every merge needs a pull request with **one approval** from another team member. You cannot approve your own PR.

### Naming

| Prefix | Use for | Example |
| --- | --- | --- |
| `feature/` | new functionality | `feature/F003-charity-import` |
| `fix/` | bug fixes | `fix/login-redirect` |
| `chore/` | tooling, deps, config | `chore/eslint-rules` |

Include the backlog ID when the work maps to one (`F001`, `F002`…). Keep the rest short and lowercase, words separated by hyphens.

## Day-to-day

Always start from an up-to-date `dev`:

```bash
git checkout dev
git pull
git checkout -b feature/F001-client-profile
```

Work, commit, and before you push:

```bash
npm run lint
npx tsc --noEmit
npm run build      # catches errors the dev server tolerates
```

Then:

```bash
git push -u origin feature/F001-client-profile
```

Open the pull request **into `dev`** — GitHub sometimes defaults the base to `main`, so check it. Ask someone to review. Once approved it gets squash-merged and the branch is deleted automatically.

If `dev` has moved on while you were working, rebase onto it before asking for review:

```bash
git fetch origin
git rebase origin/dev
```

## Commits

Present tense, describe the change, not the file:

```
add client profile page
fix redirect loop after login
```

Not `updated stuff` or `changes`. If the *why* isn't obvious from the subject line, put it in the body.

## Pull requests

Keep them small — one feature or one fix. A PR that touches thirty files is a PR nobody reviews properly.

In the description, say what changed and how to check it. If it's a UI change, attach a screenshot.

## Reviewing

Someone is waiting on you, so pick reviews up quickly. Pull the branch and actually run it — reading the diff catches typos, running the code catches bugs.

Say what needs to change and why. "This breaks when the email is empty" is a review comment; "I don't like this" is not.

## Releases

Once a week, `dev` is merged into `main` and tagged (`v0.1`, `v0.2`, …). Only the project lead does this merge.

That means `main` is always a version you can demo, and every tag is a point you can go back to when something breaks.

## Merge methods

Feature → `dev` is **squash-merged**: your branch becomes a single commit, so `dev` reads as one commit per feature.

`dev` → `main` is a **merge commit**: the week's work stays visible as a unit.

Both are enforced by GitHub, so you don't have to remember.
