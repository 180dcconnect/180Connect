import { Fragment } from "react";
import {
  organisationSourceLinks,
  type OrganisationSource,
} from "@/lib/organisation-source-links";

/**
 * "Check the source: Charity Commission register · Companies House · Website".
 *
 * Renders nothing when the record has neither a register number nor a website,
 * so a card header can drop it in beside its status without a condition of its
 * own. Links only, never a control: a viewer reads exactly the sources an admin
 * does, and a fact is checked at its origin either way.
 */
export function CheckTheSource({
  source,
  trailingSeparator = false,
}: {
  source: OrganisationSource;
  /** Adds the same quiet divider before a neighbouring link supplied by the caller. */
  trailingSeparator?: boolean;
}) {
  const links = organisationSourceLinks(source);
  if (links.length === 0) return null;

  return (
    <>
      <span className="text-[13px] text-dim">Check the source:</span>
      {links.map((link, index) => (
        <Fragment key={link.href}>
          {index > 0 && (
            <span aria-hidden="true" className="text-[13px] text-faint">
              ·
            </span>
          )}
          <a
            href={link.href}
            target="_blank"
            rel="noreferrer"
            className="text-[13px] font-medium text-lead hover:underline"
          >
            {link.label}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </Fragment>
      ))}
      {trailingSeparator && (
        <span aria-hidden="true" className="text-[13px] text-faint">
          ·
        </span>
      )}
    </>
  );
}
