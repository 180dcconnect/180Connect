# 180Connect – Pre-Live Compliance & Application Sanity Checklist

**Status:** WORKING AUDIT CHECKLIST · **Version:** 0.1  
**Project:** 180Connect (Client Acquisition Platform)  
**Assessor:** Bashir Bobboi (Project Manager)  
**Date of Audit:** 18 August 2026  
**Target Release Gate:** Pre-Live Production Launch  

> **Purpose:** This checklist serves as an operational and technical sanity check across the codebase and infrastructure. It verifies which privacy, security, and data handling controls are **verified working in code today** versus those that remain **pending formal approval or pre-live configuration**.

---

## 1. Data Minimisation & Ingestion Controls

| # | Control / Requirement | Code / Architecture Implementation | Verification Method | Status in Codebase |
| :--- | :--- | :--- | :--- | :--- |
| **D1** | **Public-data field exclusions (F246)** | `applyDataHandling()` in `src/lib/ingestion/apply-data-handling.ts` strips banned officer/trustee residential address and DOB fields. | Automated tests in `src/lib/ingestion/personal-data.test.ts` (AC1–AC3). | `[x] VERIFIED WORKING` ✅ |
| **D2** | **Personal email filtering & redaction (F247)** | Detects personal email patterns using regex and `personal_email_role_parts` allow-list; replaces free-text emails with `[redacted:personal-email]`. | Automated unit tests passing; 100% test coverage on detectors. | `[x] VERIFIED WORKING` ✅ |
| **D3** | **Personal phone number redaction (F247)** | Regex replaces personal mobile/phone sequences in free-text payloads with `[redacted:phone]`. | Automated tests in `personal-data.test.ts`. | `[x] VERIFIED WORKING` ✅ |
| **D4** | **Manual-entry personal email trigger (F247 AC3)** | `check_manual_entry_contact_email()` trigger on `public.manual_entry_records` rejects personal email addresses on write. | Database pgTAP tests in `supabase/tests/rls_policies.test.sql` lines 3638–3653. | `[x] VERIFIED WORKING` ✅ |
| **D5** | **URL-import uses identical data handling** | Manual URL import routes payloads through `applyDataHandling()` prior to staging table insertion. | Automated integration tests in `manual-url-import` suite. | `[x] VERIFIED WORKING` ✅ |
| **D6** | **Raw source records minimised** | `raw_source_records` stores third-party source payloads *with personal exclusions already applied*. | Architectural constraint enforced in ingestion adapter pipeline. | `[x] VERIFIED WORKING` ✅ |
| **D7** | **Retention & purge schedules** | 12-month purge for raw intake; 30-day purge for database backups; indefinite retention for `suppression_records`. | Defined in `docs/data-lifecycle-policy.md`. | `[ ] PENDING AUTOMATED PURGE CRON` ⏳ |

---

## 2. Access Governance, Authentication & Security Controls

| # | Control / Requirement | Code / Architecture Implementation | Verification Method | Status in Codebase |
| :--- | :--- | :--- | :--- | :--- |
| **A1** | **Google Workspace domain restriction** | Signup restricted strictly to verified `@180dc.org` Google accounts (`enforce_180dc_domain_on_signup` trigger). | Database trigger enforced on `auth.users`. | `[x] VERIFIED WORKING` ✅ |
| **A2** | **Administrator account approval gate** | New accounts are provisioned in locked/pending state; cannot access app until explicitly approved by an Admin. | RLS policy checking `active` user status. | `[x] VERIFIED WORKING` ✅ |
| **A3** | **Row Level Security (RLS) Deny-by-Default** | RLS enabled across all database tables; explicit policies for `admin`, `cam`, and `viewer` roles. | pgTAP regression suite in `supabase/tests/rls_policies.test.sql`. | `[x] VERIFIED WORKING` ✅ |
| **A4** | **CAM data access boundaries** | CAMs can view organisation profiles and manage their assigned pipeline; restricted from altering system-wide rules. | Role permission matrix verified in test suite. | `[x] VERIFIED WORKING` ✅ |
| **A5** | **Viewer read-only permissions** | Viewer role restricted from modifying client records, drafting outreach, or changing pipeline stages. | Database RLS tests covering Viewer role. | `[x] VERIFIED WORKING` ✅ |
| **A6** | **Immutable audit logging** | Writes to role permissions, data handling rules, and suppression records log immutable audit rows. | Audit trigger active and verified in test suite. | `[x] VERIFIED WORKING` ✅ |

---

## 3. Direct Client Outreach & Communications Controls

| # | Control / Requirement | Code / Architecture Implementation | Verification Method | Status in Codebase |
| :--- | :--- | :--- | :--- | :--- |
| **O1** | **Permanent DNC suppression enforcement** | Pre-send check queries `public.suppression_records`; blocks delivery attempts to opted-out addresses. | Database table active; trigger logic integrated into outreach pipeline. | `[x] VERIFIED WORKING` ✅ |
| **O2** | **Mandatory Review-Before-Send gate** | No email can be sent without explicit human review and affirmative click-to-send action by authenticated CAM. | UI workflow requires CAM approval button; no auto-send cron. | `[x] VERIFIED WORKING` ✅ |
| **O3** | **No autonomous email sending** | System architecture prohibits autonomous background sending of marketing emails. | Architectural verification (email sending is strictly user-triggered). | `[x] VERIFIED WORKING` ✅ |
| **O4** | **Branch mailbox configuration** | Outreach dispatched from authorised branch mailbox (`sheffield@180dc.org`). | Gmail API OAuth scoping for `sheffield@180dc.org`. | `[ ] PENDING PRODUCTION OAUTH` ⏳ |
| **O5** | **Statutory company disclosure footer** | Every outbound email includes full legal entity name, company registration number (`15874544`), and registered office. | Defined in `docs/privacy-notice.md` §12 email template. | `[x] TEMPLATE READY` ✅ |
| **O6** | **Article 14 Privacy Notice link** | Every outbound email contains a clear link to the public Article 14 Privacy Notice (`docs/privacy-notice.md`). | Embedded in standard email footer template. | `[x] TEMPLATE READY` ✅ |
| **O7** | **One-click unsubscribe / opt-out mechanism** | Clear instructions and mailto link for one-click opt-out / suppression in every email footer. | Embedded in standard email footer template. | `[x] TEMPLATE READY` ✅ |

---

## 4. AI / LLM Governance & Processing Controls

| # | Control / Requirement | Code / Architecture Implementation | Verification Method | Status in Codebase |
| :--- | :--- | :--- | :--- | :--- |
| **AI-1** | **Approved LLM provider selection** | Selection of enterprise model provider (e.g. Gemini / Claude) with UK/EU processing commitments. | Vendor assessment and selection. | `[ ] PENDING PROVIDER SELECTION` ⏳ |
| **AI-2** | **Zero-retention & no-training DPA** | Formal execution of enterprise Data Processing Addendum prohibiting model training on prompt payloads. | Contractual execution. | `[ ] PENDING CONTRACT EXECUTION` ⏳ |
| **AI-3** | **UK/EU hosting region pinning** | Ensuring model inference API endpoints execute strictly within UK/EU jurisdictions. | Infrastructure configuration. | `[ ] PENDING INFRA CONFIG` ⏳ |
| **AI-4** | **Prompt data minimisation** | Ingestion pipeline strips personal names/emails prior to invoking LLM summarisation endpoints. | Ingestion pre-processing pipeline. | `[ ] PENDING PRE-LIVE IMPLEMENTATION` ⏳ |
| **AI-5** | **MVP Raw Reply Restriction** | Raw inbound email replies are **strictly prohibited** from automated transmission to third-party LLMs in MVP. | Policy restriction active in `docs/dpia.md` R8. | `[x] POLICY RESTRICTION ACTIVE` ✅ |

---

## 5. Regulatory & Governance Prerequisites Summary

| Prerequisite Item | Target Authority / Document | Status |
| :--- | :--- | :--- |
| **Global Workspace Data Protection Agreement** | 180 Degrees Consulting Limited (Australia) ([`docs/global-workspace-data-protection-agreement.md`](global-workspace-data-protection-agreement.md)) | Draft v0.1 ready for Global review |
| **Australian Transfer Risk Assessment (TRA)** | UK GDPR Article 44 / International Transfer Governance | Pending completion alongside Global agreement |
| **ICO Tier 1 Fee Payment (£47/£52)** | UK Information Commissioner's Office ([`docs/ico-fee-self-assessment.md`](ico-fee-self-assessment.md)) | Self-assessment complete; payment submission pending |
| **Legitimate Interest Assessment (LIA)** | UK GDPR Article 6(1)(f) ([`docs/legitimate-interest-assessment.md`](legitimate-interest-assessment.md)) | Draft v0.1 complete; pending controller sign-off |
| **Data Protection Impact Assessment (DPIA)** | UK GDPR Article 35 ([`docs/dpia.md`](dpia.md)) | Draft v0.1 complete; pending controller sign-off |
| **Record of Processing Activities (ROPA)** | UK GDPR Article 30 ([`docs/ropa.md`](ropa.md)) | Draft v0.1 complete |
| **Article 14 Privacy Notice** | UK GDPR Article 14 ([`docs/privacy-notice.md`](privacy-notice.md)) | Draft v0.1 complete; ready for public web hosting |
