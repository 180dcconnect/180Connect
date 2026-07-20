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

Secrets (API keys, database URLs) live in a file called `.env.local`, which is **never committed to Git**. Start from the template:

```bash
cp .env.example .env.local
```

`.env.example` lists every variable the app knows about, with a comment saying what it is and where to get it. It contains no real values, so it is safe to commit.

Now fill it in from Supabase:

1. Ask the Project Manager for an invite to the Supabase organisation, then accept it.
2. Open the **Development** project at https://supabase.com/dashboard.
3. Go to **Project Settings → API Keys**.
4. Copy the **Project URL** into `NEXT_PUBLIC_SUPABASE_URL`.
5. Copy the **publishable key** — it starts with `sb_publishable_` — into `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

Note what did *not* happen there: nobody sent you a key. You were given access to the store and took the value yourself. That is the rule — if you are ever waiting on someone to paste a credential at you, the real fix is an invite.

> The dashboard also shows a **legacy anon key**, a long string starting `eyJ`. It still works, but Supabase is phasing it out. Use the `sb_publishable_` one.
>
> On the same page there is a **secret key** (`sb_secret_…`, previously called `service_role`). It bypasses every row-level security rule in the database. Do not put it in `.env.local` unless a task specifically tells you to, and never give it a `NEXT_PUBLIC_` prefix.

#### What the `NEXT_PUBLIC_` prefix means

This one catches people out, so read it before you add a variable of your own.

| Prefix | Where it can be read | Use for |
| --- | --- | --- |
| `NEXT_PUBLIC_…` | Baked into the JavaScript sent to the browser. **Anyone can read it in devtools.** | Values that are public by nature — the app's URL, the Supabase publishable key |
| no prefix | Server only — route handlers, server components | Everything secret |

If a secret does not work in a client component, the fix is to move the code to the server. Adding `NEXT_PUBLIC_` publishes it to every visitor.

`docs/environment-variables.md` has the full detail, including what happens when a variable is missing.

#### Never do this

- Paste a key into Slack, Discord, WhatsApp, email, a Jira ticket, or a screenshot
- Commit a key, even to a branch you plan to delete — the history keeps it
- Hardcode a key in a `.ts` file "just to test it"

A [secret scan](.github/workflows/secret-scan.yml) runs on every pull request and will fail the check if it finds a credential. If you think you have committed one, say so straight away — the key gets rotated in Supabase and Vercel, and nothing bad happens. Staying quiet is what turns it into an incident.

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

## Day-to-day Git

Never commit straight to `main`. Branch, push, open a pull request.

```bash
git checkout main
git pull                          # get everyone else's latest work
git checkout -b your-name/feature # branch for your task
# ...make changes...
npm run build                     # make sure it still builds
git add -A
git commit -m "add signup form"
git push -u origin your-name/feature
```

Then open a pull request on GitHub and ask for a review.

## Troubleshooting

**`command not found: npm`** — Node isn't installed, or the terminal predates the install. Open a fresh terminal.

**Port 3000 already in use** — another dev server is still running. Kill it, or run `npm run dev -- -p 3001`.

**Something broke after pulling** — someone added a dependency. Run `npm install` again.

**Errors mentioning `node_modules`** — delete it and reinstall: `rm -rf node_modules && npm install`.
