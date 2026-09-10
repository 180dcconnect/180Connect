# F127: Recurring Scheduled Follow-Up — descoped

Found while triaging the Email Sending backlog, 10 September 2026.

## What is wrong

F127 (#123) asks for a CAM to set up a recurring follow-up schedule — every N
days, auto-firing — for a client.

Two things it depends on already ship the value, and the remaining gap
between "already shipped" and "as specced" is a feature that shouldn't exist:

- **F160 (Follow-Up Recommendations, #155, closed)** already recommends a
  follow-up after 7/14 days in the CRM pipeline. The user story's actual
  need — "clients are not forgotten" — is met.
- **F126 (Schedule Email, #122, closed)** already lets a CAM manually
  schedule the next send once reminded.

What F127 adds on top is auto-firing sends on a timer without the CAM
re-initiating each one. That conflicts with a Definition of Done requirement
that applies to every outreach feature: *"Any outreach feature proves that
sending is impossible without explicit human approval."* An unattended
recurrence engine either violates that outright, or is gated by an approval
step every cycle — at which point it's indistinguishable from a CAM manually
rescheduling off the F160 reminder, and the automation buys nothing.

It's also worse today than when the issue was written. `61b17333` (9 Sept
2026) corrected the outreach sending model: everyone sends from one shared
branch mailbox (`clients.sheffield@180dc.org`) with pooled reputation, and
Gmail's send API gives no bounce/complaint/engagement signal back. Stacking
automated recurring sends on that — with no way to detect a client marking
one as spam — is the wrong direction for the "spam/reputation limits" risk
the issue itself flags.

Pre-filling the next follow-up draft from the reminder was considered as a
smaller alternative and rejected too — it would spend an LLM call to write a
draft the CAM may not use, for a convenience F160 + F126 already cover
manually.

## Why it was deferred

The literal spec (auto-recurring send) conflicts with the human-approval DoD
requirement. Anything scoped to comply with that requirement collapses into
what F160 + F126 already deliver. No version of this adds value the platform
doesn't already have, and the shared-mailbox reputation risk argues against
building it at all.

## What to do

Nothing. F160's reminder + F126's manual schedule is the feature. No new
schema, no scheduler, no pre-filled draft.

## Who decides

Already agreed with Bashir (Project Leader). #123 (F127) should stay
closed/descoped.
