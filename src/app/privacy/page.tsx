import type { Metadata } from "next";
import LegalPage from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy | 180Connect",
  description:
    "Learn how 180Connect collects, uses, and protects your personal data in accordance with UK GDPR.",
};

const SECTIONS = [
  {
    heading: "Who We Are",
    body: [
      "180Connect is operated by 180 Degrees Consulting Sheffield ('we', 'us', 'our'), a student-run consulting organisation based in Sheffield, United Kingdom. We act as the data controller in respect of any personal data collected through this Platform.",
      "If you have any questions about how we handle your data, please contact us at sheffield@180dc.org.",
    ],
  },
  {
    heading: "What Data We Collect",
    body: [
      "We collect information you provide directly when you create or update your account, including your name, university email address, role within 180DC Sheffield, and any profile details you choose to add.",
      "We also collect data you enter while using the Platform in the course of your work — for example, contact details for client representatives, notes on project interactions, and activity logs relating to outreach and follow-up tasks.",
      "Usage data is collected automatically, including IP addresses, browser type, pages visited, and timestamps. This helps us maintain security and improve the Platform's reliability.",
    ],
  },
  {
    heading: "How We Use Your Data",
    body: [
      "We use the data we collect to operate and maintain 180Connect; to authenticate users and protect against unauthorised access; to facilitate collaboration between team members on shared client projects; and to generate internal reports that support 180DC Sheffield's operations.",
      "We do not use your personal data for advertising or sell it to third parties. We do not profile users for automated decision-making purposes.",
    ],
  },
  {
    heading: "Legal Basis for Processing",
    body: [
      "Where we process personal data we do so on one or more of the following legal bases under UK GDPR: (a) legitimate interests — operating a secure and functional platform for an active student organisation; (b) contract — processing necessary to provide the services you have requested; (c) legal obligation — where processing is required to comply with applicable law.",
      "For any processing that falls outside these bases, we will seek your explicit consent and give you a straightforward way to withdraw it at any time.",
    ],
  },
  {
    heading: "Data Sharing",
    body: [
      "We share data only with service providers who process it on our behalf and are bound by appropriate data processing agreements. These include our cloud hosting provider (Supabase) and authentication services.",
      "We may disclose information to regulatory authorities or law enforcement where required by law, or where necessary to protect the rights, safety, or property of 180DC Sheffield or its members.",
      "We do not share personal data with clients or other third parties except where you have explicitly consented or where it is strictly necessary for the delivery of a project you are working on.",
    ],
  },
  {
    heading: "Data Retention",
    body: [
      "We retain your account data for as long as you remain an active member of 180DC Sheffield. When your membership ends, your account is deactivated and personal data is pseudonymised or deleted within 90 days, unless retention is required by legal obligation.",
      "Client and project data may be retained for longer periods to support historical reporting and continuity of client relationships, but access is restricted to current leadership with a legitimate operational need.",
    ],
  },
  {
    heading: "Security",
    body: [
      "We take the security of your data seriously. 180Connect is hosted on infrastructure that applies encryption in transit (TLS) and at rest. Access to production data is restricted to authorised personnel and protected by multi-factor authentication.",
      "While we implement these safeguards, no system is completely secure. You should use a strong, unique password for your account and report any suspected security incidents to sheffield@180dc.org immediately.",
    ],
  },
  {
    heading: "Your Rights",
    body: [
      "Under UK GDPR you have the right to: access a copy of your personal data; correct inaccurate data; request erasure where data is no longer necessary; restrict or object to processing in certain circumstances; and data portability.",
      "To exercise any of these rights, contact us at sheffield@180dc.org. We will respond within 30 days. Where a request is complex or voluminous we may extend this period by a further two months and will notify you accordingly.",
      "You also have the right to lodge a complaint with the Information Commissioner's Office (ICO) at ico.org.uk if you believe we have not handled your data lawfully.",
    ],
  },
  {
    heading: "Cookies",
    body: [
      "180Connect uses session cookies to keep you authenticated during a session, and preference cookies to remember settings such as your display preferences. No third-party tracking or advertising cookies are used.",
      "You can control cookie settings through your browser. Disabling session cookies will prevent you from logging in. For full details see our Cookies page.",
    ],
  },
  {
    heading: "Changes to This Policy",
    body: [
      "We may update this Privacy Policy from time to time to reflect changes in our practices or in applicable law. Where changes are material, we will inform you via the Platform or email before they take effect.",
      "The date at the top of this page shows when the policy was last updated. We encourage you to review it periodically.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      subtitle="We keep things simple: your data stays private, is never sold, and is only ever used to make 180Connect work better for your team."
      sections={SECTIONS}
      activeHref="/privacy"
    />
  );
}
