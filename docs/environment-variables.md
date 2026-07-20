# Environment variables

How 180Connect handles configuration that differs between environments — F231.

## The rule

**Anything that differs between local, staging and production is an environment
variable.** API keys, database URLs, base URLs, feature flags. None of it goes
in the codebase.

There are exactly three places a variable exists:

| Place | What it is | Committed? |
| --- | --- | --- |
| `src/lib/env.ts` | The schema — the single source of truth for what exists, what is required, and what counts as a valid value | Yes |
| `.env.example` | The documented list, with a comment per variable and where to get the value | Yes (no real values) |
| `.env.local` | Your actual local values | **No** — gitignored |

Adding a variable means editing the first two. If you only edit `.env.local`,
it works on your machine and nowhere else.

## Setting up as a new developer

```bash
cp .env.example .env.local
npm run dev
```

Fill in `.env.local` from the comments in the file. Anything under
`# --- Required ---` must have a value or the server will not start.

## What happens when a variable is missing

`src/instrumentation.ts` runs `assertEnv()` once, on server startup, before any
request is handled. If a required variable is missing or malformed the server
stops with every problem listed at once:

```
Environment is not configured correctly (1 problem):
  - NEXT_PUBLIC_APP_URL is required but not set

Copy .env.example to .env.local and fill in the values.
See docs/environment-variables.md for what each variable is and where to get it.
```

This is deliberate. The alternative — `undefined` flowing into a fetch URL or a
database client — produces a confusing failure much further from the cause.

Error messages report the variable **name** and what is wrong with it. They
never include the value, so a malformed secret cannot leak into a log or a
deployment output.

## Server-only vs browser

- **No prefix** — server only. `process.env.SUPABASE_SERVICE_ROLE_KEY` is
  readable in route handlers and server components, and is never sent to the
  browser. All secrets go here.
- **`NEXT_PUBLIC_` prefix** — inlined into the JavaScript bundle at build time
  and **visible to anyone who opens devtools**. Only for values that are public
  by nature, such as the app's own URL or the Supabase anon key.

Never add `NEXT_PUBLIC_` to a secret to "make it work" in a client component.
That publishes it. Move the code to the server instead.

Because `NEXT_PUBLIC_` variables are substituted textually at build time, they
must be read with static property access — `process.env.NEXT_PUBLIC_APP_URL`.
A dynamic lookup like `process.env[name]` is not replaced and reads as
`undefined` in the browser. This is why the `env` object at the bottom of
`src/lib/env.ts` spells each one out rather than looping over the schema.

## Marking a variable required

Variables for features that have not been built yet are declared with
`required: false`, so the app still starts. When you merge the feature that
consumes one, flip it to `required: true` in `src/lib/env.ts` and move it under
the required heading in `.env.example` — in the same pull request, so nobody
deploys the feature without its configuration.

## Where values live per environment

Local development uses `.env.local`. Deployed environments use the hosting
platform's own secret storage rather than files.

> **Open decision.** Which platform holds the deployed secrets — Vercel project
> environment variables, GitHub Actions secrets, or Supabase — is not settled.
> It is tied to Q-01 and D-02 in [open-questions.md](./open-questions.md): with
> no staging environment there is currently only one deployed target to
> configure. The schema and validation above are unaffected by that choice; only
> the place the values are typed in changes.
