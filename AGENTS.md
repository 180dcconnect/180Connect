<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Before you write any code

- `src/proxy.ts` replaces `middleware.ts`. There is no `middleware.ts` in this project.
- Mutations use Server Actions (`"use server"` files colocated with pages), not API route handlers.
- Validation goes through `src/lib/validation.ts` (wraps Zod), not raw Zod calls.
- Test files must import with an explicit `.ts` extension (e.g. `import { foo } from "./bar.ts"`).
- The React Compiler is enabled (`reactCompiler: true` in `next.config.ts`).

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
- **Do not copy the file next to the one you are editing.** The app is mid-migration and most screens are on the old language. `src/app/clients/[id]/` is the reference; `src/app/admin/*` and `src/app/clients/page.tsx` are not.

## CI workflows

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `tests.yml` | push/PR to dev/main | `npm test` + `npm run lint` + `npx tsc --noEmit` |
| `migrations.yml` | push to dev/main (supabase/** changes) | verify (pgTAP + RLS coverage + anon lockout) → auto-apply to staging/production |
| `secret-scan.yml` | PRs | gitleaks — fails if a credential is committed |

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
- [`docs/client-list-sorting.md`](docs/client-list-sorting.md) — how `/clients` is ordered, and the pipeline-status order
- [`docs/ingestion.md`](docs/ingestion.md) — the whole ingestion pipeline: the four stages, every source, what runs on a schedule
- [`docs/charity-register-import.md`](docs/charity-register-import.md) — how charity imports work; criteria are data (a query over a register file), never code
- [`docs/charity-import-guide.md`](docs/charity-import-guide.md) — the same thing for CAMs and admins: running an import, what the filters mean, refreshing the register
- [`docs/companies-register-import.md`](docs/companies-register-import.md) — the Companies House twin: why the file is a filtered ~12% of the register, what the build keeps, what the screen chooses
