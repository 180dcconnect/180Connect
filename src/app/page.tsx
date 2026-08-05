import Link from "next/link";

import AsciiBackground from "@/components/ascii-background";

/**
 * The three principles a CAM actually feels day to day, in the order they hit:
 * who to contact, what leaves the platform, what survives a handover.
 */
const PRINCIPLES = [
  {
    label: "Scoring",
    body: "Every organisation carries a score you can open up — its inputs, its weighting, and why it ranked where it did.",
  },
  {
    label: "Approval",
    body: "Drafting is AI-assisted. Sending is not. No email leaves the platform until a CAM approves it.",
  },
  {
    label: "Handover",
    body: "Ownership, replies and open work stay on the record when a CAM hands over or leaves.",
  },
];

export default function Home() {
  return (
    <main className="relative flex flex-1 flex-col overflow-hidden bg-background">
      {/* Crop anchored high so the skyline clears the copy block. */}
      <AsciiBackground src="/forest.jpg" config={{ focalY: 12 }} />

      {/* Scrims track the photo's own tonality: paper at the top where the
          type is dark, forest shadow at the foot where it turns light. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[82%] bg-gradient-to-b from-background via-background/92 to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[45%] bg-gradient-to-t from-[#0c1014]/90 via-[#0c1014]/45 to-transparent"
      />

      <div className="relative flex flex-1 flex-col px-6 py-6 sm:px-10 sm:py-8">
        <header className="rise flex items-baseline justify-between font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-foreground/60">
          <span className="font-semibold text-foreground">
            180<span className="text-brand">Connect</span>
          </span>
          <span className="hidden sm:inline">180 Degrees Consulting Sheffield</span>
        </header>

        <div className="flex flex-1 items-start pt-16 sm:pt-24">
          <div className="max-w-[52rem]">

            <h1
              className="rise font-body text-[clamp(2.5rem,7.5vw,5.25rem)] font-black leading-[0.94] tracking-[-0.035em] text-foreground"
              style={{ animationDelay: "160ms" }}
            >
              Find the organisations
              <br />
              worth contacting first.
            </h1>

            <p
              className="rise mt-7 max-w-[44ch] text-base leading-relaxed text-foreground/90 sm:text-lg"
              style={{ animationDelay: "260ms" }}
            >
              One record per organisation — scored, owned and searchable — instead of
              spreadsheets, shared inboxes and Drive folders.
            </p>

            <div
              className="rise mt-10 flex flex-wrap items-center gap-x-6 gap-y-3"
              style={{ animationDelay: "360ms" }}
            >
              <Link
                href="/login"
                className="inline-flex h-11 items-center rounded-full bg-brand px-7 text-sm font-bold text-white transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Log in
              </Link>
              <p className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/70">
                Access is by invitation from an admin
              </p>
            </div>
          </div>
        </div>

        <footer
          className="rise mt-16 border-t border-white/20 pt-6"
          style={{ animationDelay: "520ms" }}
        >
          <ul className="grid gap-6 sm:grid-cols-3 sm:gap-10">
            {PRINCIPLES.map(({ label, body }) => (
              <li key={label}>
                <p className="font-mono text-[0.625rem] uppercase tracking-[0.24em] text-white/60">
                  {label}
                </p>
                <p className="mt-2 max-w-[34ch] text-sm leading-relaxed text-white/85">
                  {body}
                </p>
              </li>
            ))}
          </ul>
        </footer>
      </div>
    </main>
  );
}
