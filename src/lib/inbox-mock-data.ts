/**
 * TEMPORARY design data for the inbox: multi-turn conversations with UK
 * charities, NGOs and foundations across the outreach stages, so the queue and
 * the thread view can be designed against a full page while the live database
 * holds only a handful of real threads.
 *
 * `mockQueueRows` at the foot of this file is the only entry point the queue
 * uses, and it emits the REAL row type. Removal instructions are in the comment
 * above it.
 */

import { formatRelativeTime } from "./display-format.ts";
import { buildInboxQueue, daysSince, type InboxQueueRow } from "./inbox-queue.ts";
import type { FollowUpRecommendation } from "./outreach/follow-up-recommendations.ts";
import { isRecentReply, type InboxThread, type InboxThreadStatus } from "./outreach-inbox.ts";

export type MockAttachment = {
  id: string;
  filename: string;
  fileType: "pdf" | "docx" | "xlsx" | "pptx" | "png";
  sizeBytes: number;
  downloadUrl?: string;
};

export type MockEmailMessage = {
  id: string;
  senderName: string;
  senderEmail: string;
  senderRole?: string;
  recipientName: string;
  recipientEmail: string;
  sentAt: string; // ISO timestamp
  subject: string;
  body: string;
  isFromClient: boolean;
  intent?: "interested" | "meeting_booked" | "more_info" | "referral" | null;
  attachments?: MockAttachment[];
};

export type MockThread = {
  id: string; // Organisation ID
  orgName: string;
  orgType: string;
  city: string;
  country: string;
  sector: "Charities & NGOs" | "Health & Well-being" | "Youth & Education" | "Environment" | "Grants & Foundations";
  labelColor: string;
  primaryContact: {
    name: string;
    role: string;
    email: string;
    phone?: string;
  };
  camOwner: {
    name: string;
    email: string;
    avatarUrl?: string;
  };
  status: "replied" | "awaiting" | "sent" | "draft";
  replyIntent?: "interested" | "meeting_booked" | "more_info" | "referral" | null;
  subject: string;
  snippet: string;
  lastActivityAt: string;
  isRead: boolean;
  isStarred: boolean;
  isImportant: boolean;
  folder: "inbox" | "starred" | "snoozed" | "sent" | "drafts" | "archive" | "trash";
  messages: MockEmailMessage[];
  attachments: MockAttachment[];
  notesCount: number;
  handoversCount: number;
};

export const MOCK_INBOX_THREADS: MockThread[] = [
  {
    id: "mock-org-cruk",
    orgName: "Cancer Research UK",
    orgType: "Registered Charity",
    city: "London",
    country: "United Kingdom",
    sector: "Health & Well-being",
    labelColor: "#0ea5e9", // Sky blue
    primaryContact: {
      name: "Dr. Marcus Vance",
      role: "Head of Strategic Partnerships",
      email: "m.vance@cancerresearchuk.org",
      phone: "+44 20 7123 4567",
    },
    camOwner: {
      name: "Ada Lovelace",
      email: "ada.lovelace@180dc.org",
    },
    status: "replied",
    replyIntent: "interested",
    subject: "Re: 180 Degrees Consulting — Strategic Impact & Data Assessment",
    snippet: "Thanks Ada, we reviewed the initial deck with the team. We would love to explore a 6-week pro-bono scoping project for our donor retention metrics...",
    lastActivityAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(), // 25 mins ago
    isRead: false,
    isStarred: true,
    isImportant: true,
    folder: "inbox",
    attachments: [
      {
        id: "att-cruk-1",
        filename: "CRUK_Donor_Analytics_Scope_2026.pdf",
        fileType: "pdf",
        sizeBytes: 2450000,
      },
      {
        id: "att-cruk-2",
        filename: "180DC_Capability_Deck.pdf",
        fileType: "pdf",
        sizeBytes: 4120000,
      },
    ],
    notesCount: 4,
    handoversCount: 1,
    messages: [
      {
        id: "msg-cruk-1",
        senderName: "Ada Lovelace",
        senderEmail: "ada.lovelace@180dc.org",
        senderRole: "Client Account Manager • 180DC",
        recipientName: "Dr. Marcus Vance",
        recipientEmail: "m.vance@cancerresearchuk.org",
        sentAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        subject: "180 Degrees Consulting — Strategic Impact & Data Assessment",
        body: `Dear Dr. Vance,

I hope this email finds you well.

I am reaching out from 180 Degrees Consulting, the world's largest consultancy for non-profits and social enterprises. Our team at the Sheffield & London branches has followed Cancer Research UK's inspiring recent community outreach initiatives with great admiration.

We provide high-impact, pro-bono strategic consulting across digital fundraising, data analytics, and operational efficiency. Each project is staffed by top-tier student consultants and overseen by experienced senior mentors from top-tier management consultancies.

We would love to connect for a 15-minute introductory call to explore how our team might support CRUK's upcoming strategic priorities this semester at zero cost to your organization.

Attached is our capability overview deck for your reference.

Warm regards,

Ada Lovelace
Client Account Manager | 180 Degrees Consulting
ada.lovelace@180dc.org | +44 7700 900123`,
        isFromClient: false,
        attachments: [
          {
            id: "att-cruk-2",
            filename: "180DC_Capability_Deck.pdf",
            fileType: "pdf",
            sizeBytes: 4120000,
          },
        ],
      },
      {
        id: "msg-cruk-2",
        senderName: "Dr. Marcus Vance",
        senderEmail: "m.vance@cancerresearchuk.org",
        senderRole: "Head of Strategic Partnerships",
        recipientName: "Ada Lovelace",
        recipientEmail: "ada.lovelace@180dc.org",
        sentAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
        subject: "Re: 180 Degrees Consulting — Strategic Impact & Data Assessment",
        body: `Hi Ada,

Thank you for reaching out and for sharing the capability deck.

Your timing is actually quite fortuitous. Our partnerships and donor intelligence division is currently reviewing our recurring donor retention model across regional hubs, and we have identified a need for fresh data modeling and cohort analytics.

We would be very interested in exploring a 6-week pro-bono project with 180DC. I've attached our initial problem brief. 

Could you and your project team do a video call this Thursday at 3:00 PM or Friday at 11:00 AM?

Best regards,

Dr. Marcus Vance
Head of Strategic Partnerships | Cancer Research UK
m.vance@cancerresearchuk.org`,
        isFromClient: true,
        intent: "interested",
        attachments: [
          {
            id: "att-cruk-1",
            filename: "CRUK_Donor_Analytics_Scope_2026.pdf",
            fileType: "pdf",
            sizeBytes: 2450000,
          },
        ],
      },
    ],
  },
  {
    id: "mock-org-redcross",
    orgName: "British Red Cross",
    orgType: "Charitable Trust",
    city: "London",
    country: "United Kingdom",
    sector: "Charities & NGOs",
    labelColor: "#ef4444", // Red
    primaryContact: {
      name: "Eleanor Wright",
      role: "Director of Emergency Operations & Logistics",
      email: "eleanor.wright@redcross.org.uk",
      phone: "+44 20 7877 7000",
    },
    camOwner: {
      name: "Arthur Dent",
      email: "arthur.dent@180dc.org",
    },
    status: "replied",
    replyIntent: "meeting_booked",
    subject: "Confirmed: Project Scoping Workshop for Emergency Dispatch Flow",
    snippet: "Hi Arthur, that calendar invite works perfectly. Looking forward to meeting the consulting team on Tuesday at 2 PM...",
    lastActivityAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
    isRead: false,
    isStarred: true,
    isImportant: true,
    folder: "inbox",
    attachments: [
      {
        id: "att-brc-1",
        filename: "BRC_Logistics_Overview.pdf",
        fileType: "pdf",
        sizeBytes: 1850000,
      },
    ],
    notesCount: 2,
    handoversCount: 0,
    messages: [
      {
        id: "msg-brc-1",
        senderName: "Arthur Dent",
        senderEmail: "arthur.dent@180dc.org",
        recipientName: "Eleanor Wright",
        recipientEmail: "eleanor.wright@redcross.org.uk",
        sentAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
        subject: "Introduction & Pro-Bono Strategy Support — 180 Degrees Consulting",
        body: `Hi Eleanor,\n\nI am reaching out regarding potential consulting support for British Red Cross supply chain logistics. We have a team ready to evaluate dispatch optimization.\n\nBest,\nArthur`,
        isFromClient: false,
      },
      {
        id: "msg-brc-2",
        senderName: "Eleanor Wright",
        senderEmail: "eleanor.wright@redcross.org.uk",
        recipientName: "Arthur Dent",
        recipientEmail: "arthur.dent@180dc.org",
        sentAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        subject: "Confirmed: Project Scoping Workshop for Emergency Dispatch Flow",
        body: `Hi Arthur,\n\nThat calendar invite works perfectly. Looking forward to meeting the consulting team on Tuesday at 2 PM. I have shared our emergency logistics workflow document in advance.\n\nBest regards,\nEleanor Wright`,
        isFromClient: true,
        intent: "meeting_booked",
        attachments: [
          {
            id: "att-brc-1",
            filename: "BRC_Logistics_Overview.pdf",
            fileType: "pdf",
            sizeBytes: 1850000,
          },
        ],
      },
    ],
  },
  {
    id: "mock-org-wellcome",
    orgName: "Wellcome Trust",
    orgType: "Grant-making Foundation",
    city: "London",
    country: "United Kingdom",
    sector: "Grants & Foundations",
    labelColor: "#8b5cf6", // Purple
    primaryContact: {
      name: "Dr. Sophia Chen",
      role: "Director of Research Funding & Innovation",
      email: "s.chen@wellcome.org",
    },
    camOwner: {
      name: "Ada Lovelace",
      email: "ada.lovelace@180dc.org",
    },
    status: "replied",
    replyIntent: "more_info",
    subject: "Re: Grant Impact Evaluation Framework — 180DC Collaboration",
    snippet: "Could you send over 2-3 case studies of previous foundation consulting engagements and consultant profiles?",
    lastActivityAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), // 5 hours ago
    isRead: true,
    isStarred: false,
    isImportant: true,
    folder: "inbox",
    attachments: [],
    notesCount: 3,
    handoversCount: 0,
    messages: [
      {
        id: "msg-well-1",
        senderName: "Ada Lovelace",
        senderEmail: "ada.lovelace@180dc.org",
        recipientName: "Dr. Sophia Chen",
        recipientEmail: "s.chen@wellcome.org",
        sentAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        subject: "Grant Impact Evaluation Framework — 180DC Collaboration",
        body: `Dear Dr. Chen,\n\nWe would love to share how 180DC helps research foundations build standardized impact measurement frameworks for grant recipients.\n\nWarm regards,\nAda`,
        isFromClient: false,
      },
      {
        id: "msg-well-2",
        senderName: "Dr. Sophia Chen",
        senderEmail: "s.chen@wellcome.org",
        recipientName: "Ada Lovelace",
        recipientEmail: "ada.lovelace@180dc.org",
        sentAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        subject: "Re: Grant Impact Evaluation Framework — 180DC Collaboration",
        body: `Dear Ada,\n\nThank you for reaching out. The concept looks promising. Could you send over 2-3 case studies of previous foundation consulting engagements and consultant profiles before we schedule a formal briefing?\n\nKind regards,\nDr. Sophia Chen`,
        isFromClient: true,
        intent: "more_info",
      },
    ],
  },
  {
    id: "mock-org-amnesty",
    orgName: "Amnesty International UK",
    orgType: "Non-Governmental Organisation",
    city: "London",
    country: "United Kingdom",
    sector: "Charities & NGOs",
    labelColor: "#f59e0b", // Amber
    primaryContact: {
      name: "Tariq Al-Mansoor",
      role: "Head of Campaign Strategy",
      email: "tariq.almansoor@amnesty.org.uk",
    },
    camOwner: {
      name: "Ada Lovelace",
      email: "ada.lovelace@180dc.org",
    },
    status: "awaiting",
    subject: "Follow-up: Scoping Draft for Volunteer Engagement Strategy",
    snippet: "Following our initial discussion last week, here is the detailed scope outlining the 3 workstreams...",
    lastActivityAt: new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString(), // 9 hours ago
    isRead: true,
    isStarred: true,
    isImportant: false,
    folder: "inbox",
    attachments: [
      {
        id: "att-amnesty-1",
        filename: "Amnesty_Volunteer_Strategy_Proposal.docx",
        fileType: "docx",
        sizeBytes: 980000,
      },
    ],
    notesCount: 1,
    handoversCount: 0,
    messages: [
      {
        id: "msg-amn-1",
        senderName: "Ada Lovelace",
        senderEmail: "ada.lovelace@180dc.org",
        recipientName: "Tariq Al-Mansoor",
        recipientEmail: "tariq.almansoor@amnesty.org.uk",
        sentAt: new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString(),
        subject: "Follow-up: Scoping Draft for Volunteer Engagement Strategy",
        body: `Hi Tariq,\n\nFollowing our initial discussion last week, here is the detailed scope outlining the 3 workstreams for volunteer retention and digital campaign analytics.\n\nLet us know if this aligns with your steering committee's expectations!\n\nBest,\nAda`,
        isFromClient: false,
        attachments: [
          {
            id: "att-amnesty-1",
            filename: "Amnesty_Volunteer_Strategy_Proposal.docx",
            fileType: "docx",
            sizeBytes: 980000,
          },
        ],
      },
    ],
  },
  {
    id: "mock-org-oxfam",
    orgName: "Oxfam Great Britain",
    orgType: "Registered Charity",
    city: "Oxford",
    country: "United Kingdom",
    sector: "Charities & NGOs",
    labelColor: "#10b981", // Emerald
    primaryContact: {
      name: "Amara Diallo",
      role: "Global Supply & Ethical Procurement Lead",
      email: "adiallo@oxfam.org.uk",
    },
    camOwner: {
      name: "Arthur Dent",
      email: "arthur.dent@180dc.org",
    },
    status: "replied",
    replyIntent: "interested",
    subject: "Re: Pro-bono Strategy Support: Supply Chain Optimization",
    snippet: "Hi Arthur, we are keen to proceed. Our retail shop distribution network could benefit immensely from route modeling...",
    lastActivityAt: new Date(Date.now() - 14 * 60 * 60 * 1000).toISOString(), // 14 hours ago
    isRead: false,
    isStarred: false,
    isImportant: true,
    folder: "inbox",
    attachments: [],
    notesCount: 2,
    handoversCount: 1,
    messages: [
      {
        id: "msg-oxf-1",
        senderName: "Arthur Dent",
        senderEmail: "arthur.dent@180dc.org",
        recipientName: "Amara Diallo",
        recipientEmail: "adiallo@oxfam.org.uk",
        sentAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        subject: "Pro-bono Strategy Support: Supply Chain Optimization",
        body: `Dear Amara,\n\nWe would love to assist Oxfam GB in analyzing distribution networks for high street retail operations.\n\nBest,\nArthur`,
        isFromClient: false,
      },
      {
        id: "msg-oxf-2",
        senderName: "Amara Diallo",
        senderEmail: "adiallo@oxfam.org.uk",
        recipientName: "Arthur Dent",
        recipientEmail: "arthur.dent@180dc.org",
        sentAt: new Date(Date.now() - 14 * 60 * 60 * 1000).toISOString(),
        subject: "Re: Pro-bono Strategy Support: Supply Chain Optimization",
        body: `Hi Arthur,\n\nWe are keen to proceed. Our retail shop distribution network could benefit immensely from route modeling. Let's arrange a team call next week.\n\nRegards,\nAmara`,
        isFromClient: true,
        intent: "interested",
      },
    ],
  },
  {
    id: "mock-org-princesstrust",
    orgName: "The Prince's Trust",
    orgType: "Royal Charter Charity",
    city: "London",
    country: "United Kingdom",
    sector: "Youth & Education",
    labelColor: "#6366f1", // Indigo
    primaryContact: {
      name: "Chloe Bennett",
      role: "Head of Youth Mentorship Programmes",
      email: "chloe.bennett@princes-trust.org.uk",
    },
    camOwner: {
      name: "Ada Lovelace",
      email: "ada.lovelace@180dc.org",
    },
    status: "replied",
    replyIntent: "interested",
    subject: "Youth Enterprise Mentorship Tracking — 180DC Scoping",
    snippet: "We reviewed your proposal in our executive committee. We would like to begin project onboarding for the spring cohort...",
    lastActivityAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
    isRead: true,
    isStarred: true,
    isImportant: true,
    folder: "inbox",
    attachments: [
      {
        id: "att-pt-1",
        filename: "Princes_Trust_KPI_Framework.xlsx",
        fileType: "xlsx",
        sizeBytes: 1120000,
      },
    ],
    notesCount: 5,
    handoversCount: 0,
    messages: [
      {
        id: "msg-pt-1",
        senderName: "Chloe Bennett",
        senderEmail: "chloe.bennett@princes-trust.org.uk",
        recipientName: "Ada Lovelace",
        recipientEmail: "ada.lovelace@180dc.org",
        sentAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        subject: "Youth Enterprise Mentorship Tracking — 180DC Scoping",
        body: `Hi Ada,\n\nWe reviewed your proposal in our executive committee. We would like to begin project onboarding for the spring cohort. I've attached our current KPI tracking framework.\n\nBest,\nChloe`,
        isFromClient: true,
        intent: "interested",
        attachments: [
          {
            id: "att-pt-1",
            filename: "Princes_Trust_KPI_Framework.xlsx",
            fileType: "xlsx",
            sizeBytes: 1120000,
          },
        ],
      },
    ],
  },
  {
    id: "mock-org-wwf",
    orgName: "WWF UK",
    orgType: "Environmental Charity",
    city: "Woking",
    country: "United Kingdom",
    sector: "Environment",
    labelColor: "#059669", // Dark emerald
    primaryContact: {
      name: "Dr. Oliver King",
      role: "Director of Conservation Policy",
      email: "oking@wwf.org.uk",
    },
    camOwner: {
      name: "Ada Lovelace",
      email: "ada.lovelace@180dc.org",
    },
    status: "sent",
    subject: "Strategic Partnership: Climate Impact Dashboard Scoping",
    snippet: "Dear Dr. King, 180 Degrees Consulting is supporting environmental NGOs with data pipeline automation and corporate ESG benchmarking...",
    lastActivityAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
    isRead: true,
    isStarred: false,
    isImportant: false,
    folder: "sent",
    attachments: [],
    notesCount: 1,
    handoversCount: 0,
    messages: [
      {
        id: "msg-wwf-1",
        senderName: "Ada Lovelace",
        senderEmail: "ada.lovelace@180dc.org",
        recipientName: "Dr. Oliver King",
        recipientEmail: "oking@wwf.org.uk",
        sentAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        subject: "Strategic Partnership: Climate Impact Dashboard Scoping",
        body: `Dear Dr. King,\n\n180 Degrees Consulting is supporting environmental NGOs with data pipeline automation and corporate ESG benchmarking. We would love to discuss a semester engagement with WWF UK.\n\nSincerely,\nAda`,
        isFromClient: false,
      },
    ],
  },
  {
    id: "mock-org-trussell",
    orgName: "Trussell Trust",
    orgType: "Food Bank Network Charity",
    city: "Salisbury",
    country: "United Kingdom",
    sector: "Charities & NGOs",
    labelColor: "#f97316", // Orange
    primaryContact: {
      name: "Rachel Green",
      role: "Network Operations Director",
      email: "rachel.green@trusselltrust.org",
    },
    camOwner: {
      name: "Arthur Dent",
      email: "arthur.dent@180dc.org",
    },
    status: "replied",
    replyIntent: "interested",
    subject: "Re: Food Bank Logistics & Volunteer Scheduling Support",
    snippet: "Hi Arthur, this sounds very helpful. We are currently experiencing increased demand across our northern branches...",
    lastActivityAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    isRead: true,
    isStarred: false,
    isImportant: false,
    folder: "inbox",
    attachments: [],
    notesCount: 2,
    handoversCount: 0,
    messages: [
      {
        id: "msg-tt-1",
        senderName: "Rachel Green",
        senderEmail: "rachel.green@trusselltrust.org",
        recipientName: "Arthur Dent",
        recipientEmail: "arthur.dent@180dc.org",
        sentAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        subject: "Re: Food Bank Logistics & Volunteer Scheduling Support",
        body: `Hi Arthur,\n\nThis sounds very helpful. We are currently experiencing increased demand across our northern branches and would value an external optimization study.\n\nBest,\nRachel`,
        isFromClient: true,
        intent: "interested",
      },
    ],
  },
  {
    id: "mock-org-mind",
    orgName: "Mind (National Association for Mental Health)",
    orgType: "Mental Health Charity",
    city: "London",
    country: "United Kingdom",
    sector: "Health & Well-being",
    labelColor: "#3b82f6", // Blue
    primaryContact: {
      name: "Dr. Rebecca Foster",
      role: "Head of Community Services",
      email: "r.foster@mind.org.uk",
    },
    camOwner: {
      name: "Ada Lovelace",
      email: "ada.lovelace@180dc.org",
    },
    status: "replied",
    replyIntent: "referral",
    subject: "Referral: Student Well-being Outreach Initiative",
    snippet: "Hello Ada, I am passing your message along to our Youth Strategy lead, Simon Cox, who oversees university partnerships...",
    lastActivityAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    isRead: true,
    isStarred: false,
    isImportant: false,
    folder: "inbox",
    attachments: [],
    notesCount: 1,
    handoversCount: 0,
    messages: [
      {
        id: "msg-mind-1",
        senderName: "Dr. Rebecca Foster",
        senderEmail: "r.foster@mind.org.uk",
        recipientName: "Ada Lovelace",
        recipientEmail: "ada.lovelace@180dc.org",
        sentAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
        subject: "Referral: Student Well-being Outreach Initiative",
        body: `Hello Ada,\n\nI am passing your message along to our Youth Strategy lead, Simon Cox, who oversees university partnerships.\n\nBest,\nDr. Foster`,
        isFromClient: true,
        intent: "referral",
      },
    ],
  },
  {
    id: "mock-org-shelter",
    orgName: "Shelter UK",
    orgType: "Housing & Homelessness Charity",
    city: "London",
    country: "United Kingdom",
    sector: "Charities & NGOs",
    labelColor: "#dc2626", // Deep Red
    primaryContact: {
      name: "James O'Connor",
      role: "Head of Digital Inclusion",
      email: "james_oconnor@shelter.org.uk",
    },
    camOwner: {
      name: "Arthur Dent",
      email: "arthur.dent@180dc.org",
    },
    status: "awaiting",
    subject: "Follow-up: Housing Advice Portal Optimization Scoping",
    snippet: "Checking in to see if your team had a chance to review the revised project timeline sent on Monday...",
    lastActivityAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    isRead: true,
    isStarred: false,
    isImportant: false,
    folder: "inbox",
    attachments: [],
    notesCount: 3,
    handoversCount: 0,
    messages: [
      {
        id: "msg-sh-1",
        senderName: "Arthur Dent",
        senderEmail: "arthur.dent@180dc.org",
        recipientName: "James O'Connor",
        recipientEmail: "james_oconnor@shelter.org.uk",
        sentAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        subject: "Follow-up: Housing Advice Portal Optimization Scoping",
        body: `Hi James,\n\nChecking in to see if your team had a chance to review the revised project timeline sent on Monday.\n\nBest,\nArthur`,
        isFromClient: false,
      },
    ],
  },
  {
    id: "mock-org-savethechildren",
    orgName: "Save the Children UK",
    orgType: "International NGO",
    city: "London",
    country: "United Kingdom",
    sector: "Youth & Education",
    labelColor: "#e11d48", // Rose
    primaryContact: {
      name: "Hannah Abbott",
      role: "Global Partnerships Manager",
      email: "h.abbott@savethechildren.org.uk",
    },
    camOwner: {
      name: "Ada Lovelace",
      email: "ada.lovelace@180dc.org",
    },
    status: "replied",
    replyIntent: "more_info",
    subject: "Re: Pro-Bono Project Brief: Early Childhood Education Metrics",
    snippet: "Could you provide details on the team's data engineering background and security clearance process?",
    lastActivityAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
    isRead: true,
    isStarred: true,
    isImportant: false,
    folder: "inbox",
    attachments: [],
    notesCount: 2,
    handoversCount: 0,
    messages: [
      {
        id: "msg-stc-1",
        senderName: "Hannah Abbott",
        senderEmail: "h.abbott@savethechildren.org.uk",
        recipientName: "Ada Lovelace",
        recipientEmail: "ada.lovelace@180dc.org",
        sentAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
        subject: "Re: Pro-Bono Project Brief: Early Childhood Education Metrics",
        body: `Dear Ada,\n\nCould you provide details on the team's data engineering background and security clearance process?\n\nKind regards,\nHannah`,
        isFromClient: true,
        intent: "more_info",
      },
    ],
  },
  {
    id: "mock-org-macmillan",
    orgName: "Macmillan Cancer Support",
    orgType: "Healthcare Charity",
    city: "London",
    country: "United Kingdom",
    sector: "Health & Well-being",
    labelColor: "#16a34a", // Green
    primaryContact: {
      name: "David Miller",
      role: "Service Design Lead",
      email: "dmiller@macmillan.org.uk",
    },
    camOwner: {
      name: "Arthur Dent",
      email: "arthur.dent@180dc.org",
    },
    status: "replied",
    replyIntent: "interested",
    subject: "Collaboration Scope: Patient Support Line Service Experience",
    snippet: "Thank you for the thorough proposal. We are interested in scheduling the discovery interviews next month...",
    lastActivityAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    isRead: true,
    isStarred: false,
    isImportant: false,
    folder: "inbox",
    attachments: [
      {
        id: "att-mac-1",
        filename: "Macmillan_Service_Design_Brief.pdf",
        fileType: "pdf",
        sizeBytes: 3100000,
      },
    ],
    notesCount: 1,
    handoversCount: 0,
    messages: [
      {
        id: "msg-mac-1",
        senderName: "David Miller",
        senderEmail: "dmiller@macmillan.org.uk",
        recipientName: "Arthur Dent",
        recipientEmail: "arthur.dent@180dc.org",
        sentAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        subject: "Collaboration Scope: Patient Support Line Service Experience",
        body: `Hi Arthur,\n\nThank you for the thorough proposal. We are interested in scheduling the discovery interviews next month.\n\nBest,\nDavid`,
        isFromClient: true,
        intent: "interested",
        attachments: [
          {
            id: "att-mac-1",
            filename: "Macmillan_Service_Design_Brief.pdf",
            fileType: "pdf",
            sizeBytes: 3100000,
          },
        ],
      },
    ],
  },
  {
    id: "mock-org-stmungos",
    orgName: "St Mungo's",
    orgType: "Registered Charity",
    city: "London",
    country: "United Kingdom",
    sector: "Charities & NGOs",
    labelColor: "#0284c7",
    primaryContact: {
      name: "Liam Davies",
      role: "Rough Sleeping Initiatives Lead",
      email: "liam.davies@mungos.org",
    },
    camOwner: {
      name: "Ada Lovelace",
      email: "ada.lovelace@180dc.org",
    },
    status: "sent",
    subject: "Winter Shelter Capacity Planning & Route Analytics",
    snippet: "Dear Liam, 180DC is preparing our spring consulting cycle and would love to support St Mungo's shelter allocations...",
    lastActivityAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    isRead: true,
    isStarred: false,
    isImportant: false,
    folder: "sent",
    attachments: [],
    notesCount: 0,
    handoversCount: 0,
    messages: [
      {
        id: "msg-sm-1",
        senderName: "Ada Lovelace",
        senderEmail: "ada.lovelace@180dc.org",
        recipientName: "Liam Davies",
        recipientEmail: "liam.davies@mungos.org",
        sentAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
        subject: "Winter Shelter Capacity Planning & Route Analytics",
        body: `Dear Liam,\n\n180DC is preparing our spring consulting cycle and would love to support St Mungo's shelter allocations.\n\nBest,\nAda`,
        isFromClient: false,
      },
    ],
  },
  {
    id: "mock-org-crisis",
    orgName: "Crisis UK",
    orgType: "National Charity",
    city: "London",
    country: "United Kingdom",
    sector: "Charities & NGOs",
    labelColor: "#d97706",
    primaryContact: {
      name: "Samira Patel",
      role: "Policy & Impact Analyst",
      email: "samira.patel@crisis.org.uk",
    },
    camOwner: {
      name: "Ada Lovelace",
      email: "ada.lovelace@180dc.org",
    },
    status: "replied",
    replyIntent: "interested",
    subject: "Re: Pro-bono Research Support — Housing Policy Impact",
    snippet: "Hi Ada, our policy research team would welcome your support on statistical modeling for the upcoming whitepaper...",
    lastActivityAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString(),
    isRead: true,
    isStarred: false,
    isImportant: false,
    folder: "inbox",
    attachments: [],
    notesCount: 1,
    handoversCount: 0,
    messages: [
      {
        id: "msg-cr-1",
        senderName: "Samira Patel",
        senderEmail: "samira.patel@crisis.org.uk",
        recipientName: "Ada Lovelace",
        recipientEmail: "ada.lovelace@180dc.org",
        sentAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString(),
        subject: "Re: Pro-bono Research Support — Housing Policy Impact",
        body: `Hi Ada,\n\nOur policy research team would welcome your support on statistical modeling for the upcoming whitepaper.\n\nBest,\nSamira`,
        isFromClient: true,
        intent: "interested",
      },
    ],
  },
  {
    id: "mock-org-ageuk",
    orgName: "Age UK",
    orgType: "Elderly Welfare Charity",
    city: "London",
    country: "United Kingdom",
    sector: "Health & Well-being",
    labelColor: "#4f46e5",
    primaryContact: {
      name: "Arthur Pendelton",
      role: "Digital Literacy & Community Lead",
      email: "arthur.pendelton@ageuk.org.uk",
    },
    camOwner: {
      name: "Arthur Dent",
      email: "arthur.dent@180dc.org",
    },
    status: "awaiting",
    subject: "Follow-up: Digital Inclusion Training Program Proposal",
    snippet: "Sending over the team qualifications and past training workshops for Age UK regional branches...",
    lastActivityAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    isRead: true,
    isStarred: false,
    isImportant: false,
    folder: "inbox",
    attachments: [],
    notesCount: 2,
    handoversCount: 0,
    messages: [
      {
        id: "msg-age-1",
        senderName: "Arthur Dent",
        senderEmail: "arthur.dent@180dc.org",
        recipientName: "Arthur Pendelton",
        recipientEmail: "arthur.pendelton@ageuk.org.uk",
        sentAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        subject: "Follow-up: Digital Inclusion Training Program Proposal",
        body: `Hi Arthur,\n\nSending over the team qualifications and past training workshops for Age UK regional branches.\n\nBest,\nArthur`,
        isFromClient: false,
      },
    ],
  },
  {
    id: "mock-org-unicef",
    orgName: "UNICEF UK",
    orgType: "International Charity",
    city: "London",
    country: "United Kingdom",
    sector: "Youth & Education",
    labelColor: "#0284c7",
    primaryContact: {
      name: "Claire Dubois",
      role: "Head of Strategic Initiatives",
      email: "claire.dubois@unicef.org.uk",
    },
    camOwner: {
      name: "Ada Lovelace",
      email: "ada.lovelace@180dc.org",
    },
    status: "replied",
    replyIntent: "meeting_booked",
    subject: "Confirmed: UNICEF UK & 180DC Semester Kickoff Session",
    snippet: "Hi Ada, our steering group approved the proposal. Meeting set for next Wednesday at 10 AM...",
    lastActivityAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
    isRead: true,
    isStarred: true,
    isImportant: true,
    folder: "inbox",
    attachments: [],
    notesCount: 4,
    handoversCount: 1,
    messages: [
      {
        id: "msg-uni-1",
        senderName: "Claire Dubois",
        senderEmail: "claire.dubois@unicef.org.uk",
        recipientName: "Ada Lovelace",
        recipientEmail: "ada.lovelace@180dc.org",
        sentAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
        subject: "Confirmed: UNICEF UK & 180DC Semester Kickoff Session",
        body: `Hi Ada,\n\nOur steering group approved the proposal. Meeting set for next Wednesday at 10 AM.\n\nWarmly,\nClaire`,
        isFromClient: true,
        intent: "meeting_booked",
      },
    ],
  },
];

/**
 * Finds a mock thread by orgId.
 */
export function getMockThreadById(orgId: string): MockThread | undefined {
  return MOCK_INBOX_THREADS.find((t) => t.id === orgId);
}

/**
 * Returns formatted relative time similar to Gmail.
 */
export function formatGmailTimestamp(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (60 * 1000));
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (diffMins < 60) {
    return `${Math.max(1, diffMins)}m ago`;
  }
  if (diffHours < 24 && date.getDate() === now.getDate()) {
    return date.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" });
  }
  if (diffDays === 1 || (diffHours < 48 && date.getDate() === now.getDate() - 1)) {
    return "Yesterday";
  }
  if (diffDays < 7) {
    return date.toLocaleDateString("en-GB", { weekday: "short" });
  }
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * Formats file size in readable KB / MB.
 */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1000000) {
    return `${(bytes / 1000000).toFixed(1)} MB`;
  }
  return `${Math.round(bytes / 1000)} KB`;
}

/* ─── TEMPORARY: design fill for /inbox ────────────────────────────────────
 *
 * The queue page is being designed against a live database that has very few
 * real threads in it, and a three-row page cannot be judged. `mockQueueRows`
 * adapts the threads above into the REAL row type (`InboxQueueRow`) so the mock
 * never touches the shape of anything else — the queue, the row component and
 * the page all speak `InboxQueueRow`, and the mock bends to them.
 *
 * TO REMOVE: delete this block, delete the import and the merge in
 * src/app/inbox/page.tsx, and delete the `getMockThreadById` fallback in
 * src/app/inbox/[orgId]/page.tsx. Nothing else refers to it.
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Deterministic spread of ownership and follow-up state across the mock set, so
 * every scope and every bucket has something in it while the page is designed.
 * Index-based rather than random: the same row is in the same pile on every
 * render, or a screenshot means nothing.
 */
export function mockQueueRows(actorId: string, now: Date = new Date()): InboxQueueRow[] {
  const threads: InboxThread[] = MOCK_INBOX_THREADS.map((mock) => {
    // "draft" is a mailbox state, not an event; the queue only knows the three
    // states threadStatus can produce.
    const status: InboxThreadStatus =
      mock.status === "replied" ? "replied" : mock.status === "awaiting" ? "awaiting" : "sent";
    const newest = mock.messages[mock.messages.length - 1];
    return {
      orgId: mock.id,
      orgName: mock.orgName,
      href: `/inbox/${mock.id}`,
      lastActivityAt: mock.lastActivityAt,
      lastActorName: newest?.senderName ?? mock.camOwner.name,
      lastEventLabel: status === "replied" ? "Reply received" : "Email sent",
      subject: mock.subject,
      snippet: mock.snippet,
      status,
      replyIntent: mock.replyIntent ?? null,
      messageCount: mock.messages.length,
      relativeTime: formatRelativeTime(new Date(mock.lastActivityAt), now),
      isRecent: status === "replied" && isRecentReply(mock.lastActivityAt, now),
    };
  });

  // Two of every three mock clients belong to the viewer, so "Mine" — the
  // default scope — is the fullest view rather than the emptiest.
  const owners = new Map<string, string | null>(
    threads.map((thread, index) => [
      thread.orgId,
      index % 3 === 2 ? (index % 6 === 5 ? null : "mock-user-team") : actorId,
    ]),
  );

  // Every fourth quiet thread is overdue a follow-up, alternating urgency, so
  // the Follow-up due bucket is never empty on the design fill.
  const recommendations: FollowUpRecommendation[] = threads
    .filter((thread) => thread.status !== "replied")
    .filter((_, index) => index % 2 === 0)
    .map((thread, index) => ({
      organisationId: thread.orgId,
      legalName: thread.orgName,
      statusLabel: "Initial outreach sent",
      lastActivityAt: thread.lastActivityAt,
      daysWaiting: daysSince(thread.lastActivityAt, now),
      urgency: index % 2 === 0 ? "urgent" : "due",
    }));

  return buildInboxQueue(threads, owners, recommendations, actorId, now);
}
