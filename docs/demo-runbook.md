# Demo runbook

How to walk the app in front of an audience and have every screen show
something true.

Nothing here is a simulation. Every feature below is the real, merged
implementation running against the real staging database — the only thing the
demo adds is **data**, via one reversible seed command. If you clear the seed,
the app behaves exactly as it did before.

---

## Before you start

### 1. This branch now has everything

`feature/app-ui` was 14 commits behind `dev`, and the gap was exactly the
features you wanted to demo. `origin/dev` is merged in as of this branch, so
these are all here for real:

| On the demo list | Where it came from |
| --- | --- |
| F168–F172 — Actions epic | #552 |
| F181 — Approval Tab | #521 |
| F180 — Admin Dashboard | #519 |
| F018 — Contact Permission Rules | #514 |
| F186 — View Client Change History | #511 |
| F174 / F175 — Reply and reminder notifications | #535, #536 |
| F176–F178 — Team activity notifications, delivery frequency | #539–#541 |
| F206–F212 — CAM and team outreach analytics | #543 |
| F219 — Attachments linked to timeline events | #546 |
| F154 AC3 — auto-transition to No Response | #545 |

Everything else on the list (F131–F139 replies, F143–F161 statuses and
follow-ups, F182 team pipeline, F183 stall detection) was already on this
branch.

**One item on the list is not built anywhere** — see
[What is not built](#what-is-not-built) at the bottom. Don't promise it.

### 2. Load the demo scenario

```bash
npm run seed:demo          # writes it
npm run seed:demo:clear    # removes it, exactly
```

It writes 15 named clients and the work around them: the actions an admin
assigned, the emails sent, the replies that came back, the suggested edits
waiting on a decision, the notifications those events produced, and the audit
trail behind them. Every row is minted into one uuid namespace
(`dec0de00-…`), so the clear deletes precisely the demo and nothing else. It
is idempotent — run it twice and you get the same scenario, not two of them.
It refuses to run against production, using the same two guards as
`npm run seed`.

Run it **shortly before the demo**. The dates are computed at insert time, so
"overdue by six days" and "replied 21 hours ago" stay true relative to when you
seed, not to when this file was written.

### 3. Sign in as the right person

Two accounts, and the story needs both. Password for both is the standard test
password from `npm run seed:test-accounts`.

| Role | Email | Used for |
| --- | --- | --- |
| CAM | `bashir-cam@180dc.org` | Storylines 1 and 2 |
| Admin | `bashir-admin@180dc.org` | Storyline 3, and the assigning half of 1 |

Have **two browser profiles** (or one normal window and one incognito) already
signed in, one per role. Switching accounts mid-demo is the single most likely
thing to break the flow.

### 4. Check it took

Sign in as the CAM and open `/actions`. You should see five open actions, two
of them flagged overdue. If you see an empty state, the seed did not run
against the database the app is pointed at — check `SUPABASE_DB_URL` in
`.env.local` and re-run.

---

## The cast

Everything below refers to these. They are invented organisations; every
mailbox and website is `@example.org`.

| Client | Status | Owner | Why it exists |
| --- | --- | --- | --- |
| Riverbank Youth Trust | Responded | demo CAM | The warm one. Reply, notification, note, full audit trail |
| Northlight Mental Health Foundation | Follow-up sent | demo CAM | The overdue action, and an approved + a rejected edit |
| Coalfield Heritage Society | Initial outreach sent | demo CAM | A scheduled send, and a pending name correction |
| Two Rivers Food Network | Converted | demo CAM | The win. Signed-letter reply, discrepancy resolved by hand |
| Harbour Lights Sea Rescue | No response | demo CAM | Five weeks of silence, second overdue action |
| Greenway Cycling Access CIC | Future potential | demo CAM | The action with no due date |
| Stonebridge Refugee Welcome | Not contacted | demo CAM | Untouched, and a completed action |
| Wearside Youth Music Trust | Follow-up sent | demo CAM | **The stalled one** — 24 days quiet, no open action |
| Ashfield Carers Alliance | Soft no | Test CAM | A polite decline, with the reply behind it |
| Pennine Woodland Recovery | Hard no | Test CAM | |
| Clyde Digital Skills Trust | Loss due to timing | Test CAM | |
| Fenland Water Justice | Follow-up sent | Test CAM | Another CAM's overdue work, for the admin view |
| Brightside Disability Sport | Responded | Test CAM 1 | A "tell me more" reply — not every yes is a yes |
| Old Docks Community Land Trust | Initial outreach sent | Test CAM 1 | |
| Marsh Lane Animal Sanctuary | Initial outreach sent | Test CAM 1 | **Owned by someone else** — this is the F018 demo |

---

## Storyline 1 — the CAM's day

**F168 → F169 → F170 → F172 → F171.** Signed in as the **CAM**.

The line to open with: *an admin assigns the work, the CAM sees it, it has a
deadline, late work is visible, and finishing it is one click.*

1. **`/dashboard`** — start here, not on the Actions tab. The **Needs
   attention** panel already carries the overdue badge (F172 AC3), so the CAM's
   day starts with the problem rather than with a list. Point out **Follow-ups
   due** beside it (F160/F161): Wearside has gone quiet and the app noticed
   without being asked.

2. **Bell, top of the sidebar** — three unread for this CAM: the Riverbank
   reply (F133/F174) and one reminder for each overdue action (F175). The
   Brightside reply went to the CAM who owns it, not to everyone. Click the
   Riverbank one; it lands on the client.

3. **`/actions` — My actions (F168).** Five open, grouped by due date. Each row
   names the client it belongs to and **who assigned it** — none of these are
   self-set, they all came from an admin (F169).

   Three things to point at, in this order:
   - **The two overdue rows (F172).** Flagged, and sorted to the top.
   - **Greenway, with no date at all (F170).** A due date is optional, and an
     undated action does not pretend to be late.
   - **Riverbank, due in two days.** A deadline that is not yet a problem.

4. **Mark one complete (F171).** Do it on the Riverbank row — it is the one
   with a story behind it. The row leaves the open list immediately. Say what
   happened underneath: completion runs through an audited RPC, so
   `/admin/audit-log` has the record of who completed it and when. That is not
   a UI promise, it is the same transaction.

5. **Switch to the admin window → `/admin/actions` (F169).** The other half:
   every assigned action across the team, outstanding separated from completed.
   Fenland belongs to a different CAM. Assign a new action here and it appears
   on that CAM's own tab on their next page load — no accept step, no
   plumbing.

---

## Storyline 2 — outreach, replies and permission

**F018 → F131–F139 → F174 → F175 → F181.** Mostly the **CAM**; the last step
is the **admin**.

The line: *only the CAM who owns a client may contact them, replies come back
into the app rather than into someone's mailbox, and an admin can see what is
waiting on a decision.*

1. **F018, contact permission — do this first, and do it as the failure.**
   Open **Marsh Lane Animal Sanctuary** (owned by Test CAM 1, not by you) and
   go to the **Outreach** tab. The card says it plainly: *"owned by Test CAM 1.
   Outreach is blocked to prevent duplicate contact"* — and it is not merely a
   hidden button. The check runs again inside the send and schedule actions
   themselves, because ownership can change after a draft is written.

   Then show the legitimate route: **Request this client** on the same card.
   CAMs ask; only an admin moves ownership.

2. **Compose from the inbox — worth showing, and it is real.** Hit Compose in
   `/inbox`, type "Riverbank" into the recipient capsule and pick the address.
   Recipient lookup reads the actual clients in the database, so the picked
   address resolves to an organisation — that is what makes **Review & send**
   live. It creates the draft row (running the ownership and suppression
   checks) and then opens the *same* review panel the client record uses: the
   approval tick, then the send. There is one approval gate in the app and this
   window borrows it rather than keeping its own.

   Two things to say if asked: an address matching no client leaves the button
   disabled with the reason on hover, and scheduling lives in the review step
   with the send, not on the caret.

3. **`/inbox` (F131, F132, F134).** The replies are here, threaded, each one
   attached to the client it came from rather than sitting in a mailbox
   somewhere. Open **Riverbank** — the full thread, our email and their reply
   in order (F134).

4. **Three replies, three different meanings** — this is the part worth
   dwelling on:
   - **Riverbank** — interested. A yes.
   - **Brightside Disability Sport** — "what does this cost us in staff time?"
     Classified as *more info*, not as a win (F137's whole point).
   - **Ashfield Carers Alliance** — a polite no, and the status says
     **Soft no**, not Hard no. The difference is whether we come back in the
     spring.

5. **The reply moved the status on its own (F158/F149).** Riverbank reads
   **Responded**, and nobody clicked it. Open the **Activity** tab: the status
   change is in the timeline, attributed to reply detection, not to a person.
   Then say the guard out loud — a reply arriving after a CAM has already
   closed an engagement does **not** silently reopen it. A deliberate human
   decision stands.

6. **A note off the back of a reply (F136).** The Riverbank note is the
   diagnosis pulled out of their email: a third of regular givers lapse inside
   eighteen months. That is the project.

7. **Response time (F138/F139).** `/analytics` — the CAM's own numbers: emails
   sent, replies, conversion, and average turnaround. Same readings the team
   view rolls up.

8. **`/admin/approvals` (F181)** — switch to the **admin** window. Four
   suggested client edits waiting, from three different CAMs, each with the
   proposer's reason next to the change. Approve the Northlight mailbox
   correction: the value lands on the live record. Reject one and give a
   reason: nothing is written, and the record of the decision is kept anyway,
   because a repeatedly-rejected field is a data-quality signal.

---

## Storyline 3 — admin oversight

**F182 → F183 → F186.** Signed in as the **admin**.

The line: *an admin sees the whole pipeline, the app points at what has gone
quiet, and any client's history is auditable field by field.*

1. **`/admin/dashboard` (F180)** — team-wide activity, funnel, sector
   performance. The map before the detail.

2. **F183, stall detection — `?stalled=1`, or the Stalled filter.**
   **Wearside Youth Music Trust** is flagged: 24 days since the last thing that
   happened on it. The rule is worth stating, because the exclusions are the
   interesting part — a client is stalled when it is mid-pipeline, has been
   silent past the owning CAM's own threshold, **and has no open action on it**.
   An action already on someone's list is the CAM saying "I know", so the sweep
   stays quiet. That is why Northlight and Fenland are silent but not flagged.

4. **F186, change history.** Open **Northlight** → **Activity** tab. Above the
   provenance card, admin-only, is **Change history**: every recorded change to
   this client's fields — the suggested edit that was applied, the one that was
   **rejected** (kept in the trail even though nothing was written), and a
   **discrepancy the importer resolved automatically** when Charity Commission
   and Companies House disagreed on the city.

   Then open **Two Rivers Food Network** for the same tab: a discrepancy an
   admin resolved *by hand*, with the note explaining why the imported address
   was wrong.

5. **`/admin/analytics` (F210/F212)** — the team roll-up, including who may
   need support. Close on this: the same numbers each CAM sees for themselves.

---

## What is not built

**F214 (Natural Language Charity Search) is now on `dev`** (PR #555) — the
search bar's "Ask in plain English" field interprets a question and converts it
into filters. Demo it as built.

~~F215 (Search by Mission)~~ — **now built** on the `feature/f215-search-by-mission`
branch. The client list's search bar has a **"Filter by mission"** category:
type "climate" or "youth education" and the list keeps charities whose filed
mission text (ORGANISATIONS.charity_activities) contains those words, combined
with every other filter on the page. When Gemini is configured it also widens
the query to similar wording ("helping refugees" also matches missions saying
"asylum seekers") and says so above the list; without Gemini — or on timeout,
rate limit, or API failure — it falls back to exact-word matching and says that
too. Nothing to configure for a demo beyond the usual `GEMINI_*` env vars.

**A real send needs the branch mailbox configured.** The inbox composer and
the client record both send through the branch Gmail mailbox. On a local dev
server with no `GMAIL_*` variables set, a send is refused with *"The branch
outreach mailbox is not configured"* — the draft, the checks and the review
step all work, only delivery does not. Demo from the staging deployment if you
want the send to complete, and note that the demo clients' addresses are all
`@example.org`, which accepts no mail: the app will correctly record the send,
and the message will bounce. Send to your own address if you want to show mail
arriving.

One smaller gap, only if someone asks: **F018 AC3's admin override
confirmation dialog** is not in the UI on this branch. Admins are correctly
allowed through the permission check server-side (that is the AC), but the
"you are not the owner, are you sure?" dialog that `dev` had was written against
the old inline composer, which this branch replaced with the shared email
review panel. The block itself — the thing worth demoing — works.

---

## If something goes wrong

| Symptom | Cause | Fix |
| --- | --- | --- |
| `/actions` is empty | Seed did not run, or ran against a different database | Check `SUPABASE_DB_URL`, re-run `npm run seed:demo` |
| Seed refuses with "needs these accounts" | Test accounts missing on this database | `npm run seed:test-accounts`, then re-seed |
| Demo clients nowhere on `/clients` or team pipeline | ~2,750 real charities sort above them | Search the client's name, or filter by owner |
| Nothing is flagged stalled | Someone opened an action on Wearside, which suppresses the flag by design | Re-run `npm run seed:demo` to reset |
| Dates read wrong ("overdue by 40 days") | Seeded a long time ago | Re-run `npm run seed:demo` — dates are relative to the run |

## Afterwards

```bash
npm run seed:demo:clear
```

Removes the scenario exactly. `npm run seed:clear` also takes it, since every
demo client is marked `is_seed` too — so "get the fake data off staging" does
not depend on remembering there were two commands.
