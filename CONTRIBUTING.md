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

Prefer starting from the issue? You can create the branch straight from a GitHub issue or Project card — **Development → Create a branch**. It links the branch to the issue, so your PR closes it automatically. Fix two things in the dialog before confirming:

- **Change the source from `main` to `dev`** — it defaults to `main`.
- **Rename** to match convention: `feature/F001-…`, not the auto-generated `123-…`.

Then check it out locally and carry on as normal:

```bash
git fetch origin
git checkout feature/F001-client-profile
```

Make your changes, then save them as a **commit** — a labelled snapshot of your work:

```bash
git add -A                          # stage every file you changed
git commit -m "add client profile page"
```

Commit as often as you like; each one is a checkpoint you can go back to. See [Commits](#commits) below for how to word the message.

Before you push, run the three checks:

```bash
npm run lint
npx tsc --noEmit
npm run build      # catches errors the dev server tolerates
```

If any of them reports an error, fix it before pushing — don't open a PR on red. A teammate can't review code that doesn't build.

Then send your branch up to GitHub:

```bash
git push -u origin feature/F001-client-profile
```

Open the pull request **into `dev`** — GitHub sometimes defaults the base to `main`, so check it. Ask someone to review. Once approved it gets squash-merged and the branch is deleted automatically.

If `dev` has moved on while you were working, merge it into your branch before asking for review:

```bash
git fetch origin
git merge origin/dev
```

This keeps you current with `dev` without rewriting your history, so a normal `git push` works and you never need to force-push.

**If the merge reports a conflict**, it means you and someone else changed the same lines. Git pauses and marks the spots in your files like this:

```
<<<<<<< HEAD
your version
=======
their version
>>>>>>> origin/dev
```

Edit each marked file to the version you want, delete the `<<<<<<<`, `=======`, and `>>>>>>>` marker lines, then:

```bash
git add -A
git commit             # finishes the merge
```

Not sure which version is right? **Ask in the team chat before guessing** — and never run `git push --force` to make a conflict "go away." That overwrites other people's work. Nothing you do in a normal merge is unrecoverable as long as you don't force-push.

## Commits

Present tense, describe the change, not the file:

```
add client profile page
fix redirect loop after login
```

Not `updated stuff` or `changes`. If the *why* isn't obvious from the subject line, put it in the body.

## Pull requests

A pull request (PR) is how you ask for your branch to be merged into `dev`. Opening one, step by step:

1. Push your branch (`git push -u origin <branch>`, as above).
2. Go to the repo on [github.com](https://github.com/bashirbobboi/180Connect). A yellow banner **"Compare & pull request"** appears for the branch you just pushed — click it. (No banner? Open the **Pull requests** tab → **New pull request**.)
3. **Check the base branch** at the top: it must read `base: dev`. GitHub often defaults it to `main` — change it if so.
4. The description is pre-filled from our template. Fill in each section and tick the checklist.
5. Click **Create pull request**.
6. On the right, under **Reviewers**, request a teammate (not yourself — GitHub won't let you approve your own PR anyway).

Now the review starts. A few rules for what makes a good PR:

Keep them small — one feature or one fix. A PR that touches thirty files is a PR nobody reviews properly.

In the description, say what changed and how to check it. If it's a UI change, attach a screenshot.

Link the issue you're closing (e.g. `Closes #123`), and note which of the issue's acceptance criteria you've addressed.

Before you open it, check your work against the **Definition of Done** checklist (backlog item **F240**) — that's the bar a reviewer holds you to.

## Reviewing

Someone is waiting on you, so pick reviews up quickly. Pull the branch and actually run it — reading the diff catches typos, running the code catches bugs.

Say what needs to change and why. "This breaks when the email is empty" is a review comment; "I don't like this" is not.

When you get feedback, push the fixes to the **same branch** — the PR updates itself — then re-request review from the same person. Don't open a new PR.

Once you have the one approval, **the author merges** (squash into `dev`) and confirms the branch is deleted. The reviewer approves; they don't merge for you.

## Releases

Once a week, `dev` is merged into `main` and tagged (`v0.1`, `v0.2`, …). Only the project lead does this merge.

That means `main` is always a version you can demo, and every tag is a point you can go back to when something breaks.

## Merge methods

Feature → `dev` is **squash-merged**: your branch becomes a single commit, so `dev` reads as one commit per feature.

`dev` → `main` is a **merge commit**: the week's work stays visible as a unit.

Both are enforced by GitHub, so you don't have to remember.
