/**
 * Every notification 180Connect actually sends, in the words of the job.
 *
 * `notification_type` is an open text token (20260822090000_create_notifications.sql),
 * so nothing in the database lists them — they are whatever producers pass to
 * create_notification. This is that list, so the settings page can tell someone
 * what they will hear about without showing them a token. Only real producers
 * belong here; when you add one, add its entry.
 *
 * Producers, for checking this against:
 *   client_reply_received / unowned_client_reply_received — 20260912170300_notify_on_gmail_reply.sql
 *   follow_up_due              — src/lib/outreach/reminder-sweep.ts
 *   outreach_send_failed       — src/lib/outreach/scheduled-worker.ts
 *   client_ownership_changed   — 20261004090000_notify_former_owner_on_reassignment.sql
 *   edit_suggestion_decided    — 20260923114000_extend_field_sources_and_manual_provenance.sql
 *   team_activity_digest       — src/lib/team-activity-sweep.ts
 */

export type NotificationAudience = "everyone" | "client-editors" | "admins";

export type NotificationKind = {
  type: string;
  label: string;
  description: string;
  /** Who can receive it — drives which rows a role is shown. */
  audience: NotificationAudience;
  /** Whether an email is actually wired for it (not just storable). */
  emailable: boolean;
};

export const NOTIFICATION_CATALOGUE: readonly NotificationKind[] = [
  {
    type: "client_reply_received",
    label: "A client replies",
    description: "A client you own replies to an outreach email.",
    audience: "client-editors",
    emailable: true,
  },
  {
    type: "unowned_client_reply_received",
    label: "A client with no owner replies",
    description: "Sent to admins so someone picks the reply up.",
    audience: "admins",
    emailable: false,
  },
  {
    type: "follow_up_due",
    label: "A follow-up is due",
    description: "A client you own has gone quiet long enough that it is time to chase.",
    audience: "client-editors",
    emailable: true,
  },
  {
    type: "outreach_send_failed",
    label: "A scheduled email couldn't be sent",
    description: "An email you scheduled failed to go out, with the reason why.",
    audience: "client-editors",
    emailable: true,
  },
  {
    type: "client_ownership_changed",
    label: "A client is moved away from you",
    description: "An admin reassigns a client you owned to someone else.",
    audience: "client-editors",
    emailable: false,
  },
  {
    type: "edit_suggestion_decided",
    label: "Your suggested edit is decided",
    description: "An admin approves or declines a correction you suggested to a client record.",
    audience: "client-editors",
    emailable: false,
  },
  {
    type: "team_activity_digest",
    label: "Team activity digest",
    description: "A summary of what the team has been doing on clients you follow.",
    audience: "everyone",
    emailable: false,
  },
];

/** The notifications someone with these abilities can receive. */
export function notificationsForAbilities(abilities: {
  canEditClients: boolean;
  isAdmin: boolean;
}): NotificationKind[] {
  return NOTIFICATION_CATALOGUE.filter((kind) => {
    if (kind.audience === "everyone") return true;
    if (kind.audience === "admins") return abilities.isAdmin;
    return abilities.canEditClients;
  });
}
