import {
  webSearchHref,
  WEB_SEARCH_LABEL,
  type SearchableField,
} from "@/lib/web-search";
import Image from "next/image";

/**
 * The pre-filled Google search for one detail a client is missing.
 *
 * The workaround everyone reaches for ("put the name and the word website into a
 * search engine") is one tap instead of retyping the client's name. A link, not a
 * control: whoever can read the record can search for it, and nothing about the
 * record changes either way.
 */
export function SearchTheWebLink({
  field,
  clientName,
}: {
  field: SearchableField;
  clientName: string;
}) {
  return (
    <a
      href={webSearchHref(field, clientName)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-lead hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lead/30"
    >
      <Image
        src="/providers/google-workspace.png"
        alt=""
        width={15}
        height={15}
        aria-hidden="true"
      />
      {WEB_SEARCH_LABEL}
      <span className="sr-only">
        {" "}
        for {clientName} (opens in a new tab)
      </span>
    </a>
  );
}
