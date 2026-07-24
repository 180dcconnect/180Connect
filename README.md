# 180Connect

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4

## Setup

Follow these once, in order. Works on both Windows and macOS. Anywhere you see a `$` command, type it into your terminal (Git Bash on Windows, Terminal on macOS) without the `$`.

### 1. Install the tools

| Tool | Where | Notes |
| --- | --- | --- |
| Node.js LTS (22.x or newer) | https://nodejs.org | Take the LTS installer. npm is included — don't install it separately. |
| Git | https://git-scm.com | On Windows this also installs **Git Bash**, which is the terminal you should use for everything below. |
| VS Code | https://code.visualstudio.com | Any editor works, but the rest of us are on this one. |

Check they worked:

```bash
node -v   # v22.x.x or higher
npm -v    # 10.x.x or higher
git -v    # 2.x.x
```

If any command says "not found", close the terminal, open a new one, and try again — installers only apply to terminals opened after them.

### 2. VS Code extensions

Install from the Extensions panel (`Ctrl/Cmd + Shift + X`):

- **ESLint** — flags mistakes as you type
- **Prettier** — formats code
- **Tailwind CSS IntelliSense** — autocompletes Tailwind class names

### 3. Configure Git

Set your identity so commits are attributed to you:

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

Set line-ending handling, or every file you touch will show up as fully rewritten in pull requests:

```bash
# Windows
git config --global core.autocrlf true

# macOS
git config --global core.autocrlf input
```

### 4. Get the code

```bash
git clone https://github.com/bashirbobboi/180Connect.git
cd 180Connect
npm install
```

`npm install` reads `package.json` and downloads everything the project needs into `node_modules/`. It takes a minute the first time.

### 5. Environment variables

Secrets (API keys, database URLs) live in a file called `.env.local`, which is **never committed to Git**. Copy the template and fill in real values — ask the team lead for them:

```bash
cp .env.example .env.local
```

`.env.example` is the authoritative, up-to-date list of every variable the app reads, which one are required, and where to get each value — see it directly rather than a copy of it here, so this README can't drift out of sync with it.

Never paste real values into a chat channel, a commit, or a screenshot.

For login access, an administrator must set the Supabase user's protected app
metadata to `{"account_status":"approved"}`. New or unapproved users should
not have that value; they will be signed out and shown the pending-activation
message. Do not put approval state in user metadata because users can edit it.

For detailed environment setup (including staging), see [Environment Variables Configuration](docs/environment-variables.md).

### 5a. Staging Environment & Deployment

180 Connect uses a three-environment setup: local development, staging (for testing), and production.

- **Local (`npm run dev`):** Points to shared dev Supabase project; safe for any testing
- **Staging (Vercel PR previews):** Also points to dev Supabase; created automatically when you open a pull request
- **Production (Vercel main branch):** Points to production Supabase; real client data

**Your workflow:**
1. Create a feature branch and make changes
2. If you changed the database schema, write the migration with `supabase migration new <name>` (see [supabase/MIGRATIONS.md](supabase/MIGRATIONS.md) for the full workflow) and commit it
3. Push to GitHub and open a PR
4. Vercel creates a preview deployment automatically (watch for the comment on your PR)
5. Test your changes in the preview
6. Merge to main → Vercel deploys to production

**Getting help?** See:
- [Staging Environment Setup](docs/staging-environment-setup.md) — comprehensive architecture & migration workflow
- [Staging Workflow Quick Reference](docs/staging-workflow-quick-ref.md) — quick day-to-day guide
- [Staging Implementation Checklist](docs/staging-implementation-checklist.md) — setup tasks for team leads
- [Database Migrations](supabase/MIGRATIONS.md) — schema change workflow, conventions, rollback

### 6. Run it

```bash
npm run dev
```

Open http://localhost:3000. Edit `src/app/page.tsx` and the page updates on save.

Stop the server with `Ctrl + C`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the local dev server on port 3000 |
| `npm run build` | Production build — run this before pushing to catch errors the dev server tolerates |
| `npm start` | Serve the production build locally |
| `npm run lint` | Run ESLint |

## Project layout

```
src/app/
  layout.tsx    root layout — wraps every page (fonts, <html>, <body>)
  page.tsx      the / route
  globals.css   Tailwind import + theme variables
public/         static files served as-is (images, icons)
```

In the App Router, a folder under `src/app/` becomes a URL, and the `page.tsx` inside it is what renders. `src/app/about/page.tsx` → `/about`.

For how auth, validation, error logging, and the database fit together, see [Architecture](docs/architecture.md).

## Contributing

Branch model, commit style, and the pull request process live in
[CONTRIBUTING.md](CONTRIBUTING.md) — read it before your first PR. What
"done" means for a piece of work is the Definition of Done in the
[pull request template](.github/pull_request_template.md).

## Troubleshooting

**`command not found: npm`** — Node isn't installed, or the terminal predates the install. Open a fresh terminal.

**Port 3000 already in use** — another dev server is still running. Kill it, or run `npm run dev -- -p 3001`.

**Something broke after pulling** — someone added a dependency. Run `npm install` again.

**Errors mentioning `node_modules`** — delete it and reinstall: `rm -rf node_modules && npm install`.
