// The heading block every Data imports tab shares: source mark, title, and the
// group's tab row.
//
// It exists so a page and its `loading.tsx` can render the *same* header. The
// tab row is static — four `Link`s and the current route — so the skeleton can
// paint the real one rather than a grey bar standing in for it. Switching tabs
// then leaves the header pixel-identical while only the body below it swaps,
// which is most of what made the transition read as a whole-page reload.
//
// Whatever a page needs under the tabs (a register rail, a description) is
// passed as children, so this component stays the part that is genuinely
// common.

import Image from "next/image";
import { GroupTabs } from "@/components/ui/group-tabs";
import { getCurrentActor } from "@/lib/auth/actor";
import { dataImportsTabsFor } from "./import-group";

type SourceMark = {
  /** The register or publisher this tab imports from. */
  href: string;
  /** Announced on the link — the image itself is decorative. */
  label: string;
  src: string;
  width: number;
  height: number;
  className: string;
};

/**
 * Per-route heading. Keyed by the same href the tab row uses, so a tab that
 * exists here and a tab that exists there cannot disagree.
 */
const HEADINGS: Record<string, { title: string; mark?: SourceMark }> = {
  "/admin/import-status": { title: "Import status" },
  "/clients/new": { title: "Add a client" },
  "/admin/companies-house": {
    title: "Companies House",
    mark: {
      href: "https://find-and-update.company-information.service.gov.uk",
      label: "Companies House register (opens in a new tab)",
      src: "/sources/companies-house.png",
      width: 112,
      height: 112,
      className: "h-20 w-auto sm:h-24 md:h-28",
    },
  },
  "/admin/charity-commission": {
    title: "Charity Commission",
    mark: {
      href: "https://register-of-charities.charitycommission.gov.uk",
      label: "Charity Commission register (opens in a new tab)",
      src: "/sources/charity-commission.png",
      width: 112,
      height: 112,
      className: "h-20 w-auto sm:h-24 md:h-28",
    },
  },
  "/admin/three-sixty-giving": {
    title: "360Giving",
    mark: {
      href: "https://360giving.org",
      label: "360Giving website (opens in a new tab)",
      src: "/sources/360giving.png",
      width: 140,
      height: 77,
      className: "h-12 w-auto sm:h-14 md:h-16",
    },
  },
};

/**
 * The mark row's height is reserved, not derived from the mark inside it.
 *
 * The four tabs carry marks of different heights and Import status carries none
 * at all, so a row sized by its content put the tab row at a different vertical
 * position on every tab — switching tabs made the tabs themselves jump, which is
 * the one element that must not move, since it is what you are aiming at. The
 * row is therefore always as tall as the tallest mark and the title sits
 * centred in it, so the tab row lands on the same pixel on all four.
 */
const MARK_ROW = "flex min-h-20 items-center gap-4 sm:min-h-24 md:min-h-28";

export async function DataImportsHeader({
  current,
  children,
}: {
  /** The route being rendered — picks the title and selects the tab. */
  current: keyof typeof HEADINGS | string;
  /** Rail, description, or whatever else sits under the tab row. */
  children?: React.ReactNode;
}) {
  const heading = HEADINGS[current];
  if (!heading) return null;
  const { title, mark } = heading;

  // The row shows only the tabs this role's pages would let it into. The
  // profile read is request-cached, so the AppShell above already paid for it.
  const actor = await getCurrentActor();
  const tabs = actor.ok ? dataImportsTabsFor(actor.actor.role) : [];

  return (
    <>
      <div className={MARK_ROW}>
        {mark && (
          <a
            href={mark.href}
            target="_blank"
            rel="noreferrer"
            aria-label={mark.label}
            className="shrink-0 transition-opacity hover:opacity-80"
          >
            <Image
              src={mark.src}
              alt=""
              width={mark.width}
              height={mark.height}
              sizes="(max-width: 640px) 80px, 112px"
              className={mark.className}
            />
          </a>
        )}
        <h1 className="text-[clamp(2rem,4vw,2.75rem)] font-semibold font-body leading-[1] tracking-[-0.03em]">
          {title}
        </h1>
      </div>
      <GroupTabs className="mt-4" tabs={tabs} current={current} />
      {children}
    </>
  );
}
