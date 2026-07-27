# Secrets

Where credentials live, who can reach them, and what stops one reaching the
repository — F223.

`environment-variables.md` covers the *mechanics* of configuration: the schema
in `src/lib/env.ts`, what is required, what happens on a missing value. This
document covers the *security* side, and settles the hosting question that one
left open.

## The rule

No API key, token, password or connection string appears in the codebase, in
commit history, or in anything sent to the browser. There are no exceptions for
test values, throwaway branches, or "just to see if it works".

## Where secrets actually live

| Environment | Store | Status |
| --- | --- | --- |
| Your laptop | `.env.local`, gitignored | In use |
| Preview deployments | Vercel → Project Settings → Environment Variables → Preview | Not yet provisioned |
| Production | Vercel → Project Settings → Environment Variables → Production | Not yet provisioned |

**Vercel is the source of truth for deployed secrets.** This closes the open
decision recorded in `environment-variables.md`: the alternatives were GitHub
Actions secrets and Supabase, and Vercel wins because it is already the deploy
target and it scopes values per environment.

The decision is made; the store is not yet populated. A `180-connect` Vercel
project exists but nothing has been deployed to it, so its environment variables
are empty. Until a real deployment happens, local setup goes through Supabase
directly, as the README describes.

### Once we deploy

When the first deployment lands, whoever sets it up should add the variables to
Vercel for Preview and Production, and then add this to the README as the
preferred local setup path — it is faster than the dashboard route and it scales
to variables that have no dashboard to visit:

```bash
npm i -g vercel
vercel login
vercel link          # pick the `180-connect` project
vercel env pull .env.local
```

Do not add that to the README before the store is populated. It would hand a new
developer an empty `.env.local` and no explanation.

The other two stores are not banned, they are just narrower:

- **GitHub Actions secrets** — only if CI itself needs to authenticate to
  something. It now does, in two workflows; see the register below.
- **Supabase secrets** — only for Edge Functions, which read their own store
  rather than Vercel's. We have none yet.

### GitHub Actions secrets and variables

These are held in **Settings → Secrets and variables → Actions**, not in Vercel,
because the workflows run on GitHub's infrastructure and never see Vercel's
environment. Nothing the deployed application reads belongs here.

A **secret** is encrypted and masked in logs. A **variable** is plain text, used
only where the value is already public.

| Name | Kind | Used by | What it is |
| --- | --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Secret | `migrations.yml` | Supabase personal access token, for the CLI. Account → Access Tokens. |
| `SUPABASE_STAGING_REF` | Variable | `migrations.yml` | Staging project ref. Public — it is in the project URL. |
| `SUPABASE_PROD_REF` | Variable | `backup-production.yml` | Production project ref. Public, same reasoning. |
| `SUPABASE_PROD_POOLER_HOST` | Variable | `backup-production.yml` | Session-pooler hostname for production. Public — a shared regional endpoint. |
| `SUPABASE_PROD_DB_PASSWORD` | Secret | `backup-production.yml` | Production database password. Project Settings → Database. |
| `BLOB_READ_WRITE_TOKEN` | Secret | `backup-production.yml` | Read/write token for the Vercel Blob store holding backups. |

Setup instructions for the backup ones are in
[`Backups/backup-setup.md`](Backups/backup-setup.md).

Two of these deserve more care than the rest. `SUPABASE_PROD_DB_PASSWORD` is
direct, unmediated access to production — it bypasses RLS entirely, unlike the
publishable key. `BLOB_READ_WRITE_TOKEN` reads the nightly database dumps, which
contain every row of `public` plus `auth.users`, email addresses and password
hashes included. Either one leaking is equivalent to leaking the database.

Because these live in repository-level storage, every workflow in the repo can
read them, and anyone who can merge a workflow file can exfiltrate them. That is
accepted for now given the team size and a private repo, but it is the reason
workflow changes deserve a real review rather than a rubber stamp.

## Onboarding a new developer

Covered step by step in the README under *Environment variables*. The shape of
it is that access is granted, never transmitted: they get invited to the Vercel
project and the Supabase organisation, and then fetch the values themselves. If
you ever find yourself about to paste a key into a message, that is the signal
that someone is missing an invite.

## Supabase keys

Supabase issues two kinds, and the difference matters more than the names
suggest:

| Key | Prefix | Safe in the browser? |
| --- | --- | --- |
| Publishable | `sb_publishable_` | Yes — row-level security still applies to every query |
| Secret | `sb_secret_` | **No.** Bypasses row-level security entirely |

The publishable key is public by design; it goes in `NEXT_PUBLIC_SUPABASE_ANON_KEY`
and ships to the browser. The secret key is server-only and must never carry a
`NEXT_PUBLIC_` prefix — that prefix inlines the value into the client bundle,
which would hand every visitor unrestricted database access.

Supabase also still shows a **legacy anon key**, a JWT starting `eyJ`. It is
equivalent to the publishable key and still works, but it is being phased out.
Prefer `sb_publishable_`.

> The variable is still named `NEXT_PUBLIC_SUPABASE_ANON_KEY` for now, which
> reads oddly when the value starts with `sb_publishable_`. Renaming it to
> `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is worth doing once F231 has merged and
> the schema in `src/lib/env.ts` has one owner again.

## What stops a secret being committed

Two layers, neither of which replaces paying attention.

**`.gitignore`** excludes `.env*`, so the file holding your real values cannot
be staged by accident.

**`.github/workflows/secret-scan.yml`** runs [gitleaks](https://github.com/gitleaks/gitleaks)
on every pull request into `dev` or `main`. It scans the branch's commit
history, not just the final diff, so a secret that was added and then removed in
a later commit is still caught. A hit fails the check and names the file, line
and rule; the pull request cannot merge until it is resolved.

Two limits to be aware of:

- It catches recognisable credential *formats* — `sb_secret_…`, AWS keys,
  private key blocks. A password that looks like an ordinary string will pass.
- It runs at pull request time, so a secret briefly exists on a remote branch
  before anyone sees the failure. Treat any key that reached GitHub as
  compromised and rotate it, even if the branch was deleted.

GitHub's own push protection would close that second gap by rejecting the push
itself, but on a private repository it requires GitHub Secret Protection, a paid
per-committer add-on. Worth revisiting if the repository goes public or the
project acquires a budget.

### If the repository moves to a GitHub organisation

`gitleaks-action` is free for personal accounts and for public repositories.
`180Connect` sits on a personal account, so it is free today. Move the
repository into a GitHub **organisation** and the action starts requiring a
`GITLEAKS_LICENSE` secret and fails without one.

If that happens, drop the action and run the gitleaks binary directly in the
same workflow step — the scanner itself is MIT-licensed and unrestricted; only
the wrapper action is gated. Same coverage, no licence key.

## If you commit a secret

Speak up immediately — in the team channel, not by DM. Rotating a key takes a
few minutes and breaks nothing that a redeploy does not fix. A leaked key nobody
mentioned is the expensive version.

1. Say which key, in which repository, and roughly when.
2. Rotate it at the source — Supabase dashboard → **API Keys** → roll the
   affected key; or the relevant provider's console.
3. Update the value in Vercel for every environment that used it, **and in
   GitHub Actions secrets** if it is one of the CI values listed above — those
   are a separate store and will keep using the old value otherwise, so the
   nightly backup starts failing a day later for no obvious reason.
4. Redeploy so running instances pick up the new value.

Removing the commit is not step one and does not replace rotation. Anyone who
saw the key still has it, and rewriting shared history causes its own problems.

## Audit status

Checked on 2026-07-20, across all branches:

- `git log --all -S` for `service_role`, `sb_secret_`, `sk-`, and JWT-shaped
  strings — no credential found in any commit
- No `process.env` access outside `src/lib/env.ts`
- `.env*` gitignored since the initial commit; no `.env` file has ever been
  committed. `.env.example` holds names and comments only, no values
