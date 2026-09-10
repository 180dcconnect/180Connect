# F211: Time Spent Tracking — descoped

Found while triaging the Analytics backlog, 10 September 2026.

## What is wrong

F211 (#206) asks for per-CAM time-spent tracking — session duration, actions
per session — sourced from the audit log (F221 / #216).

There is no clean way to build this:

- The audit log (F221) records discrete privileged writes (ownership, status,
  role, approval changes) with a timestamp each. It has no session start/end
  event, so "session duration" would have to be inferred by clustering
  timestamps with an arbitrary gap threshold — a made-up number, not a
  measurement.
- A real answer needs a session-heartbeat table (a row per CAM every few
  minutes, indefinitely). That is new schema whose only purpose is a
  low-value chart, and it runs against the 500 MB database budget (AGENTS.md
  → Infrastructure budget) — a table with no natural cap, unlike the
  patterns already used elsewhere (e.g. the 200-row trash cap in
  [`inbox-thread-state.md`](inbox-thread-state.md)).

The issue's own "Blocked By / Open Questions" field says: *"Whether to track
this ethically."* CAMs are volunteers, not employees. Time-on-platform is a
surveillance metric on unpaid student consultants, and the value it adds is
small — F206 (CAM Personal Analytics, #201) already surfaces the metrics that
actually matter: emails sent, reply rate, conversions. Time spent adds noise
on top of numbers that are already better signal, since a CAM who writes a
good email in 10 minutes outperforms one who leaves a tab open for 3 hours.

## Why it was deferred

No version of this clears all three bars at once: a real (non-inferred) data
source, a schema that fits the free-plan budget, and an ethical answer to the
question the issue itself raises. Building it anyway trades a real cost
(volunteers feeling watched, possible platform disengagement) for a metric
with no demonstrated value over what F206 already ships.

## What to do

Nothing, unless a PM decision reverses this. If revisited:

- **DECISION** — needs an explicit PM call on whether to track this at all,
  and if so, whether admins can see it (the issue also leaves this open — "A
  CAM can see their own time-spent data; whether admins can also see it is an
  explicit, agreed decision documented for the team").
- If approved, the data source has to be re-scoped away from "session
  duration" — the audit log cannot produce that number honestly.

## Who decides

PM. #206 (F211) should stay closed/descoped unless a PM reopens it with an
answer to the ethics question and a real data source.
