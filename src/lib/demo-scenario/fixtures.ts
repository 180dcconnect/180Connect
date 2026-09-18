/**
 * The demo scenario: one hand-authored slice of a working branch, so a walk
 * through the app tells a story instead of showing eleven empty states.
 *
 * `npm run seed` already fills the client list with fifty randomised
 * organisations (src/lib/seed/fixtures.ts). This is the opposite kind of
 * fixture: a small, fixed cast where every row exists because some screen needs
 * it — an overdue action for the Actions tab's warning, a reply for the
 * notification bell, a suggested edit for the Approvals workspace, a client
 * that has been silent for three weeks for stall detection. Nothing here is
 * random, and nothing is a real organisation or a real person's contact detail.
 *
 * ## Every row is addressable, so every row is removable
 *
 * Ids are minted from one uuid namespace, `dec0de00-0000-4000-8000-…`, rather
 * than left to `gen_random_uuid()`. Two things follow, and both matter more
 * than the ids looking tidy:
 *
 *   - **Reversible.** `npm run seed:demo:clear` deletes exactly these rows,
 *     matched on the prefix. The tables this writes to are not all covered by
 *     `is_seed` (audit_log and notifications have no such column) and two of
 *     them are not reachable by cascade from `organisations`, so "delete the
 *     demo data" has to mean something more precise than "delete the seed".
 *   - **Idempotent.** Re-running the seeder writes the same ids, so it clears
 *     and re-inserts rather than stacking a second copy of the scenario on top
 *     of the first.
 *
 * ## What is deliberately NOT here
 *
 * No user rows. The cast is resolved from the accounts already on the target
 * database by email (`DEMO_CAST_EMAILS`) — auth users cannot be created with
 * raw SQL without breaking login for the whole project, and a demo that signs
 * in as an account nobody can sign in as is no demo at all.
 */

/**
 * The uuid namespace every demo row is minted into. Chosen to be recognisable
 * at a glance in a psql dump ("dec0de" — decode, and it is valid hex).
 */
export const DEMO_ID_PREFIX = "dec0de00-0000-4000-8000-";

/** SQL `like` pattern matching every id this module can mint. */
export const DEMO_ID_LIKE = `${DEMO_ID_PREFIX}%`;

/**
 * Mints a stable demo uuid from a table tag and an index, so a row's id says
 * which fixture produced it. `tag` is two hex digits, `index` four — 65,535
 * rows per table is more scenario than anyone will hand-write.
 */
export function demoId(tag: number, index: number): string {
  if (!Number.isInteger(tag) || tag < 0 || tag > 0xff) {
    throw new RangeError(`demo id tag out of range: ${tag}`);
  }
  if (!Number.isInteger(index) || index < 0 || index > 0xffff) {
    throw new RangeError(`demo id index out of range: ${index}`);
  }
  return `${DEMO_ID_PREFIX}${tag.toString(16).padStart(4, "0")}${index
    .toString(16)
    .padStart(8, "0")}`;
}

/** One tag per table, so an id tells you what it is without a join. */
const TAG = {
  organisation: 0x01,
  action: 0x02,
  outreachMessage: 0x03,
  replyEvent: 0x04,
  editSuggestion: 0x05,
  notification: 0x06,
  auditLog: 0x07,
  note: 0x08,
} as const;

/**
 * The accounts the scenario is told through. Resolved by email on the target
 * database — a missing one is a hard error in the seeder rather than a silent
 * `null` assignee, because an action with no assignee is invisible on the very
 * tab the demo is meant to show.
 */
export const DEMO_CAST_EMAILS = {
  /** The CAM the demo signs in as. Owns most of the scenario's clients. */
  cam: "bashir-cam@180dc.org",
  /** The admin the demo signs in as for the admin half. Assigns the work. */
  admin: "bashir-admin@180dc.org",
  /** A second CAM, so team-wide views have more than one column of data. */
  camTwo: "test-cam@180dc.org",
  /** A third CAM, for the "who needs support" reading on team analytics. */
  camThree: "cam1-test@180dc.org",
} as const;

export type DemoCast = Record<keyof typeof DEMO_CAST_EMAILS, string>;

export type DemoOrganisation = {
  id: string;
  legal_name: string;
  organisation_type: "charity" | "company" | "cic" | "cio" | "social_enterprise";
  entry_method: "api" | "manual";
  is_verified: boolean;
  sector: string;
  city: string;
  website: string;
  contact_email: string;
  outreach_status: DemoOutreachStatus;
  owner_key: keyof DemoCast | null;
  /** Days since the client last showed any activity — drives stall detection. */
  quiet_days: number;
};

export type DemoOutreachStatus =
  | "not_contacted"
  | "initial_outreach_sent"
  | "follow_up_sent"
  | "responded"
  | "converted"
  | "future_potential"
  | "soft_no"
  | "hard_no"
  | "no_response"
  | "loss_due_timing";

/**
 * The pipeline in full, in the order `docs/client-list-sorting.md` reads it.
 * The scenario covers every one of the ten statuses on purpose: F146–F156 are
 * ten separate stories about the same dropdown, and a demo that shows four of
 * them shows nothing about the other six.
 */
export const DEMO_PIPELINE_COVERAGE: readonly DemoOutreachStatus[] = [
  "not_contacted",
  "initial_outreach_sent",
  "follow_up_sent",
  "responded",
  "converted",
  "future_potential",
  "soft_no",
  "hard_no",
  "no_response",
  "loss_due_timing",
];

/**
 * Fourteen clients: the ten pipeline statuses once each, plus four extra
 * mid-pipeline records so the CAM's own list, the team pipeline and the stall
 * detector each have something to say.
 *
 * Names are invented. They read like UK charities because a demo audience
 * reads the name before anything else, but none of them is a real registered
 * organisation, and the addresses and mailboxes are all `@example.org`.
 */
const ORGANISATIONS: readonly Omit<DemoOrganisation, "id">[] = [
  {
    legal_name: "Riverbank Youth Trust",
    organisation_type: "charity",
    entry_method: "api",
    is_verified: true,
    sector: "Education & Young People",
    city: "Manchester",
    website: "https://riverbank-youth.example.org",
    contact_email: "partnerships@riverbank-youth.example.org",
    outreach_status: "responded",
    owner_key: "cam",
    quiet_days: 1,
  },
  {
    legal_name: "Northlight Mental Health Foundation",
    organisation_type: "charity",
    entry_method: "api",
    is_verified: true,
    sector: "Health & Well-being",
    city: "Leeds",
    website: "https://northlight.example.org",
    contact_email: "hello@northlight.example.org",
    outreach_status: "follow_up_sent",
    owner_key: "cam",
    quiet_days: 19,
  },
  {
    legal_name: "Coalfield Heritage Society",
    organisation_type: "cio",
    entry_method: "api",
    is_verified: true,
    sector: "Arts & Heritage",
    city: "Sheffield",
    website: "https://coalfield-heritage.example.org",
    contact_email: "office@coalfield-heritage.example.org",
    outreach_status: "initial_outreach_sent",
    owner_key: "cam",
    quiet_days: 9,
  },
  {
    legal_name: "Two Rivers Food Network",
    organisation_type: "charity",
    entry_method: "api",
    is_verified: true,
    sector: "Poverty & Food Security",
    city: "Nottingham",
    website: "https://tworivers-food.example.org",
    contact_email: "info@tworivers-food.example.org",
    outreach_status: "converted",
    owner_key: "cam",
    quiet_days: 3,
  },
  {
    legal_name: "Harbour Lights Sea Rescue",
    organisation_type: "charity",
    entry_method: "api",
    is_verified: true,
    sector: "Emergency & Rescue",
    city: "Plymouth",
    website: "https://harbourlights.example.org",
    contact_email: "trustees@harbourlights.example.org",
    outreach_status: "no_response",
    owner_key: "cam",
    quiet_days: 34,
  },
  {
    legal_name: "Greenway Cycling Access CIC",
    organisation_type: "cic",
    entry_method: "api",
    is_verified: true,
    sector: "Environment & Transport",
    city: "Bristol",
    website: "https://greenway-access.example.org",
    contact_email: "team@greenway-access.example.org",
    outreach_status: "future_potential",
    owner_key: "cam",
    quiet_days: 12,
  },
  {
    legal_name: "Stonebridge Refugee Welcome",
    organisation_type: "charity",
    entry_method: "api",
    is_verified: true,
    sector: "Migration & Inclusion",
    city: "Birmingham",
    website: "https://stonebridge-welcome.example.org",
    contact_email: "coordinator@stonebridge-welcome.example.org",
    outreach_status: "not_contacted",
    owner_key: "cam",
    quiet_days: 0,
  },
  {
    legal_name: "Ashfield Carers Alliance",
    organisation_type: "charity",
    entry_method: "api",
    is_verified: true,
    sector: "Health & Well-being",
    city: "Derby",
    website: "https://ashfield-carers.example.org",
    contact_email: "admin@ashfield-carers.example.org",
    outreach_status: "soft_no",
    owner_key: "camTwo",
    quiet_days: 21,
  },
  {
    legal_name: "Pennine Woodland Recovery",
    organisation_type: "charity",
    entry_method: "api",
    is_verified: true,
    sector: "Environment & Conservation",
    city: "Huddersfield",
    website: "https://pennine-woodland.example.org",
    contact_email: "grants@pennine-woodland.example.org",
    outreach_status: "hard_no",
    owner_key: "camTwo",
    quiet_days: 27,
  },
  {
    legal_name: "Clyde Digital Skills Trust",
    organisation_type: "charity",
    entry_method: "api",
    is_verified: true,
    sector: "Education & Employability",
    city: "Glasgow",
    website: "https://clyde-digital.example.org",
    contact_email: "projects@clyde-digital.example.org",
    outreach_status: "loss_due_timing",
    owner_key: "camTwo",
    quiet_days: 41,
  },
  {
    legal_name: "Fenland Water Justice",
    organisation_type: "charity",
    entry_method: "api",
    is_verified: true,
    sector: "Environment & Water",
    city: "Peterborough",
    website: "https://fenland-water.example.org",
    contact_email: "office@fenland-water.example.org",
    outreach_status: "follow_up_sent",
    owner_key: "camTwo",
    quiet_days: 23,
  },
  {
    legal_name: "Brightside Disability Sport",
    organisation_type: "social_enterprise",
    entry_method: "api",
    is_verified: true,
    sector: "Sport & Disability",
    city: "Newcastle upon Tyne",
    website: "https://brightside-sport.example.org",
    contact_email: "hello@brightside-sport.example.org",
    outreach_status: "responded",
    owner_key: "camThree",
    quiet_days: 2,
  },
  {
    legal_name: "Old Docks Community Land Trust",
    organisation_type: "cic",
    entry_method: "api",
    is_verified: true,
    sector: "Housing & Regeneration",
    city: "Liverpool",
    website: "https://olddocks-clt.example.org",
    contact_email: "board@olddocks-clt.example.org",
    outreach_status: "initial_outreach_sent",
    owner_key: "camThree",
    quiet_days: 16,
  },
  {
    /**
     * The one client stall detection can flag (F183). Three conditions have to
     * line up and every other demo client misses at least one: a trigger
     * status, real activity long enough ago to cross the 14-day threshold, and
     * **no open action** — an action already on someone's list is the CAM
     * saying "I know", so the sweep deliberately stays quiet about it. This
     * client has an email sent 24 days ago and nothing since.
     */
    legal_name: "Wearside Youth Music Trust",
    organisation_type: "charity",
    entry_method: "api",
    is_verified: true,
    sector: "Arts & Young People",
    city: "Sunderland",
    website: "https://wearside-music.example.org",
    contact_email: "office@wearside-music.example.org",
    outreach_status: "follow_up_sent",
    owner_key: "cam",
    quiet_days: 24,
  },
  {
    /**
     * Deliberately owned by a CAM the demo does not sign in as: this is the
     * client that proves F018 blocks a send rather than merely hiding the
     * button, and the one whose ownership the demo CAM has to request.
     */
    legal_name: "Marsh Lane Animal Sanctuary",
    organisation_type: "charity",
    entry_method: "api",
    is_verified: true,
    sector: "Animal Welfare",
    city: "Norwich",
    website: "https://marshlane-sanctuary.example.org",
    contact_email: "keepers@marshlane-sanctuary.example.org",
    outreach_status: "initial_outreach_sent",
    owner_key: "camThree",
    quiet_days: 6,
  },
];

/** Stable index → id, so every other fixture can point at a client by name. */
export function demoOrganisations(): DemoOrganisation[] {
  return ORGANISATIONS.map((org, index) => ({
    ...org,
    id: demoId(TAG.organisation, index),
  }));
}

/** Looks one up by legal name. Throws rather than returning undefined: a typo
 *  here would otherwise surface as a foreign-key violation with no clue in it. */
export function demoOrgId(legalName: string): string {
  const index = ORGANISATIONS.findIndex((org) => org.legal_name === legalName);
  if (index === -1) throw new Error(`no demo organisation named "${legalName}"`);
  return demoId(TAG.organisation, index);
}

export type DemoAction = {
  id: string;
  organisation_id: string;
  assignee_key: keyof DemoCast;
  created_by_key: keyof DemoCast;
  title: string;
  description: string | null;
  /** Days from "now". Negative is overdue; null is an action with no date. */
  due_in_days: number | null;
  status: "open" | "completed";
  /** Days from "now" the action was created. Always negative. */
  created_days_ago: number;
};

/**
 * The CAM workflow story, F168 → F169 → F170 → F172 → F171, in one list.
 *
 * The shape matters more than the wording:
 *   - two overdue (F172 needs a warning to show, and the dashboard's Needs
 *     Attention panel needs a badge to render),
 *   - two due inside the week (F170 — a date that is not yet a problem),
 *   - one with no due date at all (F170's optional case; it must not sort as
 *     though it were overdue),
 *   - two already completed (F171 — the tab's completed view is otherwise an
 *     empty state, and "mark complete" has nowhere to land),
 *   - one assigned to a different CAM, so the admin's team-wide view at
 *     /admin/actions has a second person in it.
 */
type DemoActionSeed = Omit<DemoAction, "id" | "organisation_id"> & {
  org: string;
};

const ACTION_SEEDS: readonly DemoActionSeed[] = [
  {
    org: "Northlight Mental Health Foundation",
    assignee_key: "cam",
    created_by_key: "admin",
    title: "Send the follow-up deck before their trustee meeting",
    description:
      "They asked for the impact-measurement section as a standalone. Trustee meeting is the 12th, so it needs to land before then.",
    due_in_days: -6,
    status: "open",
    created_days_ago: 20,
  },
  {
    org: "Harbour Lights Sea Rescue",
    assignee_key: "cam",
    created_by_key: "admin",
    title: "Close out Harbour Lights or move it to No Response",
    description:
      "Two emails, no reply in five weeks. Either find a warm route in or let the status say what is actually true.",
    due_in_days: -2,
    status: "open",
    created_days_ago: 14,
  },
  {
    org: "Riverbank Youth Trust",
    assignee_key: "cam",
    created_by_key: "admin",
    title: "Scope the donor-retention project with Riverbank",
    description:
      "They are in. Agree the six-week shape and who from the branch staffs it, then send the scoping note.",
    due_in_days: 2,
    status: "open",
    created_days_ago: 4,
  },
  {
    org: "Coalfield Heritage Society",
    assignee_key: "cam",
    created_by_key: "admin",
    title: "Chase Coalfield Heritage on the initial outreach",
    description: "Nine days since the first email. One short follow-up, not a resend.",
    due_in_days: 5,
    status: "open",
    created_days_ago: 9,
  },
  {
    org: "Greenway Cycling Access CIC",
    assignee_key: "cam",
    created_by_key: "admin",
    title: "Diarise Greenway for the next intake",
    description:
      "Right fit, wrong term — they have no capacity until the new year. No date on this one; it is a standing reminder, not a deadline.",
    due_in_days: null,
    status: "open",
    created_days_ago: 11,
  },
  {
    org: "Two Rivers Food Network",
    assignee_key: "cam",
    created_by_key: "admin",
    title: "Confirm the signed engagement letter is filed",
    description: null,
    due_in_days: -1,
    status: "completed",
    created_days_ago: 8,
  },
  {
    org: "Stonebridge Refugee Welcome",
    assignee_key: "cam",
    created_by_key: "admin",
    title: "Check Stonebridge against the contact criteria before any outreach",
    description: "Newly imported. Verify the mailbox is a real partnerships address first.",
    due_in_days: -3,
    status: "completed",
    created_days_ago: 10,
  },
  {
    org: "Fenland Water Justice",
    assignee_key: "camTwo",
    created_by_key: "admin",
    title: "Fenland has gone quiet — decide the next move",
    description: "Three weeks since the follow-up. Worth one more attempt before closing.",
    due_in_days: -4,
    status: "open",
    created_days_ago: 23,
  },
  {
    org: "Old Docks Community Land Trust",
    assignee_key: "camThree",
    created_by_key: "admin",
    title: "Send Old Docks the capability deck",
    description: null,
    due_in_days: 3,
    status: "open",
    created_days_ago: 5,
  },
];

export function demoActions(): DemoAction[] {
  return ACTION_SEEDS.map((seed, index) => {
    const { org, ...rest } = seed;
    return {
      ...rest,
      id: demoId(TAG.action, index),
      organisation_id: demoOrgId(org),
    };
  });
}

export type DemoOutreachMessage = {
  id: string;
  organisation_id: string;
  sent_by_key: keyof DemoCast;
  subject: string;
  body: string;
  send_status: "sent" | "scheduled" | "draft" | "failed";
  /** Days before "now" the message was sent. Positive; null when unsent. */
  sent_days_ago: number | null;
  /** Days after "now" a scheduled send is due. Positive; null otherwise. */
  scheduled_in_days: number | null;
  sent_to_email: string | null;
};

const MESSAGE_SEEDS: readonly (Omit<
  DemoOutreachMessage,
  "id" | "organisation_id"
> & { org: string })[] = [
  {
    org: "Riverbank Youth Trust",
    sent_by_key: "cam",
    subject: "180 Degrees Consulting — pro-bono support for Riverbank Youth Trust",
    body: "Dear Riverbank team,\n\nWe are the Manchester branch of 180 Degrees Consulting, the world's largest student-led consultancy for social enterprises and charities. We work in six-week engagements at no cost to the organisation.\n\nLooking at your published accounts, donor retention is where a short piece of analysis would go furthest. Would a 20-minute call be useful?\n\nBest wishes,\nBashir",
    send_status: "sent",
    sent_days_ago: 9,
    scheduled_in_days: null,
    sent_to_email: "partnerships@riverbank-youth.example.org",
  },
  {
    org: "Northlight Mental Health Foundation",
    sent_by_key: "cam",
    subject: "180 Degrees Consulting — free strategy support for Northlight",
    body: "Dear Northlight team,\n\nFollowing up on my note a fortnight ago. We have capacity for one more partner this term and Northlight is top of our list.\n\nHappy to send a two-page scope rather than take a meeting, if that is easier.\n\nBest wishes,\nBashir",
    send_status: "sent",
    sent_days_ago: 19,
    scheduled_in_days: null,
    sent_to_email: "hello@northlight.example.org",
  },
  {
    org: "Coalfield Heritage Society",
    sent_by_key: "cam",
    subject: "Pro-bono consulting support for Coalfield Heritage Society",
    body: "Dear Coalfield Heritage Society,\n\n180 Degrees Consulting places teams of five students with charities for six-week projects, free of charge. Visitor-income diversification is the kind of question we take on most often.\n\nWould you be open to a short call?\n\nBest wishes,\nBashir",
    send_status: "sent",
    sent_days_ago: 9,
    scheduled_in_days: null,
    sent_to_email: "office@coalfield-heritage.example.org",
  },
  {
    org: "Harbour Lights Sea Rescue",
    sent_by_key: "cam",
    subject: "180 Degrees Consulting — volunteer retention support",
    body: "Dear Harbour Lights,\n\nA second note, briefly. If the timing is wrong, a one-line reply saying so is genuinely useful to us and I will stop emailing.\n\nBest wishes,\nBashir",
    send_status: "sent",
    sent_days_ago: 34,
    scheduled_in_days: null,
    sent_to_email: "trustees@harbourlights.example.org",
  },
  {
    org: "Two Rivers Food Network",
    sent_by_key: "cam",
    subject: "Confirmed — 180DC scoping call, Thursday 10:00",
    body: "Thanks for confirming. Sending the engagement letter across today; the team starts the week after.\n\nBest wishes,\nBashir",
    send_status: "sent",
    sent_days_ago: 3,
    scheduled_in_days: null,
    sent_to_email: "info@tworivers-food.example.org",
  },
  {
    org: "Brightside Disability Sport",
    sent_by_key: "camThree",
    subject: "180 Degrees Consulting — participation growth support",
    body: "Dear Brightside,\n\nWe place student consulting teams with organisations like yours for six weeks at no cost. Participation growth outside term time looks like the question worth asking.\n\nBest wishes,\nAmira",
    send_status: "sent",
    sent_days_ago: 5,
    scheduled_in_days: null,
    sent_to_email: "hello@brightside-sport.example.org",
  },
  {
    org: "Fenland Water Justice",
    sent_by_key: "camTwo",
    subject: "Following up — 180DC support for Fenland Water Justice",
    body: "Dear Fenland team,\n\nChecking this reached the right inbox. Happy to be pointed elsewhere.\n\nBest wishes,\nSam",
    send_status: "sent",
    sent_days_ago: 23,
    scheduled_in_days: null,
    sent_to_email: "office@fenland-water.example.org",
  },
  {
    org: "Wearside Youth Music Trust",
    sent_by_key: "cam",
    subject: "Following up — 180DC support for Wearside Youth Music Trust",
    body: "Dear Wearside team,\n\nA short follow-up to my note earlier in the month. If audience growth is not the right question for you this year, I would still value knowing what is.\n\nBest wishes,\nBashir",
    send_status: "sent",
    sent_days_ago: 24,
    scheduled_in_days: null,
    sent_to_email: "office@wearside-music.example.org",
  },
  {
    org: "Coalfield Heritage Society",
    sent_by_key: "cam",
    subject: "One more thought on visitor income",
    body: "Queued for Monday morning rather than sent now — a Friday-afternoon follow-up reads as pressure.\n\nBest wishes,\nBashir",
    send_status: "scheduled",
    sent_days_ago: null,
    scheduled_in_days: 3,
    sent_to_email: null,
  },
];

export function demoOutreachMessages(): DemoOutreachMessage[] {
  return MESSAGE_SEEDS.map((seed, index) => {
    const { org, ...rest } = seed;
    return {
      ...rest,
      id: demoId(TAG.outreachMessage, index),
      organisation_id: demoOrgId(org),
    };
  });
}

export type DemoReplyEvent = {
  id: string;
  /** Index into demoOutreachMessages() — the message this is a reply to. */
  outreach_message_index: number;
  organisation_id: string;
  reply_body: string;
  sentiment: "positive" | "neutral" | "negative";
  intent: "interested" | "not_interested" | "more_info" | "referral";
  received_days_ago: number;
  /** Turnaround, for the response-time reading (F139). */
  response_time_seconds: number;
};

const HOUR = 3600;

const REPLY_SEEDS: readonly (Omit<DemoReplyEvent, "id" | "organisation_id"> & {
  org: string;
})[] = [
  {
    org: "Riverbank Youth Trust",
    outreach_message_index: 0,
    reply_body:
      "Hi Bashir,\n\nWe took this to the senior team and there is real appetite. Donor retention is exactly where we are weakest — we lose roughly a third of regular givers inside eighteen months and we have never had the capacity to work out why.\n\nCould you send a short scope? If it looks right we would want to start this term.\n\nBest,\nPriya Raman\nHead of Fundraising",
    sentiment: "positive",
    intent: "interested",
    received_days_ago: 1,
    response_time_seconds: 8 * 24 * HOUR,
  },
  {
    org: "Two Rivers Food Network",
    outreach_message_index: 4,
    reply_body:
      "Signed letter attached. Delighted to be working with you — the team here are looking forward to meeting the students.\n\nGareth Whitmore\nOperations Director",
    sentiment: "positive",
    intent: "interested",
    received_days_ago: 2,
    response_time_seconds: 20 * HOUR,
  },
  {
    org: "Brightside Disability Sport",
    outreach_message_index: 5,
    reply_body:
      "Thanks for getting in touch. Before we commit to anything — what does the six weeks actually ask of us in staff time? We are a team of four and cannot lose a day a week to it.\n\nDeclan Moss",
    sentiment: "neutral",
    intent: "more_info",
    received_days_ago: 2,
    response_time_seconds: 60 * HOUR,
  },
  {
    org: "Ashfield Carers Alliance",
    outreach_message_index: 6,
    reply_body:
      "Not for us this year I am afraid — we are mid-way through a restructure and could not give it the attention it deserves. Do come back to us in the spring.\n\nWith thanks,\nHelen Ackroyd",
    sentiment: "negative",
    intent: "not_interested",
    received_days_ago: 21,
    response_time_seconds: 30 * HOUR,
  },
];

export function demoReplyEvents(): DemoReplyEvent[] {
  return REPLY_SEEDS.map((seed, index) => {
    const { org, ...rest } = seed;
    return {
      ...rest,
      id: demoId(TAG.replyEvent, index),
      organisation_id: demoOrgId(org),
    };
  });
}

export type DemoEditSuggestion = {
  id: string;
  organisation_id: string;
  field_name: string;
  current_value: string | null;
  proposed_value: string;
  requested_by_key: keyof DemoCast;
  reason: string;
  created_days_ago: number;
};

const SUGGESTION_SEEDS: readonly (Omit<
  DemoEditSuggestion,
  "id" | "organisation_id"
> & { org: string })[] = [
  {
    org: "Northlight Mental Health Foundation",
    field_name: "contact_email",
    current_value: "hello@northlight.example.org",
    proposed_value: "partnerships@northlight.example.org",
    requested_by_key: "cam",
    reason:
      "The general mailbox bounced with 'no longer monitored'. Their site lists partnerships@ for exactly this.",
    created_days_ago: 3,
  },
  {
    org: "Coalfield Heritage Society",
    field_name: "legal_name",
    current_value: "Coalfield Heritage Society",
    proposed_value: "Coalfield Heritage Society CIO",
    requested_by_key: "cam",
    reason: "Charity Commission register shows the CIO suffix as part of the registered name.",
    created_days_ago: 2,
  },
  {
    org: "Greenway Cycling Access CIC",
    field_name: "city",
    current_value: "Bristol",
    proposed_value: "Bath",
    requested_by_key: "camTwo",
    reason: "Registered office moved in June — the filed accounts give the Bath address.",
    created_days_ago: 5,
  },
  {
    org: "Harbour Lights Sea Rescue",
    field_name: "website",
    current_value: "https://harbourlights.example.org",
    proposed_value: "https://harbourlights-rescue.example.org",
    requested_by_key: "camThree",
    reason: "Old domain now redirects to a parked page. New one is linked from their register entry.",
    created_days_ago: 1,
  },
];

export function demoEditSuggestions(): DemoEditSuggestion[] {
  return SUGGESTION_SEEDS.map((seed, index) => {
    const { org, ...rest } = seed;
    return {
      ...rest,
      id: demoId(TAG.editSuggestion, index),
      organisation_id: demoOrgId(org),
    };
  });
}

export type DemoNotification = {
  id: string;
  recipient_key: keyof DemoCast;
  actor_key: keyof DemoCast | null;
  notification_type: string;
  title: string;
  body: string | null;
  link_path: string;
  /** Hours before "now". Fine-grained so the bell's ordering is legible. */
  received_hours_ago: number;
  read: boolean;
};

type DemoNotificationSeed = Omit<DemoNotification, "id" | "link_path"> & {
  /** Client the notification points at; the link is built from its id. */
  org: string | null;
  /** Path used when `org` is null. */
  path?: string;
};

/**
 * The bell's contents, covering F133 (a reply arrived), F174 (that reply
 * notification is the high-priority kind) and F175 (a reminder fired because an
 * action is coming due, or has come and gone).
 *
 * Two are left unread on purpose — an unread count is the only part of a
 * notification system anyone looks at first.
 */
const NOTIFICATION_SEEDS: readonly DemoNotificationSeed[] = [
  {
    org: "Riverbank Youth Trust",
    recipient_key: "cam",
    actor_key: null,
    notification_type: "reply_received",
    title: "Riverbank Youth Trust replied",
    body: "“We took this to the senior team and there is real appetite…”",
    received_hours_ago: 21,
    read: false,
  },
  {
    org: "Brightside Disability Sport",
    recipient_key: "camThree",
    actor_key: null,
    notification_type: "reply_received",
    title: "Brightside Disability Sport replied",
    body: "“What does the six weeks actually ask of us in staff time?”",
    received_hours_ago: 44,
    read: false,
  },
  {
    org: "Northlight Mental Health Foundation",
    recipient_key: "cam",
    actor_key: null,
    notification_type: "action_reminder",
    title: "Overdue: send the follow-up deck before their trustee meeting",
    body: "Due 6 days ago · Northlight Mental Health Foundation",
    received_hours_ago: 9,
    read: false,
  },
  {
    org: "Harbour Lights Sea Rescue",
    recipient_key: "cam",
    actor_key: null,
    notification_type: "action_reminder",
    title: "Overdue: close out Harbour Lights or move it to No Response",
    body: "Due 2 days ago · Harbour Lights Sea Rescue",
    received_hours_ago: 9,
    read: false,
  },
  {
    org: "Riverbank Youth Trust",
    recipient_key: "cam",
    actor_key: "admin",
    notification_type: "action_assigned",
    title: "Bashir Admin (test) assigned you an action",
    body: "Scope the donor-retention project with Riverbank · due in 2 days",
    received_hours_ago: 96,
    read: true,
  },
  {
    org: "Two Rivers Food Network",
    recipient_key: "cam",
    actor_key: null,
    notification_type: "reply_received",
    title: "Two Rivers Food Network replied",
    body: "“Signed letter attached. Delighted to be working with you…”",
    received_hours_ago: 52,
    read: true,
  },
  {
    org: null,
    path: "/admin/approvals",
    recipient_key: "admin",
    actor_key: "cam",
    notification_type: "edit_suggestion_pending",
    title: "4 suggested client edits are waiting on a decision",
    body: "Oldest was proposed 5 days ago.",
    received_hours_ago: 6,
    read: false,
  },
];

export function demoNotifications(): DemoNotification[] {
  return NOTIFICATION_SEEDS.map((seed, index) => {
    const { org, path, ...rest } = seed;
    return {
      ...rest,
      id: demoId(TAG.notification, index),
      link_path: org ? `/clients/${demoOrgId(org)}` : (path ?? "/dashboard"),
    };
  });
}

export type DemoAuditEntry = {
  id: string;
  organisation_id: string;
  actor_key: keyof DemoCast | null;
  action: string;
  detail: Record<string, unknown>;
  created_days_ago: number;
};

type DemoAuditSeed = Omit<DemoAuditEntry, "id" | "organisation_id"> & {
  org: string;
};

/**
 * The trail behind F186 (Change history) and the audited half of F156/F157 —
 * a status that moved, ownership that changed hands, a suggested edit applied
 * and one declined, and the two discrepancy resolutions that only ever appear
 * on the admin's view.
 *
 * These are written directly rather than produced by the RPCs that normally
 * write them, because the point is to have a history *already there* when the
 * demo opens the tab. Everything the demo then does live goes through the real
 * audited path.
 */
const AUDIT_SEEDS: readonly DemoAuditSeed[] = [
  {
    org: "Riverbank Youth Trust",
    actor_key: null,
    action: "status_changed",
    detail: { from: "follow_up_sent", to: "responded", trigger: "reply_detected" },
    created_days_ago: 1,
  },
  {
    org: "Riverbank Youth Trust",
    actor_key: "cam",
    action: "status_changed",
    detail: { from: "initial_outreach_sent", to: "follow_up_sent" },
    created_days_ago: 6,
  },
  {
    org: "Riverbank Youth Trust",
    actor_key: "admin",
    action: "ownership_reassigned",
    detail: {
      from: null,
      to: null,
      reason: "Manchester branch intake — Riverbank sits in this CAM's geography preference.",
    },
    created_days_ago: 12,
  },
  {
    org: "Northlight Mental Health Foundation",
    actor_key: "admin",
    action: "edit_suggestion_approved",
    detail: {
      field: "sector",
      from: "Health",
      to: "Health & Well-being",
      reason: "Matches the register's own wording.",
    },
    created_days_ago: 8,
  },
  {
    org: "Northlight Mental Health Foundation",
    actor_key: "admin",
    action: "edit_suggestion_rejected",
    detail: {
      field: "legal_name",
      from: "Northlight Mental Health Foundation",
      to: "Northlight Foundation",
      reason: "The shortened name is the trading name, not the registered one. Keep both fields honest.",
    },
    created_days_ago: 7,
  },
  {
    org: "Northlight Mental Health Foundation",
    actor_key: null,
    action: "field_discrepancy_auto_resolved",
    detail: {
      field_name: "city",
      choice: "charity_commission",
      value: "Leeds",
      sources: { charity_commission: "Leeds", companies_house: "Leeds City" },
    },
    created_days_ago: 15,
  },
  {
    org: "Two Rivers Food Network",
    actor_key: "admin",
    action: "field_discrepancy_resolved",
    detail: {
      field_name: "contact_email",
      choice: "manual",
      value: "info@tworivers-food.example.org",
      note: "Checked against their website contact page; the imported address was a personal mailbox.",
    },
    created_days_ago: 5,
  },
  {
    org: "Two Rivers Food Network",
    actor_key: "cam",
    action: "status_changed",
    detail: { from: "responded", to: "converted" },
    created_days_ago: 3,
  },
  {
    org: "Marsh Lane Animal Sanctuary",
    actor_key: "admin",
    action: "ownership_reassigned",
    detail: {
      from: null,
      to: null,
      reason: "Rebalancing after the September intake.",
    },
    created_days_ago: 6,
  },
];

export function demoAuditEntries(): DemoAuditEntry[] {
  return AUDIT_SEEDS.map((seed, index) => {
    const { org, ...rest } = seed;
    return {
      ...rest,
      id: demoId(TAG.auditLog, index),
      organisation_id: demoOrgId(org),
    };
  });
}

export type DemoNote = {
  id: string;
  organisation_id: string;
  author_key: keyof DemoCast;
  content: string;
  created_days_ago: number;
};

const NOTE_SEEDS: readonly (Omit<DemoNote, "id" | "organisation_id"> & {
  org: string;
})[] = [
  {
    org: "Riverbank Youth Trust",
    author_key: "cam",
    content:
      "From their reply: roughly a third of regular givers lapse inside eighteen months and nobody has diagnosed why. That is the project. Ask for two years of Direct Debit data at the scoping call.",
    created_days_ago: 1,
  },
  {
    org: "Brightside Disability Sport",
    author_key: "camThree",
    content:
      "Wants the staff-time cost before anything else. Send the one-pager that spells out the four touchpoints — they are a team of four and that is the real objection.",
    created_days_ago: 2,
  },
  {
    org: "Ashfield Carers Alliance",
    author_key: "camTwo",
    content: "Soft no, and a genuine one — asked us to come back in the spring. Diarised.",
    created_days_ago: 21,
  },
];

export function demoNotes(): DemoNote[] {
  return NOTE_SEEDS.map((seed, index) => {
    const { org, ...rest } = seed;
    return {
      ...rest,
      id: demoId(TAG.note, index),
      organisation_id: demoOrgId(org),
    };
  });
}

/** Every table the scenario writes to, in the order a delete must run. */
export const DEMO_TABLES_IN_DELETE_ORDER = [
  "notifications",
  "audit_log",
  "reply_events",
  "outreach_messages",
  "edit_suggestions",
  "actions",
  "notes",
  "organisations",
] as const;
