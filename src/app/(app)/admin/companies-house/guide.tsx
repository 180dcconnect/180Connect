/**
 * The short guide under the run history: what this register is, what the
 * strong signals mean, and what re-running does. The screen's other starting
 * points, beside the primary one rather than below the fold.
 */
export function CompaniesHouseGuide() {
  return (
    <section className="rounded-2xl border border-black/[0.07] bg-white px-5 py-4 shadow-xs sm:px-6">
      <h2 className="text-sm font-bold text-foreground">How company imports work</h2>
      <div className="mt-2 space-y-2 text-sm leading-[1.65] text-foreground/65">
        <p>
          The register above is a staged copy of Companies House&apos;s monthly
          snapshot — every mission-plausible company, from community interest
          companies to the sectors 180DC works with. Choosing which of them
          become clients happens on screen, with a live count, and nothing is
          added until you confirm.
        </p>
        <p>
          Legal form is the strongest signal here: charitable incorporated
          organisations and community interest companies skip the human-review
          hold, because their form alone evidences mission fit. Everything else
          is held for review or rejected by the same client criteria as every
          other source.
        </p>
        <p>
          Re-running a filter set is safe — companies already on the list are
          matched, not duplicated. Companies House publishes no contact details
          or financial figures, so imported companies arrive lean: enrichment
          happens afterwards, from other sources.
        </p>
      </div>
    </section>
  );
}
