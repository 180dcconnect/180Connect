import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

/**
 * Everything except static assets.
 *
 * Each matched request runs `updateSession`, which resolves the session and
 * enforces the F007 idle window — real work that a font file has no use for.
 * The image extensions were already excluded; fonts (`woff`/`woff2`/`ttf`/
 * `otf`/`eot`), `ico`, and the `robots.txt`/`sitemap.xml`/manifest family were
 * not, so each of those was paying a session check.
 *
 * What stays matched, deliberately: every page, every RSC navigation payload,
 * and every server-action POST. Those have no distinguishing extension and they
 * are exactly the requests the idle window is measured from.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff|woff2|ttf|otf|eot|txt|xml|webmanifest)$).*)",
  ],
};
