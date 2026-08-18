# 180Connect – Legitimate Interest Assessment (LIA)

**Status:** DRAFT · **Version:** 0.1  
**Data Controller:** 180 Degrees Consulting Sheffield CIC (Company No. `15874544`, Registered in England and Wales; Registered Office: 67 Barber Road, Sheffield, England, S10 1EB)  
**Lead Assessor:** Bashir Bobboi (Project Manager)  
**Date of Assessment:** 18 August 2026  
**Next Review Date:** 18 February 2027 (or upon material changes to processing activities)  
**Applicable Framework:** UK GDPR Article 6(1)(f), Data Protection Act 2018, Privacy and Electronic Communications Regulations (PECR)  

> **Companion Documents:**
> * [`docs/data-handling-policy.md`](data-handling-policy.md) owns the controller-level data protection and processor framework.
> * [`docs/privacy-notice.md`](privacy-notice.md) provides the Article 14 transparency notice for indirect data subjects.
> * [`docs/personal-data-exclusions.md`](personal-data-exclusions.md) defines the technical data-minimisation and field-exclusion rules (F246/F247).
> * [`docs/data-lifecycle-policy.md`](data-lifecycle-policy.md) defines retention periods and deletion procedures.
> * [`docs/global-workspace-data-protection-agreement.md`](global-workspace-data-protection-agreement.md) establishes shared Google Workspace governance.

---

## 1. Scope of the Assessment

### 1.1 Defined Processing Activity
This Legitimate Interest Assessment evaluates the following defined processing activity:

> **The collection, enrichment, evaluation, and processing of limited professional contact details and public organisational information, obtained indirectly from public registers and corporate websites, for the purpose of identifying, prioritising, and initiating professional B2B outreach to prospective social-sector client organisations on behalf of 180 Degrees Consulting Sheffield CIC.**

### 1.2 Processing Lifecycle Under Evaluation
This assessment specifically covers seven interrelated processing stages:

1. **Identification of Prospective Organisations:** Ingesting public registry records (Charity Commission, Companies House, 360Giving, Find That Charity) to identify registered charities, CICs, and social enterprises in target regions and sectors.
2. **Collection of Permitted Professional Contact Data:** Extracting professional contact details (role-based inboxes, publicly advertised business contact addresses, and named organizational representatives where relevant).
3. **Organisational Enrichment:** Storing publicly available organisational attributes (legal name, registration numbers, income, geographic scope, mission statements).
4. **Decision-Support Prioritisation:** Generating priority and data-completeness scores to assist Client Acquisition Managers (CAMs) in evaluating organisation suitability.
5. **Initial Outreach Communications:** Drafting and sending tailored, professional email correspondence from the organisational mailbox (`sheffield@180dc.org`).
6. **Outreach & Suppression Record Keeping:** Tracking outreach status (drafted, sent, replied, suppressed) and recording permanent do-not-contact suppressions.
7. **Incoming Relationship Management:** Processing direct email responses received in the branch mailbox to coordinate consulting discovery meetings.

### 1.3 Out-of-Scope Activities
* **Advanced Third-Party LLM Processing:** Generative enrichment and automated reply summarisation via third-party LLMs involve distinct risk vectors and are evaluated separately in the Data Protection Impact Assessment (DPIA).
* **Volunteer & Internal Staff Administration:** Internal account provisioning and member management rely on employment/contractual frameworks and are outside this client-outreach LIA.

---

## 2. Part 1: The Purpose Test

*Is the controller pursuing a legitimate interest?*

### 2.1 Sheffield CIC's Commercial & Organisational Interests
180 Degrees Consulting Sheffield CIC operates as an incorporated social enterprise providing management consultancy and strategic advisory services to charities, non-profits, and social enterprises.

* **Pipeline Sustainability:** To maintain operations, engage student volunteer consultants, and deliver advisory projects, the CIC must proactively establish professional relationships with prospective client organisations.
* **Targeted Engagement:** Direct, personalised B2B outreach allows the CIC to identify organisations whose stated missions, scale, and operational challenges align with the consulting capabilities offered by the branch.
* **Operational Efficiency:** Using an auditable, structured platform (180Connect) ensures outreach is coordinated, avoids duplicate contacting across CAMs, and enforces suppression requests across all team members.

### 2.2 Wider Public & Social Sector Benefits
While Sheffield CIC's legitimate interest is rooted in its organisational mission, the processing also creates direct benefits for the recipient organisations and the wider community:
* **Capacity Building for Non-Profits:** Prospective clients gain access to pro bono or highly subsidised consultancy, strategic planning, and operational support.
* **Social Impact Amplification:** Consulting projects directly assist charities in expanding their beneficiary impact, fundraising efficiency, and governance.
* **Student Education & Development:** Student consultants gain valuable professional experience and training in social impact advisory.

*Note: In accordance with ICO guidance, Sheffield CIC's primary legal interest is establishing professional client relationships; the wider social impact represents supporting context rather than the sole legal basis.*

### 2.3 Purpose Test Conclusion
* **Is the purpose legitimate?** **Yes.** Cultivating client relationships for an incorporated Community Interest Company through direct B2B communication is a recognised, lawful commercial and organisational objective.
* **Is the purpose sufficiently clear?** **Yes.** The purpose is strictly bounded to prospective client outreach for consulting services.

---

## 3. Part 2: The Necessity Test

*Is the processing necessary to achieve the legitimate interest, and could it be achieved by less intrusive means?*

### 3.1 Why the Processing is Necessary
To connect with charities and social enterprises that require consulting support, the CIC must know:
1. Which organisations exist and fit the target criteria (sector, income, location);
2. What challenges or programs they operate (mission and profile); and
3. How to address a relevant professional or governance contact at the organisation.

Without processing this limited information, Sheffield CIC cannot identify suitable prospects or communicate its service offerings effectively.

### 3.2 Evaluation of Alternative Approaches

| Alternative Approach | Practical Feasibility | Privacy Impact vs. Effectiveness | Why Rejected / Insufficient |
| :--- | :--- | :--- | :--- |
| **1. Rely purely on inbound enquiries** | Ineffective for new or emerging CIC branches | Zero outreach privacy impact, but fails to build a viable client pipeline. | Most small-to-midsize charities do not actively seek student consultancy without initial awareness of available pro bono capacity. |
| **2. Generic role-based inboxes only (`info@`, `contact@`)** | Partially used in 180Connect | Low personal data impact. | Many small charities have unmonitored generic inboxes, or publicly designate specific officers (e.g. CEO, Fundraising Director) for partnership inquiries. |
| **3. Mass public advertising / social media ads** | Low targeting efficiency, high cost | Broad exposure, non-targeted. | Disproportionate financial cost for a CIC; indiscriminate broadcast rather than tailored engagement with organisations that actually need support. |
| **4. Uncoordinated manual spreadsheets** | Highly error-prone | High risk of data sprawl, lack of auditability. | Spreadsheets lack centralized suppression enforcement, risking repeated unwanted outreach after an opt-out. |
| **5. Collecting broader personal data (trustee home addresses, personal mobiles)** | Highly intrusive | Severe personal data impact. | **Rejected and strictly prohibited.** Excluded by design under F246/F247 rules as unnecessary for B2B outreach. |

### 3.3 Necessity Test Conclusion
* **Does the processing achieve the objective?** **Yes.** Targeted, informed B2B outreach is the most direct and effective method for connecting with prospective clients.
* **Is it the least intrusive way?** **Yes.** The platform implements strict data minimisation (F246/F247), collecting only the minimum professional contact points and explicitly stripping residential addresses, dates of birth, and personal emails.

---

## 4. Part 3: The Balancing Test

*Do the individual's interests, fundamental rights, and freedoms override the controller's legitimate interests?*

### 4.1 Nature of the Data Subjects
* **Professional Capacity:** Data subjects are adult professionals, trustees, directors, or designated points of contact acting in their official, public-facing capacity on behalf of charities, CICs, or commercial enterprises.
* **No Vulnerable Groups:** The processing does not target children, vulnerable individuals, or consumers in their private lives.

### 4.2 Nature of the Personal Data
* **Standard Professional Data:** Data is limited to professional identifiers (name, role/job title, business email address, organisation telephone, and corporate postal address).
* **Strict Exclusions:** 180Connect enforces automated database exclusions prohibiting:
  * Personal home/residential addresses;
  * Personal mobile or private telephone numbers;
  * Personal email addresses (enforced via `personal_email_role_parts` allow-list and trigger `check_manual_entry_contact_email`);
  * Special category data (health, religion, political opinions, ethnicity, sexual orientation).

### 4.3 Reasonable Expectations of Data Subjects
* **Public Availability:** Contact details are obtained from public statutory registers (Companies House, Charity Commission) or public charity websites where the organisation has published contact channels for external correspondence.
* **Public Availability vs. Marketing Expectations:** Public availability alone is not treated as consent or as an unrestricted expectation of marketing. The balancing assessment relies on the professional context, relevance of the proposed communication, limited nature of the data processed, the absence of private contact information, transparency measures, and the individual's ability to object to direct marketing at any time.
* **Contextual Relevance:** Outreach messages relate strictly to the professional activities, funding capacity, and operational objectives of the recipient's organisation.
* **Foreseeability:** Individuals holding professional roles within corporate bodies reasonably expect to receive professional B2B inquiries, introductions, and partnership propositions relevant to their sector.

### 4.4 Risk Assessment & Potential Impacts

| Identified Risk / Impact | Likelihood | Impact Severity | Safeguard & Mitigation Implemented in 180Connect | Residual Risk |
| :--- | :--- | :--- | :--- | :--- |
| **Unwanted marketing communications** | Medium | Low | Immediate, one-click opt-out in every email footer; instant permanent suppression recorded in the database. | Low |
| **Perceived intrusion into private data** | Low | Medium | Strict exclusion of residential addresses and private emails via F246/F247 automated filters. | Low |
| **Contacting the wrong individual** | Medium | Low | CAM manual review required before every send; email content tailored and respectful. | Very Low |
| **Excessive or repeated follow-ups** | Low | Medium | Human-in-the-loop sending gate; CAM must affirmatively initiate each communication; system tracks contact cadence. | Very Low |
| **Lack of transparency** | Medium | Low | Article 14 Privacy Notice linked in all email footers explaining source, purpose, and rights. | Low |
| **Disregard of an objection** | Low | High | Database-level suppression table (`suppression_records`) that permanently blocks email delivery to opted-out addresses. | Negligible |
| **Unauthorised access to records** | Low | High | Row Level Security (RLS), Google Workspace authentication restriction, role-based permissions (Admin/CAM/Viewer), and immutable audit logs. | Negligible |

### 4.5 Human Review Gate (Article 22 Protection)
* Automated priority scoring and enrichment in 180Connect serve solely as decision-support tools for CAMs.
* **No email is ever generated and sent autonomously.** Every communication must be reviewed, verified, and explicitly triggered by an authenticated CAM who possesses full authority to override scores or discard prospects.

---

## 5. Interaction with PECR (Direct Marketing Rules)

UK GDPR Article 6(1)(f) and the Privacy and Electronic Communications Regulations (PECR) represent separate, concurrent legal requirements:

1. **Corporate Subscribers:** Under Regulation 22 of PECR, direct marketing emails to **corporate bodies** (incorporated charities, Community Interest Companies, limited companies, and limited liability partnerships) do not require prior opt-in consent. Legitimate interest under Article 6(1)(f) is the appropriate UK GDPR basis for processing the personal data of named individuals at those corporate bodies.
2. **Individual Subscribers (Sole Traders & Unincorporated Partnerships):** Sole traders and certain traditional partnerships are treated as individual subscribers under PECR. They must not receive direct marketing emails without prior consent or an applicable statutory exemption. 180Connect focuses outreach on incorporated entities and requires verification prior to contacting unincorporated organisations.
3. **Mandatory PECR Safeguards:** Every email sent via 180Connect includes:
   * Clear identification of the sender (**180 Degrees Consulting Sheffield CIC**);
   * Valid statutory company registration and registered office details;
   * A functioning, unhindered opt-out mechanism ([sheffield@180dc.org](mailto:sheffield@180dc.org) / unsubscribe link).

---

## 6. Assessment Conclusion & Decision

### 6.1 Summary of the Three-Part Test
* **Purpose Test:** Met. Sheffield CIC has a clear, legitimate commercial and social interest in establishing professional advisory relationships with social-sector organisations.
* **Necessity Test:** Met. The processing of limited professional contact details is necessary and proportionate to achieve targeted B2B outreach, and cannot be achieved effectively by less intrusive means.
* **Balancing Test:** Met. The individual's fundamental rights and privacy interests do not override the controller's legitimate interests, given the professional context, reasonable expectations, strict data minimisation, human-in-the-loop controls, and absolute right to object.

### 6.2 Formal Assessment Decision

> **DECISION:** **APPROVED IN PRINCIPLE — SUBJECT TO CONTROLLER / LEADERSHIP SIGN-OFF.**  
> **The three-part legitimate interests test has been completed and the assessment concludes that Article 6(1)(f) (Legitimate Interests) is an appropriate lawful basis for the defined processing activities, subject to the conditions set out in §6.3 and final approval by an authorised representative of 180 Degrees Consulting Sheffield CIC.**

### 6.3 Mandatory Conditions for Ongoing Compliance
Reliance on this LIA is contingent upon the following controls remaining active:
1. **Article 14 Notice:** The external Privacy Notice must be accessible via outreach email footers.
2. **Permanent Suppression:** Any opt-out or objection (Article 21) must be recorded immediately in `suppression_records` and honoured permanently.
3. **Automated Data Minimisation:** The F246/F247 exclusion rules and role email triggers must remain active in production.
4. **Mandatory Human Review:** No automated sending may be enabled; all outreach must remain human-initiated.
5. **DPIA Completion:** The companion Data Protection Impact Assessment (DPIA) must be signed off prior to live outreach.

---

## 7. Sign-Off & Governance Record

| Role | Name | Signature / Approval | Date |
| :--- | :--- | :--- | :--- |
| **Lead Assessor / Project Manager** | Bashir Bobboi | *Bashir Bobboi* | 18 August 2026 |
| **Sheffield CIC Leadership / Authorised Controller Representative** | 180DC Sheffield Leadership Team | *Pending Final Leadership Review* | — |
