import type { Metadata } from "next";
import LegalPage from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service | 180Connect",
  description:
    "Read the Terms of Service for 180Connect, the platform built for 180 Degrees Consulting Sheffield.",
};

const SECTIONS = [
  {
    heading: "Acceptance of Terms",
    body: [
      "By accessing or using 180Connect (the 'Platform'), you agree to be bound by these Terms of Service ('Terms'). If you do not agree to these Terms, please do not use the Platform.",
      "These Terms apply to all users of the Platform, including members of 180 Degrees Consulting Sheffield ('180DC Sheffield'), client representatives, and any other authorised parties.",
    ],
  },
  {
    heading: "Description of Service",
    body: [
      "180Connect is an internal client relationship and project management platform designed for use by 180DC Sheffield. It provides tools for managing client outreach, project tracking, follow-up communications, and team reporting.",
      "The Platform is not a general-purpose commercial product. Access is granted solely at the discretion of 180DC Sheffield's leadership team and is subject to the eligibility criteria set out in these Terms.",
    ],
  },
  {
    heading: "User Accounts and Eligibility",
    body: [
      "To use 180Connect you must be an authorised member or invited collaborator of 180DC Sheffield. You are responsible for maintaining the confidentiality of your account credentials and for all activity that occurs under your account.",
      "You agree to notify the team immediately at sheffield@180dc.org if you become aware of any unauthorised access to or use of your account. We reserve the right to suspend or terminate accounts that are in breach of these Terms.",
    ],
  },
  {
    heading: "Acceptable Use",
    body: [
      "You agree to use 180Connect only for lawful purposes and in accordance with these Terms. You must not: (a) use the Platform to store, transmit, or distribute content that is unlawful, harmful, or in breach of any third-party rights; (b) attempt to gain unauthorised access to any part of the Platform or its underlying infrastructure; (c) interfere with or disrupt the integrity or performance of the Platform.",
      "Any data entered into the Platform relating to clients, partners, or third parties must be handled in accordance with our Privacy Policy and applicable data protection law, including the UK General Data Protection Regulation (UK GDPR).",
    ],
  },
  {
    heading: "Intellectual Property",
    body: [
      "All content, software, design, and functionality that form part of 180Connect remain the property of 180DC Sheffield or its licensors. Nothing in these Terms transfers any intellectual property rights to you.",
      "You may not copy, reproduce, distribute, or create derivative works from any part of the Platform without prior written consent from 180DC Sheffield.",
    ],
  },
  {
    heading: "Data and Privacy",
    body: [
      "Your use of the Platform is also governed by our Privacy Policy, which is incorporated into these Terms by reference. By using 180Connect you confirm that you have read and understood the Privacy Policy.",
      "Client data entered into the Platform is held in confidence and may only be accessed or used for the purposes for which it was collected, consistent with 180DC Sheffield's obligations to its clients.",
    ],
  },
  {
    heading: "Disclaimers and Limitation of Liability",
    body: [
      "180Connect is provided 'as is' and 'as available' without warranties of any kind, either express or implied. We do not warrant that the Platform will be uninterrupted, error-free, or free from viruses or other harmful components.",
      "To the fullest extent permitted by applicable law, 180DC Sheffield shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising out of or in connection with your use of, or inability to use, the Platform.",
    ],
  },
  {
    heading: "Modifications to the Terms",
    body: [
      "We reserve the right to update these Terms at any time. Where changes are material, we will endeavour to give reasonable notice through the Platform or by email. Your continued use of 180Connect after any such changes constitutes your acceptance of the revised Terms.",
    ],
  },
  {
    heading: "Termination",
    body: [
      "We may suspend or terminate your access to the Platform at any time and without notice if we reasonably believe you have breached these Terms or if your membership of 180DC Sheffield ends.",
      "Upon termination, your right to access the Platform ceases immediately. Provisions of these Terms that by their nature should survive termination (including intellectual property, disclaimer, and limitation of liability sections) shall continue to apply.",
    ],
  },
  {
    heading: "Governing Law",
    body: [
      "These Terms are governed by and construed in accordance with the laws of England and Wales. Any disputes arising in connection with these Terms shall be subject to the exclusive jurisdiction of the courts of England and Wales.",
    ],
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      subtitle="Please read these Terms carefully before using 180Connect. They set out the rules for using our platform and your responsibilities as a user."
      sections={SECTIONS}
      activeHref="/terms"
      showHomeLink={false}
    />
  );
}
