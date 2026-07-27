# Architecture

How the pieces of 180Connect fit together. Read this once, after Setup in the
[README](../README.md), before touching auth, routing, or error handling.

## This is Next.js 16, and it moved things

Stock upstream Next.js — `next@16.2.10`, no fork. But 16 renamed and changed
enough that older tutorials, Stack Overflow answers, and AI assistants will
confidently tell you the wrong thing. The rename that trips people up most:

**`src/proxy.ts` replaces `middleware.ts`.** There is no `middleware.ts` in
this project — request-level interception (session refresh, redirects) lives
in `src/proxy.ts` instead, exporting a `proxy()` function rather than
`middleware()`.

`AGENTS.md` (repo root) makes the general rule: before writing code that
touches routing, the proxy, or Server Actions, skim the relevant guide under
`node_modules/next/dist/docs/01-app/`. Those docs ship with the pinned version,
so they describe the version we actually run.

## Routing and mutations

- **App Router** (`src/app/`). A folder becomes a URL; `page.tsx` inside it is
  what renders.
- **No API routes exist yet** (`src/app/api/**`). Every mutation goes through
  a **Server Action** — a `"use server"` file colocated with the page that
  uses it, e.g. `src/app/login/actions.ts`, `src/app/dashboard/actions.ts`.
  If you're adding a new mutation, follow that pattern rather than adding a
  route handler, unless you specifically need one (webhooks, cron endpoints).

## Request lifecycle

1. **`src/proxy.ts`** runs on nearly every request (see its `matcher`, which
   excludes static assets). It delegates to `updateSession` in
   `src/lib/supabase/proxy.ts`, which calls `supabase.auth.getUser()` to
   verify and refresh the session cookie.
2. The page or Server Action runs. Server-side Supabase access goes through
   `src/lib/supabase/server.ts` (`createClient()`), which reads cookies via
   `next/headers`.
3. **`src/instrumentation.ts`** runs once per server instance, before any
   request: it calls `assertEnv()` (see below) and installs a last-resort
   `unhandledRejection` handler. Its `onRequestError` hook also captures every
   server error Next.js surfaces (Server Components, Server Actions, the
   proxy) and forwards it to the error logger.

## Auth and permissions

- **Session/auth**: Supabase Auth via `@supabase/ssr`. There's no
  `getServerSession`-style helper — `createClient().auth.getUser()` is the
  primitive, used directly in Server Components/Actions.
- **Approval gate**: a logged-in Supabase user isn't necessarily allowed in —
  `user.app_metadata.account_status` must equal `"approved"`. This check is
  centralised in `src/lib/auth/require-approved-user.ts`
  (`requireApprovedUser`, `permissionFailureMessage`) rather than duplicated
  per caller. Both `login/actions.ts` and `dashboard/page.tsx` use it.
- **Roles and RLS live in the database, not in application code** (F224).
  `public.users.role` is a `public.user_role` enum — `'cam' | 'admin' |
  'viewer'` — and every table enables row-level security with its policies
  declared in the same migration that creates it (SOP §7). Policies are built
  from `SECURITY DEFINER` predicates in the `app` schema: `app.is_admin()`,
  `app.is_active_user()`, `app.is_cam()`, `app.can_write()`,
  `app.owns_organisation()`, `app.organisation_is_unowned()`,
  `app.can_contact_organisation()`. They live in `app` rather than `public` so
  PostgREST cannot expose them as REST RPCs.
- **The authoritative spec is
  [`docs/rls-permission-matrix.md`](rls-permission-matrix.md)** — read it
  before adding a table, and add the matching policies in the creating
  migration. Role changes go through the `public.set_user_role` admin RPC, not
  a direct update.
- **`requireApprovedUser` is not the authorisation layer.** It gates access to
  the app; RLS decides what a user can see and do once inside. The service-role
  key bypasses RLS entirely, which is how the seed script works — never read it
  from a client component.

## Validation

`src/lib/validation.ts` is the shared validation layer: `safeValidate` wraps
Zod's `safeParse` and returns per-field errors instead of throwing, plus
reusable field types (`emailField`, `urlField`, `nonEmptyTrimmed`,
`boundedInt`). Every form/Server Action should validate through this module —
see `src/lib/auth/login.ts` for the reference usage — rather than calling
Zod directly, so error shape and messaging stay consistent as more forms are
added.

## Error handling and logging

Two related but distinct logging paths:

- **`src/lib/error-logging.ts`** — for unexpected/unhandled errors. Scrubs
  sensitive data (`scrub()`, matching a broad set of key/value patterns) and
  ships a structured report to Sentry when `NEXT_PUBLIC_SENTRY_DSN` is
  configured, or to `console.error` otherwise (captured by Vercel's log
  drains either way). Wired up from three places so nothing escapes:
  - `src/instrumentation.ts` (`onRequestError`, plus the unhandled-rejection
    handler) — server-side.
  - `src/instrumentation-client.ts` (`window.error` /
    `window.unhandledrejection`) — browser-side, before React hydrates.
  - `src/app/global-error.tsx` — the root error boundary, for render errors
    neither of the above catches.
- **`src/lib/log-security-event.ts`** — for expected security-relevant
  rejections: validation failures, permission denials, failed logins. A
  lighter, purpose-built structured log (`logSecurityEvent`), not routed
  through the scrubbing/Sentry pipeline above. It still writes to the console
  only — swap its body when the `ERROR_LOG` table (F226) lands, callers
  shouldn't need to change.

A third, separate thing: **`public.audit_log`** is a database table, not an
application logger. It is the append-only trail for privileged actions — role
changes, deactivations — written by `SECURITY DEFINER` RPCs such as
`public.set_user_role`, readable by admins only, with no insert/update/delete
policy at all. Application code never writes to it directly. Spec:
[`docs/rls-permission-matrix.md`](rls-permission-matrix.md) §3.8.

## Data and migrations

No ORM. Postgres, plain SQL, Supabase CLI.

**The schema's source of truth is the Data Model spreadsheet, not this repo**
(SOP §7). A readable markdown projection lives in
[`docs/data-model/`](data-model/) — `04-entities.md` has the core tables,
`02-data-dictionary.md` the field definitions, `11-supasbase-migration-sequence.md`
the migration order. Those files are generated: edit the spreadsheet and run
`npm run export:data-model`, never hand-edit them.

Migrations live in `supabase/migrations/`, each with a paired rollback in
`supabase/rollback/`. Conventions, review requirements, and the local/staging
workflow are in [`supabase/MIGRATIONS.md`](../supabase/MIGRATIONS.md) — read
that before writing or reviewing a schema change.

For local development, `npm run seed` loads 50 fake organisations spread across
the pipeline; every row carries `is_seed = true` and the script refuses to run
against production. See [`docs/seed-data.md`](seed-data.md).

## Environment variables

Every environment-dependent value is declared in `src/lib/env.ts` (the
schema) and validated at startup via `assertEnv()`. See
[`docs/environment-variables.md`](environment-variables.md) for what each
variable is, where to get its value, and how local/staging/production differ.

## `src/lib/` map

| Path | What it's for |
| --- | --- |
| `validation.ts` | Shared Zod-based input validation |
| `auth/require-approved-user.ts` | The one permission check that exists today |
| `log-security-event.ts` | Structured logging for validation/permission/auth failures |
| `error-logging.ts` | Unhandled-error capture, scrubbing, Sentry/console dispatch |
| `env.ts` | Environment variable schema and startup validation |
| `supabase/server.ts` | Server-side Supabase client (Server Components/Actions) |
| `supabase/proxy.ts` | Session-refresh Supabase client, used by `src/proxy.ts` |
| `seed/config.ts`, `seed/fixtures.ts` | Fake-data generation for `npm run seed` |

## Where to go next

- Contributing rules, branch model, commit style, PR process, and the
  Definition of Done: [`CONTRIBUTING.md`](../CONTRIBUTING.md).
- Who can read and write what: [`docs/rls-permission-matrix.md`](rls-permission-matrix.md).
- Table and field definitions: [`docs/data-model/`](data-model/).
- Handling credentials: [`docs/secrets.md`](secrets.md).
- Decisions still open, and why: [`docs/open-questions.md`](open-questions.md).
