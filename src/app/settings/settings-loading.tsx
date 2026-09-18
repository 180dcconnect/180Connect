import { Skeleton } from "@/components/ui/skeleton";

/**
 * The loading frame every settings page shares, so the pages that had no
 * `loading.tsx` at all no longer sit on the previous screen after a click.
 *
 * Without one, Next cannot prefetch a signed-in page (it is rendered per
 * request) and the click shows nothing until the server has finished — the app
 * reads as frozen. With one, the settings shell stays put, this frame paints at
 * once, and the page streams into it.
 *
 * Geometry is the pages' own: bone ground, full-width `Stage` (`space-y-8`), the
 * real heading text (it is fixed copy, so it is drawn rather than guessed at),
 * the optional facts rail under it, then the panels' shared card
 * (`rounded-panel border border-rule bg-white`), which is the same card
 * `outreach-preferences/loading.tsx` mirrors.
 *
 * Approximated because it is data: how many rows each panel holds, and whether
 * the page shows its load-failed alert instead.
 */
export function SettingsLoading({
  title,
  fact = false,
  cards,
}: {
  /** The page's h1, exactly as the page writes it. */
  title: string;
  /** Whether the page draws the dot-and-sentence facts rail under its heading. */
  fact?: boolean;
  /** One entry per card: how many field rows to draw inside it. */
  cards: number[];
}) {
  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <div className="w-full space-y-8">
        <div>
          <h1 className="font-body text-[clamp(2rem,4vw,2.75rem)] leading-[1] font-semibold tracking-[-0.03em] text-ink">
            {title}
          </h1>
          {fact && <Skeleton className="mt-5 h-5 w-80 max-w-full" />}
        </div>

        <div className="space-y-4">
          {cards.map((rows, card) => (
            <section
              key={card}
              aria-hidden="true"
              className="rounded-panel border border-rule bg-white px-5 py-5 sm:px-6"
            >
              <Skeleton className="h-6 w-56 max-w-full" />
              <Skeleton className="mt-2 h-4 w-3/4" />
              <div className="mt-4">
                {Array.from({ length: rows }).map((_, row) => (
                  <div
                    key={row}
                    className="flex flex-col gap-2 border-t border-rule-soft py-3.5 sm:flex-row sm:items-center sm:gap-8"
                  >
                    <Skeleton className="h-4 w-32 sm:w-48 sm:shrink-0" />
                    <Skeleton className="h-9 w-full max-w-sm rounded-inset" />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
