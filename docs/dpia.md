# 180Connect – Data Protection Impact Assessment (DPIA)

**Status:** DRAFT · **Version:** 0.1  
**Data Controller:** 180 Degrees Consulting Sheffield CIC (Company No. `15874544`, Registered in England and Wales; Registered Office: 67 Barber Road, Sheffield, England, S10 1EB)  
**Project:** 180Connect  
**Lead Assessor:** Bashir Bobboi (Project Manager)  
**Date of Assessment:** 18 August 2026  
**Next Review Date:** 18 February 2027 (or upon material architectural/processing changes)  
**Applicable Framework:** UK GDPR Article 35, Data Protection Act 2018, PECR, ICO DPIA Guidance  

> **Companion Documents:**
> * [`docs/data-handling-policy.md`](data-handling-policy.md) — Controller-level data handling and processor framework (v0.3).
> * [`docs/legitimate-interest-assessment.md`](legitimate-interest-assessment.md) — Three-part lawful basis assessment under Article 6(1)(f).
> * [`docs/privacy-notice.md`](privacy-notice.md) — Article 14 Transparency & Privacy Notice for indirect outreach.
> * [`docs/personal-data-exclusions.md`](personal-data-exclusions.md) — Technical field-level exclusion and regex redaction rules (F246/F247).
> * [`docs/data-lifecycle-policy.md`](data-lifecycle-policy.md) — Data retention schedules, trust layers, and deletion procedures.
> * [`docs/global-workspace-data-protection-agreement.md`](global-workspace-data-protection-agreement.md) — Shared Google Workspace governance proposal.
> * [`docs/ico-fee-self-assessment.md`](ico-fee-self-assessment.md) — Completed ICO Tier 1 fee determination.

> **Important Status Statement:** 180Connect is currently in a pre-live implementation and governance phase. Controls marked "Planned", "In Progress", or "Pending" are conditions of live deployment and must not be treated as completed controls for the purposes of this assessment.

---

## 1. DPIA Overview

This Data Protection Impact Assessment (DPIA) evaluates the privacy, security, and fundamental rights impacts of **180Connect**, an internal client acquisition, relationship intelligence, and outreach platform designed and operated by **180 Degrees Consulting Sheffield CIC**.

180Connect identifies prospective social-sector client organisations (charities, Community Interest Companies, and social enterprises) using public registry APIs and public websites, enriches organisational profiles, calculates decision-support priority scores, and facilitates human-reviewed B2B email outreach from the branch mailbox (`sheffield@180dc.org`).

This DPIA systematically assesses the end-to-end processing lifecycle to answer four fundamental questions:
1. **What personal data is collected and processed?**
2. **What privacy, legal, and security risks could arise for individuals?**
3. **What technical, organizational, and contractual controls mitigate those risks?**
4. **Is the residual risk acceptable and proportionate prior to live client outreach?**

---

## 2. Why a DPIA is Conducted

Under UK GDPR Article 35(1), a DPIA is required where processing is "likely to result in a high risk to the rights and freedoms of natural persons."

Although the processing does not necessarily fall within a single mandatory DPIA category solely because it involves B2B outreach or decision-support scoring, Sheffield CIC has determined that a DPIA is appropriate as a proportionate risk-management measure because the project combines indirect collection, data aggregation, profiling/decision-support, cloud infrastructure, planned AI processing, and international administrative access.

Specifically, the assessment evaluates the combination of the following factors:

* **Evaluation and Scoring / Profiling:** Calculating automated data-completeness and priority scores to suggest prospective organisations for outreach.
* **Data Matching & Aggregation Across Multiple Sources:** Combining records from public statutory registries (Charity Commission, Companies House, 360Giving, Find That Charity) with scraped web data and internal CRM history.
* **Indirect Data Collection at Scale:** Ingesting professional contact details and organisational attributes indirectly from public repositories without prior direct interaction with the data subjects.
* **Use of Innovative Technologies / AI Processing:** Incorporating planned machine learning prioritisation and potential third-party Large Language Model (LLM) services for drafting assistance and reply classification.
* **International Administrative Access:** Processing correspondence through a Google Workspace tenant administered from Australia by 180 Degrees Consulting Limited.
* **Direct Marketing to Named Professionals:** Initiating cold B2B outreach to individuals representing prospective corporate clients.

**Timing & Purpose:** This DPIA is conducted during system development and before live outreach commences, ensuring privacy-by-design controls are embedded into code and infrastructure rather than retrofitted.

---

## 3. Description of the Processing

### 3.1 End-to-End Processing Journey
```
1. Public Registry Ingestion (Charity Commission, Companies House, 360Giving)
   ↓
2. Single Ingestion Choke Point (applyDataHandling() — F246/F247 Field Deny & Regex Redaction)
   ↓
3. Supabase Five-Layer Storage (Raw Intake → Validated Core Entities → Intelligence)
   ↓
4. Automated Decision-Support Scoring (Priority & Completeness Scoring)
   ↓
5. CAM Manual Review & Validation (Independent Human Assessment)
   ↓
6. Outreach Draft Generation (Template / Proposed Content)
   ↓
7. CAM Affirmative Approval (Human-in-the-Loop Send Gate)
   ↓
8. Email Dispatch (Google Workspace — sheffield@180dc.org)
   ↓
9. Recipient Interaction (Opt-out / Unsubscribe / Direct Reply)
   ↓
10. Relationship Management & Suppression Enforcement (suppression_records)
```

### 3.2 Feature Implementation Status Matrix

| System Component | Description | Implementation Status |
| :--- | :--- | :--- |
| **Public Registry Ingestion** | Ingesting charity and company profiles from external APIs | `In use` |
| **F246/F247 Data Minimisation** | Database-backed field filtering and regex email/phone redaction | `In use` |
| **Manual Entry Email Guard** | Database trigger blocking personal emails on manual entries | `In use` |
| **Supabase RLS & RBAC** | Deny-by-default Row Level Security (Admin, CAM, Viewer) | `In use` |
| **Audit Logging Engine** | Immutable logging of role, data rule, and suppression changes | `In use` |
| **Decision-Support Scoring** | Algorithmic scoring ranking prospect suitability for CAM review | `Planned / pre-live requirement` |
| **Human-in-the-Loop Sending Gate**| Mandatory CAM review and click-to-send validation boundary | `Policy requirement` (Enforced in code pre-live) |
| **Google Workspace Outreach API** | OAuth-scoped integration with `sheffield@180dc.org` | `Planned / pre-live requirement` |
| **Permanent Suppression Engine** | Database-level blocking of opted-out email addresses | `In use` |
| **LLM Generative Drafting & Reply Class.** | Third-party AI assistance for drafting and intent analysis | `Planned` (Restricted pending DPA/TRA) |
| **PostHog Analytics** | Product and operational usage analytics (EU Cloud) | `Planned` |

---

## 4. Data Flow & Architecture

| Processing Stage | Data Ingested / Handled | Target Destination | Primary Purpose | Key Risk Identified |
| :--- | :--- | :--- | :--- | :--- |
| **1. Registry Ingestion** | Entity profile, registration IDs, financial reach | Ingestion pipeline | Identify suitable non-profits | Ingesting unintended personal data (trustee addresses) |
| **2. Field Filtering** | Raw API payload | In-memory `applyDataHandling()` | Remove banned personal data | Filter failure persisting private data |
| **3. Core Persistence** | Filtered organisational record | Supabase `organisations` table | Master client directory | Unauthorised database access |
| **4. Prioritisation** | Financials, sector, location, profile | Scoring engine | Decision-support ranking | Algorithmic bias or inaccurate scoring |
| **5. CAM Review** | Prospect record + priority score | CAM Web UI | Human suitability evaluation | Blind reliance on algorithmic recommendation |
| **6. Email Dispatch** | Business email, contact name, draft | Google Workspace API | Professional outreach | Unwanted marketing / PECR breach |
| **7. Reply Ingestion** | Email thread response text | Mailbox / 180Connect thread | Manage client communication | Exposure of unprompted sensitive disclosures |
| **8. Suppression** | Email address / organisation ID | `suppression_records` table | Honour do-not-contact requests | Failure to block subsequent sends |
| **9. AI Enrichment** | Minimised organisational text | Third-party LLM endpoint | Summary / drafting aid | Provider training on data / overseas transfer |
| **10. Backups** | Encrypted database snapshot | Supabase secure backup storage | Disaster recovery | Stale retention beyond policy window |

---

## 5. Data Sources

180Connect obtains data from identified public, statutory, organisational and user-provided sources, subject to the source and validation controls described below:

1. **Charity Commission for England and Wales API:** Public charity register details.
2. **Companies House API:** Public company filings, SIC codes, and registered office details for CICs and limited entities.
3. **360Giving Data Registry:** Public grant and funding distribution records.
4. **Find That Charity API:** Public non-profit identifier reconciliation.
5. **Public Charity & CIC Websites:** Publicly advertised contact inboxes, leadership teams, and mission statements.
6. **CAM Manual Entries (F036/F037):** Direct entry of publicly available contact information for non-registry organisations, validated against database exclusion triggers.
7. **Direct Email Correspondence:** Inbound responses sent directly by prospective clients to `sheffield@180dc.org`.

---

## 6. Categories of Personal Data

### 6.1 Permitted Data Categories
* **Professional Identifiers:** Full professional name, job title, organizational role (e.g. Chief Executive, Fundraising Manager, Trustee in official capacity).
* **Business Contact Information:** Professional email address (role inboxes e.g. `info@`, `contact@`, or published corporate email), business telephone number, registered office address.
* **Organisational Context:** Public sector classification, charitable objectives, financial tiers, and geographic operational area.
* **Platform Interaction History:** CAM assignment, outreach stage, email timestamps, open/reply tracking, and suppression flags.
* **Derived Analytical Signals:** Data-completeness score and prospective client priority ranking.

### 6.2 Strictly Excluded Data Categories (Technical Brief §5 & F246/F247)
The following categories are **prohibited from intentional ingestion into 180Connect's structured data stores**:
* ❌ Personal residential/home addresses (including director/trustee usual residential addresses returned by Companies House);
* ❌ Personal mobile numbers or private telephone lines;
* ❌ Personal email addresses (Gmail, Hotmail, Yahoo, personal ISP addresses, non-role personal prefixes);
* ❌ Dates of birth, nationality, and marital status of officers/trustees;
* ❌ Special category data (health, racial/ethnic origin, political beliefs, religious beliefs, sexual orientation);
* ❌ Criminal convictions or background checks.

*Note on Inbound Correspondence:* Unsolicited personal or special-category information may nevertheless appear in inbound correspondence sent by third parties to `sheffield@180dc.org`. Such information is not intentionally collected for 180Connect purposes and must not be used for enrichment, scoring, profiling, or LLM processing. Where technically retained within the underlying Google Workspace mailbox, it remains subject to standard mailbox retention and access controls.

---

## 7. Categories of Data Subjects

* **Prospective Client Representatives:** Named trustees, executives, fundraising directors, and operational leaders of UK charities, CICs, and social enterprises.
* **Active Client Contacts:** Designated liaisons and project sponsors at organisations engaged in active consulting projects with Sheffield CIC.
* **Internal Platform Users:** 180DC Sheffield student consultants, Client Acquisition Managers (CAMs), Project Managers, and System Administrators.

---

## 8. Purposes and Lawful Bases

| Processing Activity | Purpose | UK GDPR Lawful Basis | PECR Basis |
| :--- | :--- | :--- | :--- |
| **Ingestion, enrichment, and prioritisation** | Identifying and evaluating prospective social-sector clients | Article 6(1)(f) Legitimate Interests (Documented in LIA) | N/A (Internal processing) |
| **Cold B2B Email Outreach** | Initiating contact with prospective social-sector clients regarding consulting services | Article 6(1)(f) Legitimate Interests | PECR Regulation 22: no consent requirement for corporate subscribers; individual subscribers (including sole traders and certain partnerships) require consent or another applicable PECR route. |
| **Suppression Management** | Enforcing do-not-contact requests and marketing objections | Article 6(1)(c) Legal Obligation & Art. 6(1)(f) | Reg. 22 & 23 PECR (Mandatory opt-out compliance) |
| **Audit Logging** | Security, traceability, and accountability compliance | Article 6(1)(f) Legitimate Interests (Security, accountability, system governance and fraud prevention) | N/A |
| **Internal User Authentication** | Provisioning access to authorised 180DC members | Article 6(1)(f) Legitimate Interests (Access control, system security and user governance) / Article 6(1)(b) where contractual terms apply | N/A |

*Note on PECR Compliance:* Public availability of an email address does not constitute consent or an unrestricted right to send marketing. Outreach is targeted strictly at corporate bodies (incorporated charities, CICs, limited companies). Contacting unincorporated entities or sole traders requires prior consent or an applicable PECR route.

---

## 9. Automated Decision-Support and Profiling

### 9.1 Nature of the Scoring Mechanism
180Connect computes priority scores based on public organisational attributes (income band, sector relevance, location, data completeness).

### 9.2 Human Oversight and Non-Significant Effect
The priority score is primarily calculated from organisational characteristics rather than characteristics of individual data subjects. It is used to prioritise CAM research and outreach activity and does not make decisions about an individual's eligibility, rights, access to services, employment, finances, or other similarly significant matters.

The platform operates strictly with human oversight:
1. **Decision-Support Only:** The priority score is an internal recommendation signal to help CAMs manage their workload; it does not take any autonomous action.
2. **Organisation-Level Focus:** Scores evaluate corporate/non-profit fit (income band, sector relevance, geographical reach) rather than personal profiling of natural persons.
3. **Mandatory Human Agency:** A CAM must independently review the organisation and contact details. The CAM has full authority to override, reprioritise, or dismiss any recommendation.
4. **No Autonomous Dispatch:** The system cannot dispatch emails autonomously. Every email must be explicitly reviewed and initiated by a logged-in CAM.

---

## 10. LLM Processing & AI Governance

### 10.1 Planned Generative Capabilities
The platform plans to incorporate LLM services for:
* Summarising complex charity annual returns and mission statements;
* Assisting CAMs in drafting tailored initial outreach emails;
* Classifying the sentiment and intent of incoming client replies (e.g. interested, not interested, out-of-office).

### 10.2 Identified AI Risks & Mitigation Gates

| Specific AI Risk | Vulnerability / Impact | Mandatory DPIA Control & Gate | Status |
| :--- | :--- | :--- | :--- |
| **1. Personal Data Transmission to LLM** | Sending contact names/emails to third-party model endpoints | Where LLM processing is introduced, prompts must be minimised and personal identifiers removed wherever reasonably practicable before transmission. The exact permitted data fields will be documented following provider selection and the associated DPA/transfer assessment. | `Planned / pre-live requirement` |
| **2. Provider Model Training on Client Data** | Third-party vendor retaining prompts to train foundation models | Mandatory zero-retention / no-training enterprise terms required in DPA before production use. | `Planned / pre-live requirement` |
| **3. International Transfer via AI Vendor** | LLM inference executing outside UK/EEA | Pinned UK/EU hosting region and executed UK Addendum/SCCs required. | `In progress` |
| **4. Sensitive Reply Disclosures in LLM** | Inbound email contains unprompted health/personal disclosure | Incoming replies must not be automatically fed to third-party LLMs without prior screening and redaction of special category text. | `Policy requirement` |

---

## 11. Google Workspace & International Transfers (Australia)

### 11.1 Shared Infrastructure Context
180Connect client outreach is dispatched from `sheffield@180dc.org`, hosted on the Google Workspace tenant (`180dc.org`) owned and administered by **180 Degrees Consulting Limited (Australia)**.

### 11.2 International Transfer Risk Analysis
* **The Potential Restricted Transfer:** Global super-administrators located in Australia have technical capabilities to access the Workspace environment, accounts, and mailbox contents for support, provisioning, and cybersecurity.
* **Jurisdictional Assessment:** Australia does not currently hold a UK adequacy regulation. Where Australian personnel have remote access to personal data held in the Workspace environment, that access may constitute a restricted transfer under UK GDPR Article 44.

### 11.3 Controls & Governance Framework
1. **Governance Agreement:** Execution of the proposed [`docs/global-workspace-data-protection-agreement.md`](global-workspace-data-protection-agreement.md), which establishes Sheffield as independent controller, restricts Global access strictly to infrastructure/security support, and prohibits Global repurposing of Sheffield outreach data.
2. **Transfer Safeguard Instrument:** Execution of the UK International Data Transfer Agreement (IDTA) or UK Addendum to EU SCCs.
3. **Transfer Risk Assessment (TRA):** Completion of a TRA assessing Australian surveillance laws and technical security measures (MFA, encryption in transit/rest, audit logging).
4. **Residual Risk Status:** **Medium / Pending** — processing must not proceed to unrestricted live outreach until the agreement and TRA are formally executed.

---

## 12. Third-Party Services, Recipients and Infrastructure

| Entity & Service | Role / Relationship | Hosting & Processing Region | International Transfer Mechanism | Security & Governance Controls | Deployment Status & Risk |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Supabase Inc.** | Data Processor (Database, auth, audit logs) | EU (Ireland, `eu-west-1`) | EEA processing/storage; reliance on the UK's adequacy regulations for relevant restricted transfers from the UK to the EEA, subject to applicable contractual and processor arrangements | DPA executed; RLS deny-by-default; daily backups | **Low** |
| **Vercel Inc.** | Data Processor (Application hosting & edge compute) | US / Global Edge | Vercel DPA with EU SCCs and UK Addendum | DPA executed; encrypted environment variables | **Low** |
| **Resend Inc.** | Data Processor (System & auth email transport) | US | Resend DPA with EU SCCs and UK IDTA | DPA executed; minimal auth data | **Low** |
| **Google LLC** | Data Processor / Service Provider (Workspace Mailbox) | US / Global | Google Workspace Cloud DPA (SCCs + UK Addendum) | Enterprise Workspace controls, MFA enforced | **Medium (Pending tenant governance)** |
| **180 Degrees Consulting Limited** | Shared Workspace tenant administrator. Role under UK GDPR: To be formally determined through inter-entity governance assessment. No unrestricted access to Sheffield outreach data permitted pending determination. | Australia / UK | IDTA / Addendum + TRA (In Progress) | Governance draft prepared ([`docs/global-workspace-data-protection-agreement.md`](global-workspace-data-protection-agreement.md)) | **Medium (Pending sign-off)** |
| **PostHog Inc.** | Data Processor (Usage analytics) | EU (Frankfurt) | EEA processing/storage; reliance on the UK's adequacy regulations for relevant restricted transfers from the UK to the EEA, subject to applicable contractual and processor arrangements | Planned; cookieless / minimised analytics | **Low** |
| **Third-Party LLM Provider (TBD)** | Data Processor (AI Service Provider — selection & DPA pending) | To be pinned to UK/EU | UK IDTA / UK Addendum + Zero-retention terms required | Provider evaluation, DPA execution, and zero-data-retention terms required before production use | **Medium (Pending selection & DPA)** |

---

## 13. Necessity and Proportionality Assessment

* **Data Minimisation (Article 5(1)(c)):** 180Connect implements automated field exclusion (F246/F247) at the ingestion boundary. Banned fields (home addresses, personal emails, dates of birth) are discarded before writing to database tables.
* **Accuracy (Article 5(1)(d)):** Registry data is sourced from statutory public bodies (Charity Commission, Companies House). CAMs verify contact accuracy before outreach.
* **Storage Limitation (Article 5(1)(e)):** Raw API source payloads are purged after **12 months**; database backups roll off after **30 days**; permanent suppressions are retained indefinitely to honour opt-outs.
* **Integrity and Confidentiality (Article 5(1)(f)):** Data is encrypted at rest (AES-256) and in transit (TLS 1.3). Access requires Google Workspace OAuth and explicit admin account provisioning.

---

## 14. Risk Assessment Methodology

Risks are evaluated using a standard 5 × 5 Likelihood and Severity matrix:

### Likelihood Scale
* **1 (Rare):** Highly unlikely to occur.
* **2 (Unlikely):** Not expected, but possible under exceptional circumstances.
* **3 (Possible):** Might occur at some point during platform operation.
* **4 (Likely):** Significant possibility of occurrence.
* **5 (Almost Certain):** Expected to occur without intervention.

### Severity Scale
* **1 (Negligible):** Minor inconvenience; no discernible privacy harm.
* **2 (Minor):** Short-term frustration; low-level non-sensitive data involved.
* **3 (Moderate):** Measurable distress, unwanted marketing volume, or temporary loss of control.
* **4 (Serious):** Significant distress, exposure of semi-private data, or regulatory non-compliance.
* **5 (Severe):** Severe financial loss, breach of special category data, or widespread fundamental rights infringement.

$$\text{Risk Score} = \text{Likelihood} \times \text{Severity}$$

* **1–6:** Low Risk (Acceptable once required controls are active)
* **8–12:** Medium Risk (Mitigation required before live processing)
* **15–25:** High Risk (Critical mitigation / blocking gate)

> **Governance Principle:** Residual risk rating and deployment status are separate governance concepts. A risk may have a numerically Low residual rating while deployment remains blocked because a mandatory legal, contractual, transparency, or security control has not yet been implemented or verified.

---

## 15. Risk Register & Mitigations

| ID | Identified Risk Description | Inherent L | Inherent S | Inherent Score | Applied Technical & Organisational Mitigations | Residual L | Residual S | Residual Score | Residual Risk | Control Status | Deployment Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **R1** | **Ingestion of private residential addresses or trustee personal data** | 4 | 4 | **16 (High)** | F246/F247 automated field filtering strips officer residential addresses, dates of birth, and trustee details at the ingestion boundary before persistence. | 1 | 3 | **3** | Low | `Implemented & verified` ✅ | **PERMITTED** ✅ |
| **R2** | **Accidental storage of personal email addresses** | 4 | 3 | **12 (Med)** | Role-based email allow-list (`personal_email_role_parts`), regex redactions, and database trigger `check_manual_entry_contact_email` on manual entries. | 1 | 3 | **3** | Low | `Implemented & verified` ✅ | **PERMITTED** ✅ |
| **R3** | **Unwanted direct marketing or PECR breach** | 3 | 3 | **9 (Med)** | Verification of corporate subscriber status; statutory company disclosures in every email; mandatory one-click opt-out link. | 2 | 2 | **4** | Low | `Implemented & verified` ✅ | **PERMITTED** ✅ |
| **R4** | **Re-contacting an individual after an opt-out / objection** | 2 | 5 | **10 (Med)** | Database-level `suppression_records` table automatically blocks delivery attempts to suppressed addresses across all users. | 1 | 4 | **4** | Low | `Implemented & verified` ✅ | **PERMITTED** ✅ |
| **R5** | **Over-reliance on automated priority scoring (Article 22)** | 3 | 3 | **9 (Med)** | Scores are strictly decision-support; CAM must independently review prospect details; CAM has full authority to override scores. | 1 | 2 | **2** | Low | `Implemented & verified` ✅ | **PERMITTED** ✅ |
| **R6** | **Unauthorised access to platform records** | 2 | 5 | **10 (Med)** | Google Workspace domain-restricted login + explicit admin activation + Supabase Row Level Security (RLS) deny-by-default. | 1 | 4 | **4** | Low | `Implemented & verified` ✅ | **PERMITTED** ✅ |
| **R7** | **Inappropriate disclosure to third-party LLM provider** | 3 | 4 | **12 (Med)** | Mandatory prompt data minimisation; zero-retention / no-model-training contractual terms; UK/EU region pinning. | 2 | 3 | **6** | Low | `Pending provider selection & DPA` ⏳ | **BLOCKED** 🛑 |
| **R8** | **Unscreened sensitive/health disclosures in email replies sent to LLM** | 3 | 4 | **12 (Med)** | Policy and architectural rule: Raw inbound email replies must not be transmitted to an LLM in the MVP. AI reply processing is deferred pending formal addendum. | 1 | 4 | **4** | Low | `Implemented policy restriction` ✅ | **PERMITTED (Rule Active)** ✅ |
| **R9** | **Ungoverned international remote access from Australia** | 4 | 4 | **16 (High)** | Execution of Global Workspace Governance Agreement + UK IDTA / UK Addendum + completed Transfer Risk Assessment (TRA). | 2 | 3 | **6** | Low | `Pending agreement execution & TRA` ⏳ | **BLOCKED** 🛑 |
| **R10** | **Personal data breach at cloud infrastructure level** | 2 | 5 | **10 (Med)** | Processor security controls, contractual security commitments, encryption at rest/in transit, access controls, daily backups, and incident-response procedures. | 1 | 4 | **4** | Low | `Implemented & verified` ✅ | **PERMITTED** ✅ |
| **R11** | **Failure to provide Article 14 transparency within the applicable statutory timeframe** | 3 | 3 | **9 (Med)** | Source and collection date logged on all indirect records; an Article 14 privacy notice made publicly accessible and linked from the initial outreach communication, with the organisation's source, processing purpose, lawful basis, relevant rights and other required transparency information disclosed in accordance with the applicable Article 14 requirements. | 1 | 2 | **2** | Low | `Pending notice publication & linking` ⏳ | **BLOCKED** 🛑 |
| **R12** | **Inaccurate or outdated professional contact information resulting in inappropriate outreach** | 3 | 3 | **9 (Med)** | CAM manual verification before outreach; source and collection date metadata; periodic data refreshes; manual record correction in UI; suppression handling. | 1 | 2 | **2** | Low | `Implemented & verified` ✅ | **PERMITTED** ✅ |
| **R14** | **Failure to appropriately respond to data subject rights requests (access, rectification, erasure, objection, restriction)** | 3 | 4 | **12 (Med)** | Documented rights-handling procedure; identifiable data source/record mapping; database suppression mechanism; manual UI record correction/deletion workflow; escalation to controller representative; audit logging of rights requests. | 1 | 3 | **3** | Low | `Implemented & verified` ✅ | **PERMITTED** ✅ |

---

## 16. Residual Risk Assessment

Following the application of the technical controls (F246/F247 filters, database triggers, RLS, suppressions) and organizational controls (human review, statutory disclosures, role governance):

* **Implemented Controls:** All risks related to core data ingestion, data minimisation, manual entry protection, internal access control, suppression enforcement, data subject rights, and MVP reply restrictions (R1, R2, R3, R4, R5, R6, R8, R10, R12, R14) are reduced to **Low Residual Risk (Score 2–4)** with active controls verified.
* **Pending Governance & Pre-Live Controls:** Risks related to international Workspace access (R9), LLM integration (R7), and Article 14 transparency (R11) have low numerical residual scores under the assessment methodology, but remain **deployment-blocking risks** because the required legal, contractual, and operational controls have not yet been implemented or formally verified.

---

## 17. Pre-Live Mandatory Governance Actions

### 17.1 Privacy & Technical Pre-Live Action Gates
The following technical and governance actions mitigate identified privacy risks and must be completed prior to initiating live client outreach:

| # | Action Item | Risk Mitigated | Responsible Owner | Target Gate |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **Execute Global Workspace Data Protection Agreement** | R9 (Australian access) | Project Manager / Leadership | Pre-Live Gate 1 |
| **2** | **Complete Transfer Risk Assessment (TRA) for Australia** | R9 (International transfer) | Project Manager | Pre-Live Gate 2 |
| **3** | **Publish and Link Article 14 Privacy Notice** | R11 (Transparency & timing) | Project Manager / Engineering | Pre-Live Gate 3 |
| **4** | **Finalise LLM Provider Selection with Zero-Retention DPA** | R7 (AI processing) | Project Manager / Engineering | Pre-Live Gate 4 |
| **5** | **Implement Email Reply Screening for Special Category Data** | R8 (Future reply processing) | Engineering | Pre-Live Gate 5 |
| **6** | **Finalise Article 30 Record of Processing Activities (ROPA)** | Accountability | Project Manager | Pre-Live Gate 6 |

### 17.2 Statutory & Regulatory Compliance Prerequisites
Separate from technical privacy risk mitigations, the controller must satisfy standard statutory requirements:

| Statutory Requirement | Legal Basis / Authority | Obligation Details | Status |
| :--- | :--- | :--- | :--- |
| **ICO Data Protection Registration & Fee** | Data (Charges and Information) Regulations 2018 | Complete controller-level Tier 1 registration and pay £47/£52 annual fee for Sheffield CIC. | Completed self-assessment; payment pending registration submission |

---

## 18. Stakeholder & Individual Consultation

* **Internal Stakeholders:** Consulted with 180DC Sheffield Project Management, CAM outreach volunteers, and technical leads to align workflows with data-minimisation controls.
* **Global Entity Consultation:** Transmitted draft governance framework ([`docs/global-workspace-data-protection-agreement.md`](global-workspace-data-protection-agreement.md)) to 180 Degrees Consulting Limited for infrastructure alignment.
* **Data Subject Perspective:** Assessed through the Legitimate Interest Assessment balancing test, ensuring that direct marketing remains targeted, professional, non-intrusive, and accompanied by transparent objection mechanisms.

### 18.1 Consultation Outcomes

The DPIA was reviewed against the proposed 180Connect architecture and operational workflow. Consultation identified the following key requirements:

* **Mandatory Human Agency:** Human approval must remain mandatory before every outbound email.
* **Boundary Exclusions:** Personal contact information must be excluded at the ingestion boundary before persistence.
* **International Transfer Safeguards:** Australian Workspace administration must be subject to documented international-transfer safeguards and governance terms.
* **LLM Gating:** LLM processing must not begin until the provider, contractual terms, retention settings, and transfer mechanism have been formally assessed and approved.
* **Indirect Transparency:** An Article 14 privacy notice must be available to individuals whose professional contact information is obtained indirectly.

These requirements have been incorporated into the pre-live controls and risk register contained in this DPIA.

---

## 19. DPIA Outcome & Decision

### 19.1 Pre-Live Deployment Gate Checklist

180Connect must not commence live client outreach until the following conditions have been evidenced and approved by the authorised data controller representative:

- [ ] Global Workspace governance agreement executed.
- [ ] Australia transfer assessment completed and approved.
- [ ] Appropriate transfer mechanism documented and executed where required.
- [ ] Article 14 privacy notice published and operationally linked to outreach.
- [ ] PECR corporate-subscriber eligibility controls verified.
- [ ] Suppression / objection controls tested end-to-end.
- [ ] Human-in-the-loop send gate tested.
- [ ] LLM provider formally selected, if enabled.
- [ ] LLM DPA and transfer assessment completed, if enabled.
- [ ] LLM reply processing disabled in MVP unless separately approved.
- [ ] Article 30 ROPA completed.
- [ ] ICO registration/fee position confirmed and completed.
- [ ] Final DPIA approved by authorised controller representative.

**Deployment Decision:** **BLOCKED** until all mandatory gates are satisfied.

### 19.2 Assessment Outcome Classification
* [ ] **Acceptable without conditions**
* [x] **Acceptable subject to implementation of pre-live conditions (Recommended)**
* [ ] **Unacceptable / Prior consultation with ICO required**

### 19.3 Formal DPIA Decision

> **DPIA OUTCOME: ACCEPTABLE SUBJECT TO PRE-LIVE CONDITIONS.**  
> 
> **The Data Protection Impact Assessment concludes that 180Connect incorporates robust technical and architectural controls (notably F246/F247 automated data exclusions, RLS access boundaries, and permanent database suppressions) that effectively mitigate core privacy risks.**  
> 
> **Live client outreach may proceed only after all mandatory pre-live conditions in §17 and §19.1 have been completed, evidenced, and approved by the authorised data controller representative.**

---

## 20. Sign-Off & Governance Record

| Role | Name | Signature / Approval | Date |
| :--- | :--- | :--- | :--- |
| **Lead Assessor / Project Manager** | Bashir Bobboi | *Bashir Bobboi* | 18 August 2026 |
| **Sheffield CIC Leadership / Authorised Controller Representative** | 180DC Sheffield Leadership Team | *Pending Final Leadership Review* | — |
