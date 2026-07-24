# Architecture

How the pieces of 180Connect fit together. Read this once, after Setup in the
[README](../README.md), before touching auth, routing, or error handling.

## This is a modified Next.js

`AGENTS.md` (repo root) says it plainly: this fork renames and changes some
conventions from stock Next.js. The one that trips people up most:

**`src/proxy.ts` replaces `middleware.ts`.** There is no `middleware.ts` in
this project — request-level interception (session refresh, redirects) lives
in `src/proxy.ts` instead. Before writing code that touches routing, proxy, or
Server Actions, skim the relevant guide under
`node_modules/next/dist/docs/01-app/`, since the on-disk docs match this
fork's behaviour, not necessarily what you remember from stock Next.js.

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
- **Full RBAC/RLS is not built yet.** There are no roles beyond
  approved/not-approved, and no row-level security policies in application
  code today — those land with F224. `requireApprovedUser` is the one
  permission primitive that exists in the meantime.

## Validation

`src/lib/validation.ts` is the shared validation layer: `safeValidate` wraps
Zod's `safeParse` and returns per-field errors instead of throwing, plus
reusable field types (`emailField`, `urlField`, `nonEmptyTrimmed`,
`boundedInt`). Every form/Server Action should validate through this module —
see `src/app/login/actions.ts` for the reference usage — rather than calling
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
  through the scrubbing/Sentry pipeline above. It's a stand-in until the
  `ERROR_LOG` table and F221 audit logs exist — swap its body then, callers
  shouldn't need to change.

## Data and migrations

No ORM. Postgres schema lives entirely in `supabase/migrations/` (plain SQL,
Supabase CLI), with a paired rollback in `supabase/rollback/` for every
migration. Conventions, review requirements, and the local/staging workflow
are documented in full in [`supabase/MIGRATIONS.md`](../supabase/MIGRATIONS.md)
— read that before writing or reviewing a schema change.

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

## Where to go next

- Contributing rules, branch model, commit style, PR process:
  [`CONTRIBUTING.md`](../CONTRIBUTING.md).
- What "done" means before you ask for review:
  [`.github/pull_request_template.md`](../.github/pull_request_template.md).
