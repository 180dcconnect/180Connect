"use client";

import { useState, type ComponentType } from "react";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import {
  Activity,
  ArrowLeftRight,
  ChevronDown,
  Copy,
  EyeOff,
  Flag,
  KeyRound,
  Mail,
  Milestone,
  ShieldAlert,
  UserCog,
  Wrench,
} from "lucide-react";

import { EASE, entranceIndexed } from "@/components/brand/motion";
import type { AuditEventView, AuditIconName, AuditTone } from "@/lib/audit-log-format";

/**
 * The audit trail as a feed rather than a table. A table forced five columns to
 * share a width they never agreed on — a wrapped uuid next to a one-word action
 * next to a JSON blob — and nothing in it could be read at a glance. Each row is
 * now a sentence, with the machine's version of it one click away.
 *
 * Everything shown here was formatted on the server (see
 * `src/lib/audit-log-format.ts`): this component owns interaction and motion
 * only, so there is no clock in it to disagree with the server's.
 */

type RowIcon = ComponentType<{ className?: string; strokeWidth?: number; "aria-hidden"?: boolean }>;

/**
 * Rows name an icon rather than importing one, the same arrangement as the
 * sidebar's rail — the vocabulary lives in one pure module and every glyph in
 * the feed is drawn on the same grid.
 */
const ICONS: Record<AuditIconName, RowIcon> = {
  role: UserCog,
  access: KeyRound,
  ownership: ArrowLeftRight,
  pipeline: Milestone,
  suppression: EyeOff,
  flag: Flag,
  quality: Wrench,
  invite: Mail,
  duplicate: Copy,
  blocked: ShieldAlert,
  generic: Activity,
};

/** Matches the sidebar rail's spring so a hovered row feels like a hovered nav item. */
const ICON_SPRING = { type: "spring", stiffness: 420, damping: 17, mass: 0.6 } as const;

/**
 * A gesture per icon, each pointing at what the row *did* — the flag lifts, the
 * ownership arrows swap ends, the blocked shield braces. All of them stay under
 * ~10% scale and ~8 degrees, the same ceiling the sidebar holds to, so a hundred
 * rows of them still read as one system rather than a toybox.
 */
const ICON_MOTION: Record<AuditIconName, Variants> = {
  role: { rest: { scale: 1, rotate: 0 }, hover: { scale: 1.08, rotate: -6 } },
  access: { rest: { scale: 1, rotate: 0 }, hover: { scale: 1.08, rotate: 8 } },
  ownership: { rest: { scale: 1, x: 0 }, hover: { scale: 1.06, x: [0, 2, -2, 0] } },
  pipeline: { rest: { scale: 1, y: 0 }, hover: { scale: 1.06, y: -2 } },
  suppression: { rest: { scale: 1, opacity: 1 }, hover: { scale: 1.08, opacity: [1, 0.45, 1] } },
  flag: { rest: { scale: 1, rotate: 0 }, hover: { scale: 1.08, rotate: -8 } },
  quality: { rest: { scale: 1, rotate: 0 }, hover: { scale: 1.06, rotate: 8 } },
  invite: { rest: { scale: 1, y: 0 }, hover: { scale: 1.08, y: -2 } },
  duplicate: { rest: { scale: 1, x: 0 }, hover: { scale: 1.06, x: 2 } },
  blocked: { rest: { scale: 1, rotate: 0 }, hover: { scale: 1.1, rotate: -6 } },
  generic: { rest: { scale: 1 }, hover: { scale: 1.08 } },
};

/**
 * Tone lands on the icon disc and nowhere else. Tinting a whole row would turn a
 * long trail into a heat map, and the system allows one accent per screen — the
 * disc is small enough to spend it on.
 */
const TONE_CLASS: Record<AuditTone, string> = {
  neutral: "bg-black/[0.05] text-foreground/55",
  positive: "bg-brand/12 text-brand-hover",
  caution: "bg-amber-500/12 text-amber-700",
};

/** The same three tones as a badge: a rim, and enough contrast to carry text. */
const BADGE_CLASS: Record<AuditTone, string> = {
  neutral: "bg-black/[0.04] text-foreground/70 ring-black/[0.08]",
  positive: "bg-brand/10 text-brand-hover ring-brand/25",
  caution: "bg-amber-500/10 text-amber-800 ring-amber-500/25",
};

export type AuditDayGroup = { key: string; label: string; events: AuditEventView[] };

export function AuditFeed({ groups }: { groups: AuditDayGroup[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();

  // The cascade is indexed across the whole feed, not restarted per day, so two
  // short days in a row don't arrive faster than one long one.
  let position = 0;

  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section key={group.key} className="space-y-3">
          <div className="flex items-baseline justify-between gap-4 px-1">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
              {group.label}
            </h2>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] tabular-nums text-foreground/25">
              {group.events.length} event{group.events.length === 1 ? "" : "s"}
            </p>
          </div>

          <ul className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm">
            {group.events.map((event) => (
              <AuditRow
                key={event.id}
                event={event}
                index={position++}
                open={expanded === event.id}
                onToggle={() => setExpanded((current) => (current === event.id ? null : event.id))}
                reduceMotion={Boolean(reduceMotion)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function AuditRow({
  event,
  index,
  open,
  onToggle,
  reduceMotion,
}: {
  event: AuditEventView;
  index: number;
  open: boolean;
  onToggle: () => void;
  reduceMotion: boolean;
}) {
  const Icon = ICONS[event.icon];
  const chips = event.details.filter((detail) => detail.kind !== "note");
  const notes = event.details.filter((detail) => detail.kind === "note");

  return (
    <motion.li
      variants={entranceIndexed()}
      custom={index}
      className="border-b border-black/[0.06] last:border-b-0"
    >
      {/* Hover is claimed by the whole row, not the glyph: a 20px icon is a poor
          target, and the gesture is meant to answer "what is this row" as the
          cursor crosses it. */}
      <motion.div initial="rest" animate="rest" whileHover="hover">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex w-full items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-black/[0.02] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand sm:gap-4 sm:px-5"
        >
          <motion.span
            aria-hidden="true"
            variants={reduceMotion ? undefined : ICON_MOTION[event.icon]}
            transition={ICON_SPRING}
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${TONE_CLASS[event.tone]}`}
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden={true} />
          </motion.span>

          <span className="min-w-0 flex-1">
            {/* On a phone the stamp rides the eyebrow instead of holding its own
                column — a fixed right column at 390px left the sentence about
                forty characters wide and broke every row onto four lines. */}
            <span className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
                {event.label}
              </span>
              <span
                className="shrink-0 whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.08em] tabular-nums text-foreground/35 sm:hidden"
                title={event.exactTime}
              >
                {event.relativeTime}
              </span>
            </span>
            <span className="mt-1 block text-[15px] font-bold leading-[1.45]">
              {event.sentence}
            </span>

            {chips.length > 0 && (
              <span className="mt-2 flex flex-wrap items-center gap-1.5">
                {chips.map((detail) => (
                  <span
                    key={`${detail.label}-${detail.value}`}
                    className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.04] px-2.5 py-1 text-[11px] font-bold tracking-[0.02em] text-foreground/70"
                  >
                    <span className="uppercase tracking-[0.08em] text-foreground/35">
                      {detail.label}
                    </span>
                    {detail.value}
                  </span>
                ))}
              </span>
            )}

            {notes.map((note) => (
              <span
                key={note.label}
                className="mt-2 block max-w-prose text-sm leading-[1.7] text-foreground/60"
              >
                <span className="font-bold text-foreground/45">{note.label}: </span>
                {note.value}
              </span>
            ))}
          </span>

          <span className="flex shrink-0 items-center gap-3 pt-0.5">
            <span
              className="hidden text-right text-[11px] font-bold uppercase tracking-[0.08em] tabular-nums text-foreground/35 sm:block"
              title={event.exactTime}
            >
              {event.relativeTime}
            </span>
            <motion.span
              aria-hidden="true"
              animate={{ rotate: open ? 180 : 0 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="text-foreground/25"
            >
              <ChevronDown className="h-4 w-4" strokeWidth={2} />
            </motion.span>
          </span>
        </button>

        {/* The machine's version of the row. Kept behind a click because reading
            a uuid is a support task, not the reason anyone opens this page. */}
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="detail"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="overflow-hidden"
            >
              {/*
               * The ids live on the element, not in it. Nobody reading an audit
               * trail wants a uuid on screen — they want to know who did what —
               * but an engineer chasing a specific row still needs the primary
               * key, and `matchesAuditQuery` still matches the action token. So
               * they ride as data attributes: one inspect away, never rendered.
               */}
              <div
                data-entry-id={event.id}
                data-action={event.action}
                data-actor-id={event.actorId ?? undefined}
                data-target-id={event.targetId ?? undefined}
                className="border-t border-black/[0.05] bg-black/[0.015] px-4 py-4 sm:px-5 sm:pl-[4.25rem]"
              >
                <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="min-w-0">
                    <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
                      Action
                    </dt>
                    <dd className="mt-1.5">
                      <ActionBadge label={event.label} tone={event.tone} icon={event.icon} />
                    </dd>
                  </div>
                  <Field label="Done by" value={event.actorName} />
                  {/* The noun is only worth using as a label when there is a
                      name to put under it. Otherwise it would head a field
                      whose value is that same noun. */}
                  <Field
                    label={event.targetNamed ? (event.targetNoun ?? "Affected") : "Affected"}
                    value={
                      event.targetNamed
                        ? (event.targetDisplay ?? "—")
                        : (capitalise(event.targetDisplay) ?? "Nothing in particular")
                    }
                  />
                  <Field label="Recorded" value={`${event.exactTime} · ${event.relativeTime}`} />
                </dl>

                {event.rawDetail.length > 0 && (
                  <div className="mt-5">
                    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
                      Recorded detail
                    </p>
                    {/* The stored object, keys untouched — but as a table rather
                        than a `JSON.stringify` dump. Braces and quotes are
                        syntax for a parser, not information for a reader; the
                        key/value pairing is the only part that carries meaning,
                        so that is the only part drawn. */}
                    <dl className="mt-2 overflow-hidden rounded-xl bg-white ring-1 ring-black/[0.06]">
                      {event.rawDetail.map((entry) => (
                        <div
                          key={entry.key}
                          className="flex flex-col gap-0.5 border-b border-black/[0.05] px-4 py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-4"
                        >
                          {/* Right-aligned so the key sits against its value
                              rather than across a column of air from it. */}
                          <dt className="shrink-0 font-mono text-[11px] text-foreground/40 sm:w-40 sm:text-right">
                            {entry.key}
                          </dt>
                          <dd className="min-w-0 font-mono text-xs leading-[1.6] break-words text-foreground/75">
                            {entry.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.li>
  );
}

/**
 * The stand-in nouns are written to close a sentence ("…cancelled the invite for
 * a deleted account"), so they start a field badly. A name is left alone — it is
 * already spelled the way its owner spells it.
 */
function capitalise(value: string | null): string | null {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/35">
        {label}
      </dt>
      <dd className="mt-1.5 truncate text-[13px] text-foreground/75" title={value}>
        {value}
      </dd>
    </div>
  );
}

/**
 * The action as a badge rather than the raw `action` column.
 *
 * It is coloured by tone — three values, not one per action. Eleven action
 * families would need eleven colours, at which point the colour stops meaning
 * anything and the page becomes a heat map; the system allows one accent per
 * screen for exactly that reason. So severity carries the colour (neutral,
 * something reversed or restored, something removed or refused) and the family
 * carries the glyph, which is the same glyph as the row's own disc.
 */
function ActionBadge({
  label,
  tone,
  icon,
}: {
  label: string;
  tone: AuditTone;
  icon: AuditIconName;
}) {
  const Icon = ICONS[icon];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold ring-1 ring-inset ${BADGE_CLASS[tone]}`}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden={true} />
      {label}
    </span>
  );
}
