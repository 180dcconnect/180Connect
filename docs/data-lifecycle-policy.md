# Data Lifecycle Policy

**Policy version:** 0.2 (DRAFT) · **Owner:** Bashir · **Reviewer:** Ben
**Adopted:** — · **Last updated:** 2 August 2026 · **Next review:** August 2027

Governs the whole life of data in 180Connect — how it is classified, why we are
allowed to hold it, how long we keep it, and how it is removed. Supersedes the
earlier `docs/data-retention.md`.

> **Naming.** Not to be confused with [`docs/data-model/01-data-lifecycle.md`](data-model/01-data-lifecycle.md),
> which is generated from the Data Model spreadsheet and describes the *processing
> pipeline* (ingestion → enrichment → scoring → outreach). That file says how data
> moves; this one says how long it lives and under what basis. Neither replaces the
> other, and this file is hand-maintained.

**Not legal advice.** Written by the engineering team to be defensible under UK
GDPR. §4 and §6 need sign-off from whoever owns compliance at 180DC before the
Status leaves DRAFT. See §10.

---

## Guiding principle

> 180Connect retains the minimum personal data necessary to fulfil its purposes,
> while retaining non-personal, anonymised, and operational data for as long as it
> continues to provide legitimate business, analytical, security, or compliance
> value. Where possible, personal data is anonymised or redacted rather than
> deleted, preserving historical integrity without unnecessarily identifying
> individuals.

Everything below is an application of that sentence. Where a rule here appears to
conflict with it, the principle wins and the rule is wrong.

## 1. Purpose

To satisfy the storage limitation (Art. 5(1)(e)) and accountability (Art. 5(2))
principles with a written, followed schedule; to give a defined route for data
subject rights requests; and to let the organisation keep the historical and
analytical value of its data without holding personal data it no longer needs.

## 2. Scope

All data in the 180Connect production database, its backups, and any derived export.
Covers both data subject populations:

| | `USERS` | `CONTACTS` |
| :--- | :--- | :--- |
| Who | 180DC members — CAMs, admins, viewers | People at prospect and client organisations |
| Relationship | Volunteers/staff with an account they created | Contacted on a legitimate interest basis; most gave no prior consent |
| Erasure right | Real, weighed against a strong interest in audit integrity | Stronger — little counterweight once outreach has ended |
| Extra duty | — | **Art. 21(2)–(3): objection to direct marketing is absolute.** No balancing test |

Most of the organisation's exposure is in `CONTACTS`, not `USERS`.

**Jurisdiction — open.** This policy assumes UK GDPR. 180DC is federated across many
countries; if this instance serves a non-UK branch, §4, the one-month response window
in §8, and the absolutism of Art. 21 all need re-checking. Confirm before adoption.

## 3. Data classification

Every table carries one classification. It drives encryption, export, access control,
and incident response severity.

| Class | Meaning | Examples |
| :--- | :--- | :--- |
| **Public** | Already public; no restriction | Charity register data, published financials, `GRANTS` |
| **Internal** | Non-personal operational data | `AUDIT_LOG` metadata, `TAGS`, ingestion run stats |
| **Confidential** | Business-sensitive, not personal | `NOTES` bodies, scoring outputs, `OUTCOMES` |
| **Personal** | Identifies a natural person | `CONTACTS`, `USERS`, `REPLY_MESSAGES`, `DELIVERY_EVENTS` |
| **Sensitive operational** | Compromise causes immediate breach | API keys, OAuth tokens, service-role credentials |

Rules: Personal is never written to logs. Sensitive operational never enters the
database — it lives in environment variables ([`docs/secrets.md`](secrets.md)).
Confidential may contain Personal in free text; see §5.5.

**New tables must declare a classification and a retention row (§6) in the same
migration that creates them**, matching the SOP §7 rule for RLS policies.

## 4. Lawful basis

Not everything rests on the same basis, and saying "legitimate interest" for all of it
is weaker than the truth.

| Data | Lawful basis | Note |
| :--- | :--- | :--- |
| Outreach to `CONTACTS` | Legitimate interest, Art. 6(1)(f) | Requires the LIA in §10 |
| `USERS` accounts | Contract / Art. 6(1)(b), with legitimate interest for the audit dimension | Members hold a volunteer or staff relationship |
| `AUDIT_LOG` | Legitimate interest, supported by the Art. 5(2) accountability duty | See caution below |
| Suppression list | Legal obligation, Art. 6(1)(c) | Art. 21(3) requires us to stop; we cannot stop without a record of who objected |
| Security logs (`LOGIN_ATTEMPT`, `ERROR_LOG`) | Legitimate interest — service security | Art. 32 supports it |

> **Caution on "legal obligation."** Art. 6(1)(c) means an obligation in law, and it
> is narrower than it sounds. Accountability under Art. 5(2) requires us to
> *demonstrate* compliance but does not itself mandate keeping an audit trail for a
> fixed term — so the audit log is legitimate interest **supported by** Art. 5(2),
> not a legal obligation. Suppression is the genuine 6(1)(c) case, because Art. 21(3)
> imposes a duty we cannot discharge without the record. Overclaiming legal
> obligation is the sort of thing a DPO catches immediately; the distinction is kept
> deliberately.

## 5. Lifecycle

### 5.1 Collection

Collected only for the purposes in §1 and the pipeline in
[`01-data-lifecycle.md`](data-model/01-data-lifecycle.md). Personal data is collected
at the minimum granularity that serves the purpose.

### 5.2 Use

Access is enforced at the database layer by RLS, per
[`rls-permission-matrix.md`](rls-permission-matrix.md) — not in application code
alone.

### 5.3 The three levels of removal

The central design decision of this policy. Removal is not one operation.

| Level | Name | What happens | Analytics | When |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **Deactivate** | Access revoked; row and identifiers intact; disappears from the working product | Fully preserved | A member leaves. Reversible. Not an erasure and does not satisfy Art. 17 |
| **2** | **Redact** | Personal identifiers irreversibly removed or replaced with non-identifying placeholders; row, keys, timestamps and history retained | Preserved | **The default erasure workflow.** Art. 17 requests, and the end of a retention period |
| **3** | **Purge** | Every row that can be deleted is physically deleted | Lost | Exceptional only — see below |

**Purge exists because redaction is sometimes not enough.** If data should never have
been in the system, redacting it still leaves a record of a processing operation we
had no basis for. Purge is the correct level for:

- imported duplicates
- records imported by mistake, or an accidental upload
- test and seed data (`is_seed = true`)
- data ingested with no lawful basis at all

Purge is admin-initiated, service-role only, never exposed in the standard interface,
and always leaves an audit entry describing what was purged and why — identifying the
record by ID and count, never by name.

### 5.4 Redaction over deletion

Removing identifying columns while keeping the primary key, foreign keys and
timestamps leaves every count, conversion rate and time series intact. We lose the
ability to say *who*; we keep *how many*, *when*, and *what happened*. Outreach
performance measurement needs the denominator, not the person.

Once identifiers are gone and the remainder cannot reasonably re-identify the subject,
the row is no longer personal data, storage limitation ceases to apply, and it may be
kept indefinitely. This is how the organisation retains the most data lawfully.

**Policy statement:** *Personal identifying information shall be irreversibly removed
or replaced with non-identifying placeholder values, in both the application schema
and the authentication schema.* The mechanism is an implementation concern — see
Annex A.

### 5.5 Free text and structured reasons

Column-level redaction does nothing about a name typed into prose. Three carriers:

1. `NOTES.content` — CAM-written prose about an organisation
2. `ACTIONS.title` / `ACTIONS.description`
3. `AUDIT_LOG.detail.reason` — free text typed by an admin, landing in a table with
   no `UPDATE` or `DELETE` policy for any role

**Personal information is not permitted in administrative reason fields.** Not a
recommendation — a rule, because the audit log is append-only by design and a name
written there is effectively permanent. Reasons are a structured enum plus an
optional linked ID:

```
reason_code: complaint_received
subject_ref: <contact_id | user_id>
```

not `"John Smith complained"`. Structured beats prose: it redacts by following the
foreign key, it is queryable, and it cannot leak a third party's data into an
immutable table. Migrating the existing free-text `reason` to this shape is an open
item (§10).

For prose fields, a rights request requires a manual text search for the subject's
name and email. There is no automated fix.

### 5.6 AI-generated content

The pipeline runs LLM enrichment (`ENRICHMENT_RESULTS`) and will run AI message
generation (stage 8.0). For each generation, retain: the **prompt**, the **output**,
the **model version**, the **prompt version**, and the **generation timestamp**.

Rationale: debugging, audit of what was sent on our behalf, model evaluation, and
future training. Losing prompt/model versioning makes a past output impossible to
explain, which matters if a recipient challenges a message we sent them.

> **Prompts and outputs are Personal, not Internal.** An outreach generation contains
> the recipient's name, organisation and often their role. This section is not a
> licence to keep a PII reservoir outside the redaction scope — generated content is
> in scope for §5.4 redaction exactly like any other Personal table, and the model
> and prompt versions (which are not personal) are what survive redaction.

### 5.7 Derived data

Scores, rankings, classifications, embeddings and similarity vectors are derived data.

> Derived data may be retained after personal identifiers have been removed, where the
> derived data no longer identifies a natural person.

**That last clause is a test, not a formality.** An embedding computed from a person's
name and biography can be susceptible to inversion, and a score attached to a single
named individual is still personal data however numeric it looks. Derived data is
safe to retain indefinitely when it is organisation-level or aggregate; person-level
derived data must be re-checked against the test before it is exempted. When ML is
introduced, this paragraph needs revisiting with the specific features in hand.

### 5.8 Backups

Nightly `pg_dump` to Vercel Blob, 30-day window (F225,
[`backup-production.yml`](../.github/workflows/backup-production.yml)).

Redaction does not reach into existing snapshots. The position: **erasure completes as
snapshots roll off, within 30 days of the redaction being run**, and restoring a
backup obliges us to re-run any redaction or purge performed since the snapshot date.
Stating this is what matters; silently ignoring backups is what fails an audit.

## 6. Retention schedule

Periods run from the trigger event, not from row creation.

| Data | Trigger | Retention | Then | Class |
| :--- | :--- | :--- | :--- | :--- |
| `USERS` account | Deactivation | 7 years | Redact | Personal |
| `AUDIT_LOG` | Row creation | 7 years | Purge (service-role batch) | Internal |
| `LOGIN_ATTEMPT` / login history | Row creation | 24 months | Purge | Personal |
| `ERROR_LOG` | Row creation | 12 months | Purge | Internal |
| `CONTACTS`, never engaged | Row creation | 24 months | Periodic review → redact (§6.1) | Personal |
| `CONTACTS`, after engagement | Relationship ends | 7 years | Redact | Personal |
| `NOTES` | Row creation | 7 years | Redact | Confidential |
| `ACTIONS` | Completion or cancellation | 7 years | Redact | Confidential |
| AI generations (prompt, output, versions) | Generation | 7 years | Redact identifiers, keep versions | Personal |
| Email/outreach history (`DELIVERY_EVENTS`, `REPLY_MESSAGES`) | Event | 7 years | Redact | Personal |
| Analytics, once anonymised | Anonymisation | **Indefinite** | — | Internal |
| Derived data passing the §5.7 test | Derivation | **Indefinite** | — | Internal |
| Suppression list | — | **Indefinite, by design** | Never purged | Personal (hashed) |
| Backups | Snapshot date | 30 days | Automatic roll-off | Mirrors source |

**Why 7 years.** Not statutory. The Limitation Act 1980 gives six years for contract
and tort claims, and HMRC expects six years of records from the end of an accounting
period; seven is six plus a year of margin so a period never expires mid-dispute. That
reasoning is recorded here deliberately — **an unexplained long retention period is
exactly what a regulator challenges**, and "it felt right" is not an answer.

Anything not listed has no agreed period and must be added here before it ships.

### 6.1 Contact review rather than contact deletion

A contact who ignored one email is not worthless. A year later there may be a new CAM,
a new service line, a different board, different funding, a different CEO. Deleting the
record throws away organisation-level relationship history to remove one email address.

> Personal contact details shall be reviewed periodically — at least every two years.
> Where they are no longer accurate or necessary, the personal identifiers are removed
> or anonymised while the organisation-level outreach history is retained.

**This only works if the review actually happens.** An unexecuted review is the same
failure as an undocumented retention period, and worse than a hard rule, because the
policy claims a control that does not exist. The review needs a named owner and a
calendar entry, or a `needs_review` flag raised automatically at the 24-month mark.
Until one of those exists, this clause is aspirational — tracked in §10.

## 7. Suppression

Honouring "do not contact me" requires keeping enough data to *recognise* the person
at the next import. Erasing them entirely guarantees we re-add and re-contact them
from the next enrichment run — a worse breach than the retention.

The list stores:

| Field | Note |
| :--- | :--- |
| `email_hash` | SHA-256 of the lowercased, trimmed address — the scheme already used by `login_attempt.email_hash` |
| `phone_hash` | Same treatment, normalised to E.164 first |
| `organisation_id` | Nullable; suppress an organisation as well as a person |
| `reason` | Structured code per §5.5 — objection, bounce, complaint, manual |
| `source` | Where the objection arrived — reply, webhook, manual |
| `created_at` | |
| `expires_at` | Nullable. **Never set for an Art. 21 objection** |

> An objection to direct marketing does not expire. `expires_at` exists for
> operational suppressions — a hard bounce that may be worth retrying — and setting it
> on an objection would silently re-enable contact to someone who told us to stop.
> That would be the most serious failure this policy can produce.

The list is out of scope for every redaction and purge routine. Retention here is
required by Art. 21, not merely permitted. **Any outreach send path must check it
before dispatch.** Not yet implemented — a constraint on every future story that sends
email, recorded here so it is not discovered late.

## 8. Subject rights

| Right | Article | Route |
| :--- | :--- | :--- |
| Access | 15 | Export of the subject's rows, produced by an admin |
| Rectification | 16 | Normal editing in the product |
| Erasure | 17 | §5.3 Level 2 redaction; Level 3 purge where redaction is inappropriate |
| Objection | 21 | Suppression list (§7); absolute for direct marketing |
| Portability | 20 | Machine-readable export where Art. 20 applies |

Procedure for an erasure request:

1. Verify the requester is the data subject or an authorised representative.
2. Check whether an Art. 17(3) ground to refuse applies — e.g. an active legal claim.
3. Choose the level (§5.3). Redaction is the default; purge needs a recorded reason.
4. Execute per Annex A.
5. Run the §5.5 free-text search; handle hits by hand.
6. Add to the suppression list if the subject is a contact.
7. Record completion in `AUDIT_LOG` — action, subject ID, date, operator. The record
   of the erasure is itself required by Art. 5(2), and must not name the subject
   beyond the ID.
8. Respond within one month (Art. 12(3)).

## 9. Security

RLS on every table from the migration that creates it (SOP §7,
[`rls-permission-matrix.md`](rls-permission-matrix.md)). `AUDIT_LOG` is append-only —
no `UPDATE` or `DELETE` policy for any role, deliberately, so an admin cannot edit the
trail. Secrets never enter the database ([`secrets.md`](secrets.md)). Redaction and
purge are service-role operations, never reachable from the application.

## 10. Governance

**Status: DRAFT.** Outstanding before adoption:

- [ ] Confirm jurisdiction (§2) — UK GDPR is assumed, not verified
- [ ] Compliance sign-off on §4 and §6
- [ ] Write the legitimate interest assessment — purpose, necessity, balancing. This
      is the main gap between this draft and a defensible position
- [ ] Name an owner for the §6.1 contact review, or automate the flag
- [ ] Record the retention decision and who approved it

Implementation debt this policy describes but the codebase does not yet have:

- [ ] `redact_user` / `redact_contact` procedures (Annex A is the manual stopgap)
- [ ] `purge_record` (Level 3) with mandatory audit
- [ ] Suppression list table and the pre-send check (§7)
- [ ] Structured `reason_code` replacing free-text reasons (§5.5)
- [ ] Scheduled enforcement of §6 via `pg_cron`
- [ ] Classification (§3) recorded per table

**A documented procedure that cannot be executed is worse evidence than no document.**
Annex A exists so that this policy is operable today, by hand, before any of the above
is built.

## 11. Review

Reviewed annually, and on any of: a change of jurisdiction, the introduction of ML on
personal data, the first outreach send path going live, or a data subject request that
this policy does not cleanly answer.

**Next review: August 2027.**

---

## Annex A — Implementation

Mechanism, not policy. Changing anything here does **not** require re-approving the
policy above, provided §5.4 still holds.

### A.1 `USERS` redaction

`public.users.email` is `not null` and mirrors a Supabase Auth user, so it cannot be
nulled. Overwrite with a non-routable tombstone.

| Column | Action |
| :--- | :--- |
| `email` | → `redacted+<user_id>@invalid` (`.invalid` is reserved by RFC 2606 and can never be delivered) |
| `full_name` | `null` |
| `is_active` | `false` |
| `deactivated_at` | Preserved |
| `id`, `role`, `created_at`, `last_seen_at`, FKs | Preserved — these carry the analytics and audit linkage |

**Both schemas must be done.** `auth.users` holds its own copy of the email; redacting
`public.users` alone leaves the address live in the auth schema. Cover `auth.users`
email, phone, and `raw_user_meta_data`.

### A.2 `CONTACTS` redaction

`first_name`, `last_name`, `email`, `phone`, `job_title` → `null`. All nullable
already, so no tombstone needed. `id`, `organisation_id`, `contact_source`,
`is_primary` and timestamps preserved.

### A.3 Audit log

No `UPDATE`/`DELETE` policy exists for any role
([`20260723100000_create_audit_log.sql`](../supabase/migrations/20260723100000_create_audit_log.sql)),
so any change requires service_role as a documented manual operation.

Should be rare: `actor_user_id` is a UUID pointing at an already-redacted row and
`detail` normally holds only UUIDs, so after A.1 those rows are already pseudonymous.
Only a §5.5 free-text hit justifies touching them.

### A.4 Manual stopgap

Until the RPCs exist, redaction is run by an admin in the SQL editor against
service_role, following A.1/A.2 column-by-column, then writing the audit entry by
hand per §8 step 7. Slow and error-prone — which is the argument for building the RPCs,
not for leaving the policy unexecutable.
