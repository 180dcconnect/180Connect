<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Visual design

Public-facing pages (landing, legal, login — anything before sign-in) follow a
specific visual language. Read [`docs/design-system.md`](docs/design-system.md)
before building or restyling one.

Colours, easing, and the shared chrome live in `src/components/brand/` and that
code is the source of truth — import it, never copy a hex or a variant into a
page file. The logged-in app is exempt: it uses the shadcn tokens in `globals.css`.

# Database schema

The schema's source of truth is the Data Model spreadsheet, not this repo (SOP §7).
A readable markdown projection of it lives in [`docs/data-model/`](docs/data-model/) —
read that for table and field definitions. `04-entities.md` has the core tables,
`11-supasbase-migration-sequence.md` has the migration order. Those files are
generated; edit the spreadsheet and run `npm run export:data-model`, never hand-edit.

Migrations live in `supabase/migrations/`; see [`supabase/MIGRATIONS.md`](supabase/MIGRATIONS.md)
for the conventions. Load fake test data with `npm run seed` ([docs](docs/seed-data.md)).

Any write that changes ownership, status, role, or approval state must record an
audit log entry — see [`docs/audit-log-pattern.md`](docs/audit-log-pattern.md) for
the required pattern before writing that migration.
