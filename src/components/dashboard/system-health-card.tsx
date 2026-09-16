import Image from "next/image";
import type { ReactNode } from "react";

import { Pill } from "@/app/(app)/clients/[id]/section-card";
import {
  PROVIDER_STATUS_LINKS,
  type HealthTone,
  type SystemHealthSummary,
} from "@/lib/dashboard/system-health";

/**
 * Admin and leadership only. Four short lists — AI and scoring, connected
 * services, scheduled jobs, and provider status — each row a mark, a name and
 * when it last proved itself. The card stays calm when everything is fine and
 * lists what needs a person at the top when something is not; it is not a
 * monitoring console.
 *
 * Provider status is links, never readings: the makers' own pages keep working
 * when this app or its database does not, and a link needs no maintenance. It
 * is read-only, so viewers see it like every other row on this card.
 *
 * Decided by `src/lib/dashboard/system-health.ts`; this only draws it.
 */

const DOT: Record<HealthTone, string> = {
  ok: "bg-go",
  attention: "bg-stop",
  idle: "bg-faint",
};

/** Read out ahead of the note, so the dot's colour is never the only signal. */
const STATE_WORD: Record<HealthTone, string> = {
  ok: "Working",
  attention: "Needs attention",
  idle: "Not active",
};

/** One status line. Shared with the Data health card's import list. */
export function HealthLine({
  label,
  tone,
  note,
  icon,
}: {
  label: ReactNode;
  tone: HealthTone;
  note: ReactNode;
  /**
   * The service's own mark, where it has one. Sits in the left column the dot
   * used to occupy; the dot itself moves to the right, beside the words that
   * explain it, so a row with a logo and a row without still read the same.
   */
  icon?: ReactNode;
}) {
  return (
    <li className="flex items-center gap-2.5 py-1.5">
      {icon && (
        <span aria-hidden="true" className="flex w-8 shrink-0 items-center justify-center">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 font-body text-[13.5px] text-ink">{label}</span>
      <span className="flex shrink-0 items-center gap-1.5">
        <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${DOT[tone]}`} />
        <span
          className={`text-right font-body text-[12.5px] leading-[1.45] ${
            tone === "attention" ? "font-semibold text-stop" : "text-dim"
          }`}
        >
          <span className="sr-only">{STATE_WORD[tone]}: </span>
          {note}
        </span>
      </span>
    </li>
  );
}

/**
 * The wordmark each connected service is recognised by, keyed by the row key
 * `system-health.ts` gives it. Logo shapes and colours are the makers' own — the
 * same exemption as the register marks in `public/sources/` — so they live here
 * as images, never as tokens, and they never carry state: the dot does that.
 *
 * Sized per mark rather than to one box, because the four files are not alike.
 * The envelope is wide where the others are square, and the two register files
 * are logos inside a logo: their crest sits on a square canvas with a broad
 * transparent margin around it — the ink is only ~57% of the file's height and
 * ~52% (Charity Commission) to ~84% (Companies House) of its width. Rendered at
 * the mark size like the two SVGs, they came out at two-thirds the weight of
 * Gmail's and the crest was unreadable, so they are rendered larger — 32px, to
 * land their *ink* at about 18px, a shade bigger than the mark beside it, which
 * is what a crest over a wordmark needs before it reads as anything at all.
 */
const SERVICE_LOGOS: Readonly<
  Record<string, { src: string; width: number; height: number; className: string }>
> = {
  gmail: { src: "/gmail.svg", width: 21, height: 16, className: "h-4 w-auto" },
  gemini: { src: "/models/gemini.svg", width: 16, height: 16, className: "size-4" },
  "companies-house": {
    src: "/sources/companies-house.png",
    width: 32,
    height: 32,
    className: "h-8 w-auto",
  },
  "charity-commission": {
    src: "/sources/charity-commission.png",
    width: 32,
    height: 32,
    className: "h-8 w-auto",
  },
};

function serviceLogo(key: string): ReactNode {
  const logo = SERVICE_LOGOS[key];
  if (!logo) return undefined;
  // `sizes` is the row's mark slot, not the file: a candidate picked for a
  // smaller box would go soft on the register marks.
  // Decorative: the row's own label already names the service.
  return (
    <Image
      src={logo.src}
      alt=""
      width={logo.width}
      height={logo.height}
      sizes="32px"
      loading="lazy"
      className={`max-w-none object-contain ${logo.className}`}
    />
  );
}

/**
 * Marks and buttons for the provider-status links. Same exemption as
 * SERVICE_LOGOS above: logo shapes and brand colours are the makers' own, so
 * they live here as images and tokens and never carry state — the buttons are
 * always white on the maker's colour and never raise attention.
 *
 * All three marks are simple geometric shapes that fill their canvas, so one
 * size fits all — unlike the register crests, nothing here needs per-mark
 * sizing. Button classes are full static strings so Tailwind can see them.
 */
const PROVIDER_STYLE: Readonly<
  Record<string, { src: string; width: number; height: number; button: string }>
> = {
  supabase: {
    src: "/providers/supabase.png",
    width: 128,
    height: 128,
    button: "bg-provider-supabase",
  },
  vercel: {
    src: "/providers/vercel.png",
    width: 76,
    height: 68,
    button: "bg-provider-vercel",
  },
  "google-workspace": {
    src: "/providers/google-workspace.png",
    width: 126,
    height: 128,
    button: "bg-provider-google",
  },
};

function providerLogo(key: string): ReactNode {
  const logo = PROVIDER_STYLE[key];
  if (!logo) return undefined;
  // Decorative: the row's own label already names the provider.
  return (
    <Image
      src={logo.src}
      alt=""
      width={logo.width}
      height={logo.height}
      sizes="16px"
      loading="lazy"
      className="max-w-none object-contain size-4"
    />
  );
}

export function SystemHealthCard({ summary }: { summary: SystemHealthSummary }) {
  const count = summary.attention.length;

  return (
    <section
      aria-labelledby="system-health-heading"
      className="h-full rounded-panel border border-rule bg-white"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 pt-4 pb-3">
        <h2
          id="system-health-heading"
          className="font-body text-[18px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink"
        >
          System health
        </h2>
        <Pill tone={count > 0 ? "stop" : "go"}>
          {count > 0
            ? `${count} ${count === 1 ? "thing needs" : "things need"} attention`
            : "Nothing needs attention"}
        </Pill>
      </div>

      {count > 0 && (
        <div className="border-t border-rule-soft bg-stop-wash/50 px-5 py-3">
          <ul className="space-y-1">
            {summary.attention.map((row) => (
              <li key={row.key} className="font-body text-[13px] leading-[1.55] text-dim">
                <span className="font-semibold text-ink">{row.label}</span> — {row.note}
              </li>
            ))}
          </ul>
          <p className="mt-2 font-body text-[12.5px] leading-[1.55] text-dim">
            Nothing here means anything is lost — the work simply waits until it&apos;s fixed.
            These are fixed outside the app, so pass them to whoever looks after the system
            when you next can.
          </p>
        </div>
      )}

      {summary.groups.map((group) => (
        <div key={group.title} className="border-t border-rule-soft px-5 py-3">
          <h3 className="font-body text-[13px] font-semibold text-dim">{group.title}</h3>
          {group.rows ? (
            <ul className="mt-1">
              {group.rows.map((row) => (
                <HealthLine
                  key={row.key}
                  icon={serviceLogo(row.key)}
                  label={row.label}
                  tone={row.tone}
                  note={row.note}
                />
              ))}
            </ul>
          ) : (
            <p className="mt-1 font-body text-[13px] leading-[1.55] text-dim">{group.unavailable}</p>
          )}
        </div>
      ))}

      <div className="border-t border-rule-soft px-5 py-3">
        <h3 className="font-body text-[13px] font-semibold text-dim">Provider status</h3>
        <ul className="mt-1">
          {PROVIDER_STATUS_LINKS.map((link) => (
            <li key={link.key} className="flex items-center gap-2.5 py-1.5">
              <span aria-hidden="true" className="flex w-8 shrink-0 items-center justify-center">
                {providerLogo(link.key)}
              </span>
              <span className="min-w-0 flex-1 font-body text-[13.5px] text-ink">{link.label}</span>
              <a
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className={`shrink-0 rounded-full px-3 py-1 font-body text-[12px] font-semibold text-white transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lead ${PROVIDER_STYLE[link.key]?.button ?? ""}`}
              >
                Check status
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-1 font-body text-[12.5px] leading-[1.55] text-dim">
          These pages are run by the providers and keep working when this app is down. If
          something above looks fine but the app is broken, check here before changing
          anything.
        </p>
      </div>
    </section>
  );
}

export default SystemHealthCard;
