# 180Connect – Record of Processing Activities (ROPA)
### UK GDPR Article 30 Controller Record

**Status:** DRAFT · **Version:** 0.1  
**Data Controller:** 180 Degrees Consulting Sheffield CIC (Company No. `15874544`, Registered in England and Wales)  
**Registered Office:** 67 Barber Road, Sheffield, England, S10 1EB  
**Contact Email:** [sheffield@180dc.org](mailto:sheffield@180dc.org)  
**Lead Representative / Assessor:** Bashir Bobboi (Project Manager)  
**Date of Record:** 18 August 2026  
**Next Annual Review:** 18 February 2027  
**Applicable Framework:** UK GDPR Article 30(1), Data Protection Act 2018  

> **Companion Documents:**
> * [`docs/data-handling-policy.md`](data-handling-policy.md) — Controller Data Handling Policy & Processor Register.
> * [`docs/legitimate-interest-assessment.md`](legitimate-interest-assessment.md) — Article 6(1)(f) Lawful Basis Assessment.
> * [`docs/dpia.md`](dpia.md) — Article 35 Data Protection Impact Assessment.
> * [`docs/privacy-notice.md`](privacy-notice.md) — Article 14 Transparency & Privacy Notice.
> * [`docs/personal-data-exclusions.md`](personal-data-exclusions.md) — Technical Exclusion Rules Specification (F246/F247).
> * [`docs/data-lifecycle-policy.md`](data-lifecycle-policy.md) — Data Retention & Deletion Schedules.

---

## 1. Controller & Governance Details

| Field | Controller Record Information |
| :--- | :--- |
| **Legal Entity Name** | 180 Degrees Consulting Sheffield CIC |
| **Company Registration No.** | 15874544 (Registered in England and Wales) |
| **Registered Office Address** | 67 Barber Road, Sheffield, England, S10 1EB |
| **Data Protection Contact** | Project Manager / Leadership Team ([sheffield@180dc.org](mailto:sheffield@180dc.org)) |
| **ICO Registration / Tier** | Tier 1 Micro-Organisation (Self-assessment completed 18 August 2026; registration pending payment) |
| **System Name** | 180Connect (Internal Client Acquisition & Intelligence Platform) |

---

## 2. Master Summary of Processing Activities

| Ref # | Processing Activity Name | Primary Purpose | Lawful Basis (UK GDPR / PECR) | Data Subject Category | Primary Recipients / Processors | Retention Period |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **PA-01** | **Public Registry Ingestion & Prospect Discovery** | Identifying prospective social-sector client organisations | Article 6(1)(f) Legitimate Interests | Professional contacts, trustees, non-profit representatives | Supabase Inc. (EU) | 12 months for raw intake; active records refreshed/deleted at 24 mos |
| **PA-02** | **Automated Data Minimisation & Exclusion Filtering** | Discarding banned personal data (home addresses, personal emails, personal phones) | Article 6(1)(f) Legitimate Interests & Article 5(1)(c) Data Minimisation | Public officers, trustees, charity contacts | In-memory application processing layer (`applyDataHandling`) | Immediate in-memory strip / not persisted |
| **PA-03** | **Manual Prospect Entry & URL Import** | Ingesting non-registry non-profits identified by CAMs | Article 6(1)(f) Legitimate Interests | Non-profit executive/partnership contacts | Supabase Inc. (EU) | 24 months from last outreach |
| **PA-04** | **Decision-Support Prioritisation & Scoring** | Evaluating organisation suitability to assist CAM research | Article 6(1)(f) Legitimate Interests | Non-profit organisations (organisation-level signals) | Supabase Inc. (EU), Internal compute | Overwritten on profile refresh |
| **PA-05** | **Direct B2B Client Outreach (Cold Email)** | Initiating introductory advisory communications with corporate non-profits | Article 6(1)(f) Legitimate Interests & Regulation 22 PECR (Corporate Subscribers) | Professional representatives of corporate non-profits | Google LLC (Google Workspace), 180 Degrees Consulting Limited (Australia) | 24 months from last communication |
| **PA-06** | **Inbound Relationship & Discovery Management** | Managing email responses, scheduling discovery meetings, scoping projects | Article 6(1)(f) Legitimate Interests / Article 6(1)(b) Contract | Active client liaisons and charity leaders | Google Workspace, Supabase Inc. | Retained during active engagement + 6 years for legal claims |
| **PA-07** | **Permanent Suppression & Marketing Objection Handling** | Enforcing do-not-contact requests and marketing objections | Article 6(1)(c) Legal Obligation & Art. 6(1)(f) Legitimate Interests | Opted-out individuals and organisations | Supabase Inc. (`suppression_records`) | Indefinite (to guarantee suppression enforcement) |
| **PA-08** | **User Account Governance, RBAC & Audit Logging** | Authenticating 180DC team members, enforcing permissions, logging critical actions | Article 6(1)(f) Legitimate Interests (Security & Accountability) | Internal 180DC student consultants, CAMs, Admins | Supabase Inc., Resend Inc. | Account lifecycle + 12 months for audit logs |

---

## 3. Detailed Processing Activity Records

---

### Activity PA-01: Public Registry Ingestion & Prospect Discovery

* **Description & Purpose:** Automated ingestion of public charity and company records from official statutory registers (Charity Commission API, Companies House API, 360Giving, Find That Charity) to identify prospective charities, CICs, and social enterprises for consulting projects.
* **Categories of Data Subjects:** Trustees, directors, and named representatives of public charities and Community Interest Companies.
* **Categories of Personal Data:** Professional name, official role/job title, business email address, corporate telephone number, public registered office address, charity/company registration number.
* **Special Category Data:** None collected or processed.
* **Sources of Data:** Charity Commission for England and Wales, Companies House, 360Giving, Find That Charity.
* **Lawful Basis (UK GDPR Article 6):** Article 6(1)(f) Legitimate Interests (Documented in formal LIA).
* **Categories of Recipients / Processors:** Supabase Inc. (Database processor, hosted in Ireland/EU).
* **International Transfers & Safeguards:** Transfers to EU/EEA covered by UK Adequacy Regulations.
* **Retention Schedule:** Raw intake payloads purged after **12 months** (`raw_source_records`). Canonical organisation records retained up to **24 months** from last contact if inactive.
* **Technical & Organisational Security Measures (TOMs):** Automated F246 field deny-list, in-memory regex redaction, AES-256 database encryption at rest, TLS 1.3 in transit, Row Level Security (RLS) deny-by-default.

---

### Activity PA-02: Automated Data Minimisation & Exclusion (F246/F247)

* **Description & Purpose:** Pre-persistence filtering of all external API payloads through `applyDataHandling()` to strip banned personal identifiers (officer usual residential addresses, dates of birth, personal mobile numbers, and personal email addresses).
* **Categories of Data Subjects:** Company directors, charity trustees, and individuals listed in statutory filings.
* **Categories of Personal Data:** Banned fields (stripped before persistence): residential addresses, personal emails, personal phone numbers, dates of birth, nationality.
* **Lawful Basis:** Article 6(1)(f) Legitimate Interests and Article 5(1)(c) Data Minimisation principle.
* **Recipients / Transfers:** None (processed in-memory in application runtime).
* **Retention:** Zero persistence. Banned fields are discarded immediately in-memory.
* **TOMs:** Database-backed `data_handling_rules` and `personal_email_role_parts` tables; automated Jest/pgTAP regression test suite (1,000+ assertions).

---

### Activity PA-03: Manual Prospect Entry & URL Import (F036/F037)

* **Description & Purpose:** Client Acquisition Managers (CAMs) manually adding prospective social-sector organisations or importing organisation profiles from public websites.
* **Categories of Data Subjects:** Publicly listed organizational contacts, CEOs, partnership leads, and fundraising directors.
* **Categories of Personal Data:** Professional contact name, business email address, organisation website URL, corporate telephone number, sector, notes on consulting fit.
* **Sources of Data:** Public organisation websites, public directory listings, or CAM direct research.
* **Lawful Basis:** Article 6(1)(f) Legitimate Interests.
* **Recipients:** Supabase Inc. (EU).
* **Retention Schedule:** 24 months from creation or last interaction.
* **TOMs:** Database trigger `check_manual_entry_contact_email` enforcing personal email rejection via `app.is_personal_email()`; RLS restricting entry permissions.

---

### Activity PA-04: Decision-Support Prioritisation & Scoring

* **Description & Purpose:** Algorithmic calculation of data-completeness scores and prospective client priority scores (0–100) to assist CAMs in prioritising research and outreach.
* **Categories of Data Subjects:** None (Evaluates corporate/non-profit organisational attributes).
* **Categories of Personal Data:** Non-personal organisational attributes (income band, sector classification, location, completeness of profile).
* **Lawful Basis:** Article 6(1)(f) Legitimate Interests.
* **Article 22 Non-Applicability:** Operates purely as internal decision-support; produces no legal or significant effect on individuals; CAMs retain full discretion to override or dismiss scores.
* **Recipients:** Supabase Inc. (EU).
* **Retention:** Dynamic scores updated on record refresh.

---

### Activity PA-05: Direct B2B Client Outreach (Cold Email)

* **Description & Purpose:** Dispatching tailored, professional introductory emails from the branch mailbox (`sheffield@180dc.org`) to invite prospective client organisations to explore pro bono or subsidised consulting projects.
* **Categories of Data Subjects:** Executive officers, fundraising directors, and designated partnership contacts at corporate non-profits.
* **Categories of Personal Data:** Professional name, job title, corporate email address, outreach email subject and body text, dispatch timestamp.
* **Lawful Basis (UK GDPR & PECR):**
  * **UK GDPR:** Article 6(1)(f) Legitimate Interests.
  * **PECR:** Regulation 22 (Corporate subscribers permitted without prior opt-in; individual subscribers/sole traders excluded unless consented).
* **Recipients & Processors:**
  * Google LLC (Google Workspace, US/Global).
  * 180 Degrees Consulting Limited (Australia — Workspace Tenant Administrator under shared governance).
* **International Transfers & Safeguards:**
  * Google Workspace: Cloud DPA with Standard Contractual Clauses (SCCs) and UK Addendum.
  * 180 Degrees Consulting Limited: Proposed Inter-Entity Governance Agreement, UK International Data Transfer Agreement (IDTA), and Transfer Risk Assessment (TRA).
* **Retention Schedule:** Outreach logs and message history retained for **24 months** from last communication.
* **TOMs:** Human-in-the-loop sending gate (no autonomous dispatch); pre-send verification against `suppression_records`; mandatory Article 14 privacy notice link and one-click opt-out in all email footers.

---

### Activity PA-06: Inbound Relationship & Discovery Management

* **Description & Purpose:** Receiving, reading, and managing inbound email responses from prospective clients, coordinating discovery calls, and recording client relationship milestones.
* **Categories of Data Subjects:** Prospective and active client representatives.
* **Categories of Personal Data:** Inbound email thread content, sender name, email address, meeting notes, project requirements.
* **Lawful Basis:** Article 6(1)(f) Legitimate Interests (pre-contractual discovery) / Article 6(1)(b) Contract (active client advisory agreements).
* **Recipients:** Google Workspace, Supabase Inc.
* **Retention Schedule:** Retained during active consulting engagement + **6 years** post-engagement for statutory limitation and accountability purposes.
* **TOMs:** Mailbox multi-factor authentication (MFA); rule prohibiting automated submission of raw client email replies to third-party LLMs.

---

### Activity PA-07: Permanent Suppression & Marketing Objection Handling

* **Description & Purpose:** Recording and permanently enforcing do-not-contact requests, unsubscribes, and Article 21 objections to guarantee that opted-out contacts never receive subsequent marketing communications.
* **Categories of Data Subjects:** Individuals and organisations that have requested suppression or objected to direct marketing.
* **Categories of Personal Data:** Email address, organisation ID, suppression timestamp, reason code (e.g. `unsubscribed`, `opt_out`, `ineligible`).
* **Lawful Basis:** Article 6(1)(c) Legal Obligation (compliance with PECR Regulation 22/23 & UK GDPR Article 21) and Article 6(1)(f) Legitimate Interests.
* **Recipients:** Supabase Inc. (`suppression_records` table).
* **Retention Schedule:** **Indefinite retention** (strictly necessary to ensure the suppression preference is continuously honoured across all system users and imports).
* **TOMs:** Automated database trigger / pre-send check blocking email dispatch to any address present in `suppression_records`; immutable audit log of suppression additions.

---

### Activity PA-08: User Authentication, Access Governance & Audit Logging

* **Description & Purpose:** Provisioning internal user accounts, authenticating student consultants and CAMs, enforcing role-based permissions, and recording immutable audit logs of administrative actions.
* **Categories of Data Subjects:** 180DC Sheffield consultants, CAMs, Project Managers, and System Administrators.
* **Categories of Personal Data:** Work email (`@180dc.org`), user ID, assigned role (`admin`, `cam`, `viewer`), account status (`active`, `pending_approval`), login timestamps, IP address, audit trail records.
* **Lawful Basis:** Article 6(1)(f) Legitimate Interests (Security, accountability, system governance) / Article 6(1)(b) Member Agreement.
* **Recipients:** Supabase Inc. (EU), Resend Inc. (US — auth/invite emails).
* **Retention Schedule:** User account data retained for duration of active membership + **12 months** post-departure; audit logs retained for **12 months**.
* **TOMs:** Domain-restricted signup (`@180dc.org` only), admin approval gate on new accounts, Row Level Security (RLS) denying access by default, AES-256 encrypted secrets.

---

## 4. Technical and Organisational Security Measures (TOMs) Overview

In accordance with UK GDPR Article 32, 180 Degrees Consulting Sheffield CIC implements technical and organisational measures appropriate to the risk:

1. **Access Control & Authentication:**
   * Strict domain restrictions: Account registration restricted to verified `@180dc.org` Google Workspace accounts.
   * Admin Approval Gate: New user accounts are locked until explicitly approved and activated by an Administrator.
   * Role-Based Access Control (RBAC): Distinct permission tiers (`admin`, `cam`, `viewer`) enforced at database level via Row Level Security (RLS).
2. **Data Minimisation & Ingestion Protection:**
   * Automated Field Deny-List (F246): Stripping non-business personal fields at the ingestion boundary.
   * Regex Redaction Engine (F247): Redacting personal emails and phone numbers from unstructured text.
   * Database Trigger Email Guard: Blocking personal email addresses from manual record entry.
3. **Cryptography & Network Security:**
   * Encryption in Transit: Mandatory TLS 1.3 for all HTTP and database connections.
   * Encryption at Rest: AES-256 encryption applied to all Supabase database volumes and backups.
   * Secure Secret Management: Sensitive API keys and service credentials stored in encrypted environment variables (Vercel / Supabase Vault).
4. **Resilience, Backup & Incident Management:**
   * Automated Daily Backups: Database snapshots taken daily and retained for 30 days.
   * 72-Hour Breach Notification Protocol: Documented breach response workflow in accordance with Article 33.
   * Automated Test Suite: Continuous integration (CI) running over 1,000 unit and integration tests guarding security policies and triggers.

---

## 5. Third-Party Processor & Recipient Schedule

| Entity Name | Service Description | Processing Location | UK International Transfer Basis | Contractual Status |
| :--- | :--- | :--- | :--- | :--- |
| **Supabase Inc.** | Cloud database, authentication & audit logging | Ireland (EU / EEA) | UK Adequacy Regulation | Data Processing Addendum (DPA) executed |
| **Vercel Inc.** | Application hosting & serverless compute | US / Global Edge | Vercel DPA + EU SCCs / UK Addendum | DPA executed |
| **Google LLC** | Google Workspace email infrastructure | US / Global | Google Cloud DPA + UK Addendum | Enterprise Workspace Terms active |
| **Resend Inc.** | Transactional & authentication email delivery | US | Resend DPA + EU SCCs / UK IDTA | DPA executed |
| **180 Degrees Consulting Limited** | Shared Workspace tenant administration | Australia | UK IDTA / UK Addendum + TRA | Proposed Governance Agreement drafted ([`docs/global-workspace-data-protection-agreement.md`](global-workspace-data-protection-agreement.md)) |
| **PostHog Inc.** | Usage analytics (planned) | Germany (EU / EEA) | UK Adequacy Regulation | PostHog DPA |
| **Third-Party LLM Provider** | AI summarisation (selection pending) | To be pinned UK/EU | UK IDTA / UK Addendum + Zero-Retention Terms | Provider evaluation in progress |

---

## 6. Review & Governance Record

This Record of Processing Activities is maintained by the Project Manager on behalf of the Data Controller and reviewed every six months, or immediately upon the introduction of a new data source, processor, or processing activity.

| Version | Date | Author / Reviewer | Summary of Changes / Notes |
| :--- | :--- | :--- | :--- |
| **0.1** | 18 August 2026 | Bashir Bobboi (Project Manager) | Initial Article 30 ROPA draft compiled covering processing activities PA-01 through PA-08. |
