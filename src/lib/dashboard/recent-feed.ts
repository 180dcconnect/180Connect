/**
 * The dashboard's one "Recent updates" feed: what changed on clients (notes,
 * emails, replies, pipeline and ownership moves — @/lib/recent-updates.ts) and
 * what the team did around them (suppressions, flags, duplicates, people
 * joining — @/lib/team-activity.ts), merged into a single newest-first list.
 *
 * The two used to be separate cards, and both read pipeline status changes and
 * ownership moves from the audit log — so the same move appeared twice, once in
 * each card. Both sources carry the audit row's id (recent updates prefix it
 * with `status-` / `ownership-`), so a team-activity row whose audit id the
 * recent updates already hold is dropped here rather than shown again.
 *
 * Pure and dependency-free so `node --test` can exercise it.
 */
import type {
  ActorPreview,
  FormattedRecentUpdate,
  OrganisationPreview,
} from "../recent-updates.ts";
import type { FormattedTeamActivity } from "../team-activity.ts";

export type DashboardFeedItem = {
  id: string;
  timestamp: string;
  relativeTime: string;
  /** Short plain-English kind of event, shown as a chip. */
  eventLabel: string;
  /**
   * Where the row's "View" button goes. Null when the event has nothing to
   * open, in which case the row shows no button at all.
   */
  href: string | null;
  /** The sentence's subject — usually the person, the client for a reply. */
  subjectName: string | null;
  /** Hover card for the subject when it is a person. */
  subjectPreview?: ActorPreview;
  /** Everything after the subject. */
  phrase: string;
  /** The client named at the end of the sentence, when there is one. */
  clientName: string | null;
  clientPreview?: OrganisationPreview;
  /** A second line of detail, when the event has one. */
  summary: string | null;
};

function fromRecentUpdate(update: FormattedRecentUpdate): DashboardFeedItem {
  const subjectIsActor = update.subjectName === update.actorName;
  return {
    id: update.id,
    timestamp: update.timestamp,
    relativeTime: update.relativeTime,
    eventLabel: update.eventLabel,
    href: update.href,
    subjectName: update.subjectName,
    subjectPreview: subjectIsActor ? update.actorPreview : undefined,
    phrase: update.actionPhrase,
    clientName: update.mentionsClient ? update.orgName : null,
    clientPreview: update.mentionsClient ? update.orgPreview : undefined,
    summary: update.summary || null,
  };
}

function fromTeamActivity(activity: FormattedTeamActivity): DashboardFeedItem {
  // Team sentences are already whole ("Ada approved suppression of X"). Split
  // the actor off the front so the name can carry its hover card.
  const leadsWithActor = activity.sentence.startsWith(activity.actorName);
  return {
    id: activity.id,
    timestamp: activity.createdAt,
    relativeTime: activity.relativeTime,
    eventLabel: activity.actionLabel,
    href: activity.actionButton?.href ?? activity.targetHref,
    subjectName: leadsWithActor ? activity.actorName : null,
    subjectPreview: leadsWithActor ? activity.actorPreview : undefined,
    phrase: leadsWithActor
      ? activity.sentence.slice(activity.actorName.length).trim()
      : activity.sentence,
    clientName: null,
    clientPreview: undefined,
    summary: null,
  };
}

/** Merges both sources newest first, dropping team rows the updates already show. */
export function mergeDashboardFeed(
  updates: readonly FormattedRecentUpdate[],
  teamActivities: readonly FormattedTeamActivity[],
): DashboardFeedItem[] {
  const updateIds = new Set(updates.map((update) => update.id));
  const alreadyShown = (auditId: string) =>
    updateIds.has(`status-${auditId}`) || updateIds.has(`ownership-${auditId}`);

  return [
    ...updates.map(fromRecentUpdate),
    ...teamActivities.filter((activity) => !alreadyShown(activity.id)).map(fromTeamActivity),
  ].sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
}
