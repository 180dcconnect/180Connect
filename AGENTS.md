<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Who will maintain this app

The app is built by a technical developer, but it is being built on the assumption
that **non-technical people will run and maintain it** once that developer moves on.
Admins, CAMs and branch leadership are consultants, not engineers: they know the
clients, not the database. Design every screen — especially admin and settings
screens — for them:

- **Never ask a user to type or read an internal name.** No column names
  (`trading_name`), table names, enum values, IDs or error codes on screen. Offer a
  list of choices in plain English and translate internal names at the edge.
- **Say what a setting does in the words of the job**, not the implementation:
  "CAMs must suggest a change and an admin approves it", not "column-guard trigger".
- **Errors say what to do next**, never what Postgres said.
- **Prefer a choice over free text** wherever the valid answers are knowable, so a
  wrong answer is impossible rather than rejected.
- **A change should be undoable from the same screen**, and the screen should say so.
- If something genuinely needs a developer, say that plainly on the page rather than
  exposing the knob.

## Before you write any code

- `src/proxy.ts` replaces `middleware.ts`. There is no `middleware.ts` in this project.
- Mutations use Server Actions (`"use server"` files colocated with pages), not API route handlers.
- Validation goes through `src/lib/validation.ts` (wraps Zod), not raw Zod calls.
- Test files must import with an explicit `.ts` extension (e.g. `import { foo } from "./bar.ts"`).
- The React Compiler is enabled (`reactCompiler: true` in `next.config.ts`).
- Every new control has to answer for a `viewer` before it ships — see
  [Roles: every control answers for a viewer](#roles-every-control-answers-for-a-viewer).

## Roles: every control answers for a viewer

Three roles, and the third catches people out.

| Role | Who | What they may do |
| --- | --- | --- |
| `cam` | Client Account Managers | Work the client list: edit, contact, manage tags. No admin-only screens. |
| `admin` | Administrators | Everything: approvals, imports, platform settings. |
| `viewer` | 180DC leadership — branch and global | **See every screen an admin sees. Change nothing.** |

`src/lib/auth/permissions.ts` is the whole model. `canView` answers *what
renders*; `hasPermission` answers *what a write does*; `isViewOnly` answers
"this person changes nothing". Pages gate with `getViewingActor`, writes with
`getCurrentActor` — and the write's own gate is the load-bearing one, never the
route the reader arrived by.

So a viewer reaches every admin screen, and **each one has to decide what to
show them.** A feature is not finished until that decision is made and written
down in the code:

- **Never render a control they cannot use.** No Approve/Reject, no "New
  import", no lookup or backfill button, no editable tag, no invite or role
  picker. They get the queue, the numbers, the history around it. A button whose
  only possible outcome is a refusal is a bug report waiting to happen, and a
  queue with no visible way to answer it reads as broken.
- **Say why, in one voice.** Where the control would have been, render
  `VIEW_ONLY_CONTROL_NOTE` from `src/lib/auth/view-only.ts`. Do not leave a
  silent gap, and do not invent a second phrasing of it.
- **Ask the same permission the action asks.** `hasPermission(actor.role,
  "approval:manage")` in the page, never `role === "admin"` — the literal and the
  permission drift apart the first time a permission moves.
- **Keep the reading.** Coverage counts, queue contents, run history and audit
  trails stay whole for a viewer. Withholding a number they are entitled to see
  is the same mistake wearing the opposite coat.
- **Decide group tabs too, not just page bodies.** A tab that is only a starting
  point for a write ("Add a client") is not offered to a viewer; a tab that is
  also a page to read is. See `dataImportsTabsFor` in `admin/import-group.ts`.
- **Refusals still have to land.** A viewer who reaches a write anyway is refused
  by `getCurrentActor`, which sets the cookie `view-only-notice.tsx` watches for.
  That is why no refusal needs a dialog of its own — and why a write gated any
  other way is a write a viewer can attempt with no explanation.

When you add a screen, check it as all three roles before you call it done.

## Quick commands

```bash
npm run lint                     # ESLint
npx tsc --noEmit                 # typecheck
npm run build                    # production build (run ONLY when explicitly requested)
npm test                         # unit tests (Node built-in test runner, not Jest/Vitest)
npm run seed                     # load 50 fake organisations into local DB
npm run seed:clear               # remove all is_seed rows
npm run register:build           # rebuild the charity register file (CI does this; ~12 min)
npm run companies-register:build # rebuild the companies register file (CI does this; ~3 min)
```

**Pre-push order:** `npm run lint` → `npx tsc --noEmit`
**CRITICAL:** Never run `npm run build` unless the user explicitly asks for it.

## Architecture at a glance

- **Next.js 16** (App Router) · **React 19** · **TypeScript 5** · **Tailwind CSS v4** · **Supabase**
- `src/app/` — routes; `src/lib/` — business logic; `src/components/` — UI
- Auth: Supabase Auth via `@supabase/ssr`, session refresh in `src/proxy.ts`
- No ORM. Postgres, plain SQL, Supabase CLI.
- Deploy: Vercel, auto from `dev` (staging) and `main` (production). Branches not listed in `vercel.json` are not deployed.

## Database & migrations

- Schema source of truth: the Data Model spreadsheet (SOP §7), **not this repo**.
- Markdown projection lives in `docs/data-model/` — `04-entities.md` (tables), `11-supasbase-migration-sequence.md` (migration order). **Generated files** — run `npm run export:data-model`, never hand-edit.
- Migrations: `supabase/migrations/`. Conventions in [`supabase/MIGRATIONS.md`](supabase/MIGRATIONS.md).
- **Every new table must ship with RLS enabled and policies in the same migration** (SOP §7). Build policies from `app.*` helper functions, not raw role checks.
- Any write that changes ownership, status, role, or approval state must record an audit log entry via a `SECURITY DEFINER` RPC — see [`docs/audit-log-pattern.md`](docs/audit-log-pattern.md).
- Migration timestamps must be later than every migration already on `dev`. Stale timestamps break staging for the whole team. `scripts/verify-migration-order.sh` catches this in CI.

## Branching & PRs

- **The default branch is `dev`, not `main`.** Tooling that reports `main` as
  the default — Claude Code's session header included — is reading a stale
  repository setting someone set by mistake. Every PR targets `dev`; treat any
  suggestion to PR into `main` as wrong. This matters beyond etiquette:
  GitHub only exposes a workflow to `workflow_dispatch`, and only fires its
  `schedule`, once the file exists on the **default** branch — so a workflow
  that has not reached `dev` cannot be run at all.
- Branch from `dev`, PR into `dev`. **Never commit straight to `main` or `dev`.**
- `main` only receives weekly merges from `dev` (PM decision).
- Branch naming: `feature/`, `fix/`, `chore/` + backlog ID where applicable.
- One approval required; author merges (squash). Reviewer approves but doesn't merge.
- See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full model.

## Visual design

Two systems, one per side of the login. Read the right one **before** touching UI.

- Public pages (landing, legal, login — before sign-in): [`docs/design-system.md`](docs/design-system.md). Tokens in `src/components/brand/`.
- Logged-in app (`/dashboard`, `/clients`, `/admin`, `/settings`): [`docs/app-design-system.md`](docs/app-design-system.md). Tokens in `src/app/globals.css`.
- **Never copy hex values or variants into a page file.** Import the token.
- **Do not copy the file next to the one you are editing.** The app is mid-migration and most screens are on the old language. `src/app/(app)/clients/[id]/` is the reference; `src/app/(app)/admin/*` and `src/app/(app)/clients/page.tsx` are not.

## CI workflows

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `tests.yml` | push/PR to dev/main | `npm test` + `npm run lint` + `npx tsc --noEmit` |
| `migrations.yml` | push to dev/main (supabase/** changes) | verify (pgTAP + RLS coverage + anon lockout) → auto-apply to staging/production |
| `secret-scan.yml` | PRs | gitleaks — fails if a credential is committed |

## Infrastructure budget

**We are on the Supabase free plan and that is what the branch can afford.** Treat it
as a design constraint, not a temporary state — do not propose anything that assumes
an upgrade.

| Quota | Limit | Notes |
| --- | --- | --- |
| Database | **500 MB** | Shared across every table. The binding constraint. |
| File storage | 1 GB | Separate quota — Storage bytes do not touch the 500 MB. |
| Active projects | 2 | staging + production, already both spoken for ([`docs/staging-environment-setup.md`](docs/staging-environment-setup.md)) |
| Inactivity | pauses after 7 days | Wake it from the dashboard |

What this means in practice:

- **Never store file bytes in a table.** Bytes go in Supabase Storage; the database
  holds metadata and foreign keys. `outreach_message_attachments` is the pattern to
  copy — a link table, so one stored file can be attached to any number of emails at
  ~50 bytes of database each.
- Anything written once per email, per client, or per import needs a row-size
  sanity check before it ships. 500 MB disappears fast at a megabyte a row.
- No point-in-time recovery on this plan. See
  [`docs/staging-environment-setup.md`](docs/staging-environment-setup.md) §"500 MB
  database limit" for the monitoring and fallback plan.

## Gotchas

- `package.json` engines say Node 24.x; CI uses 22.x. Match whatever your environment provides.
- `src/lib/supabase/admin-client-factory.ts` bypasses `server-only` guard. ESLint blocks importing it from `src/` except in `admin.ts` and `src/lib/ingestion/` / `src/lib/standardize/`.
- `NEXT_PUBLIC_` vars are inlined into the browser bundle — never prefix a secret with it.
- Seed scripts refuse to run against production. They check `SUPABASE_DB_URL`.
- Never run `npm run build` unless the user explicitly asks for it. Use `npm run lint` and `npx tsc --noEmit` for validation instead.

## Key reference docs

- [`docs/architecture.md`](docs/architecture.md) — how auth, validation, errors, and the DB fit together
- [`docs/app-design-system.md`](docs/app-design-system.md) — the logged-in app's visual language: surfaces, type, colour, motion, and how to convert an old screen
- [`docs/rls-permission-matrix.md`](docs/rls-permission-matrix.md) — who can read/write what
- [`docs/data-model/`](docs/data-model/) — table and field definitions
- [`docs/environment-variables.md`](docs/environment-variables.md) — every env var, where to get it
- [`supabase/MIGRATIONS.md`](supabase/MIGRATIONS.md) — migration conventions and workflow
- [`docs/audit-log-pattern.md`](docs/audit-log-pattern.md) — required pattern for privileged writes
- [`docs/natural-language-search.md`](docs/natural-language-search.md) — F214: how a plain-English search becomes filters, why the model never sees a client record, and every control that keeps it at ~$0.0006 a search
- [`docs/client-list-sorting.md`](docs/client-list-sorting.md) — how `/clients` is ordered, and the pipeline-status order
- [`docs/ingestion.md`](docs/ingestion.md) — the whole ingestion pipeline: the four stages, every source, what runs on a schedule
- [`docs/charity-register-import.md`](docs/charity-register-import.md) — how charity imports work; criteria are data (a query over a register file), never code
- [`docs/charity-import-guide.md`](docs/charity-import-guide.md) — the same thing for CAMs and admins: running an import, what the filters mean, refreshing the register
- [`docs/companies-register-import.md`](docs/companies-register-import.md) — the Companies House twin: why the file is a filtered ~12% of the register, what the build keeps, what the screen chooses
