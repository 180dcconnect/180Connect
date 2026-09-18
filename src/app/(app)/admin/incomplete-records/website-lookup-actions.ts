"use server";

import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { createClient } from "@/lib/supabase/server";
import { fetchImportPage } from "@/lib/import/page-transport";
import { extractOrganisation } from "@/lib/import/extract-organisation";
import {
  containsRedactionPlaceholder,
  isPersonalEmail,
} from "@/lib/ingestion/personal-data";
import { validateClientEmail } from "@/lib/client-email-validation";
import {
  createDefaultPostcodeLookupDependencies,
  lookupPostcodePlaces,
} from "@/lib/postcode-lookup";
import { displayPlaceName } from "@/lib/place-name";

const DEFAULT_ROLE_PARTS = new Set([
  "info",
  "contact",
  "enquiries",
  "enquiry",
  "hello",
  "admin",
  "office",
  "mail",
  "team",
  "general",
  "support",
  "help",
  "fundraising",
  "safeguarding",
  "volunteering",
  "volunteer",
  "reception",
]);

export type EmailLookupState =
  | {
      kind: "proposed";
      email: string;
      hostname: string;
      role: boolean;
    }
  | { kind: "skipped"; message: string }
  | { kind: "error"; message: string };

export type LocationLookupState =
  | {
      kind: "proposed";
      city: string;
      evidence: string | null;
      hostname: string;
    }
  | { kind: "skipped"; message: string }
  | { kind: "error"; message: string };

/**
 * Searches an organisation's website for an email address that complies with
 * the platform's data protection policy (role-based generic inboxes only,
 * personal addresses rejected).
 */
export async function readEmailFromWebsiteAction(input: {
  organisationId: string;
  url?: string | null;
}): Promise<EmailLookupState> {
  const authorization = await getCurrentActor("client:edit", {
    route: "/admin/incomplete-records",
  });
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }

  const organisationId = input.organisationId.trim();
  const supabase = await createClient();

  const { data: orgData, error: orgError } = await supabase
    .from("organisations")
    .select("legal_name, website")
    .eq("id", organisationId)
    .maybeSingle<{ legal_name: string | null; website: string | null }>();

  if (orgError) {
    await reportError(orgError, {
      operation: "admin.incomplete_records.email_lookup_org",
      organisationId,
    });
    return {
      kind: "error",
      message: "The client record could not be read. Refresh and try again.",
    };
  }

  const urlToFetch = input.url?.trim() || orgData?.website?.trim() || null;
  if (!urlToFetch) {
    return {
      kind: "error",
      message: "This record has no website on file. Add one first, then read the email from it.",
    };
  }

  // Load configured role local parts
  const roleParts = new Set(DEFAULT_ROLE_PARTS);
  try {
    const { data: dbRoleParts } = await supabase
      .from("personal_email_role_parts")
      .select("local_part")
      .eq("is_active", true);
    for (const row of dbRoleParts ?? []) {
      if (row.local_part) roleParts.add(row.local_part.toLowerCase().trim());
    }
  } catch {
    // Fail soft to default role parts
  }

  let pageResult;
  try {
    pageResult = await fetchImportPage(urlToFetch);
  } catch (err) {
    await reportError(err, {
      operation: "admin.incomplete_records.email_lookup_fetch",
      url: urlToFetch,
    });
    return {
      kind: "error",
      message: "The website could not be reached. Check the URL or enter an email manually.",
    };
  }

  if (pageResult.status !== "fetched") {
    return {
      kind: "skipped",
      message:
        pageResult.status === "disallowed_by_robots"
          ? "This website does not allow automated reading (robots.txt). Check it manually in your browser."
          : pageResult.reason || "The website could not be fetched.",
    };
  }

  const html = pageResult.body;
  const extraction = extractOrganisation(html, pageResult.finalUrl);
  let hostname = "";
  try {
    hostname = new URL(pageResult.finalUrl).hostname.replace(/^www\./, "");
  } catch {
    hostname = urlToFetch;
  }

  // Collect candidate emails
  const candidates = new Set<string>();
  if (extraction.contactEmail) {
    candidates.add(extraction.contactEmail.toLowerCase().trim());
  }

  for (const match of html.matchAll(/href\s*=\s*["']mailto:([^"'?]+)/gi)) {
    const email = match[1]?.trim().toLowerCase();
    if (email) candidates.add(email);
  }

  const emailRegex = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  for (const match of html.matchAll(emailRegex)) {
    candidates.add(match[0].toLowerCase().trim());
  }

  if (candidates.size === 0) {
    return {
      kind: "skipped",
      message: "No email addresses were found on that website.",
    };
  }

  let foundPersonalEmail = false;

  for (const candidate of candidates) {
    if (containsRedactionPlaceholder(candidate)) continue;
    const validated = validateClientEmail(candidate);
    if (validated.status !== "valid") continue;

    if (isPersonalEmail(candidate, roleParts)) {
      foundPersonalEmail = true;
      continue;
    }

    // Found a valid role email that complies with policy
    return {
      kind: "proposed",
      email: candidate,
      hostname,
      role: true,
    };
  }

  if (foundPersonalEmail) {
    return {
      kind: "skipped",
      message:
        "The email found on the website appears to be a personal address (e.g. naming an individual) and cannot be stored under data protection policy. Please enter a generic role address (info@, enquiries@).",
    };
  }

  return {
    kind: "skipped",
    message: "No valid role-based email addresses were found on the website.",
  };
}

/**
 * Searches an organisation's website for location details (town, city, or UK postcode).
 */
export async function readLocationFromWebsiteAction(input: {
  organisationId: string;
  url?: string | null;
}): Promise<LocationLookupState> {
  const authorization = await getCurrentActor("client:edit", {
    route: "/admin/incomplete-records",
  });
  if (!authorization.ok) {
    return { kind: "error", message: actorFailureMessage(authorization.reason) };
  }

  const organisationId = input.organisationId.trim();
  const supabase = await createClient();

  const { data: orgData, error: orgError } = await supabase
    .from("organisations")
    .select("legal_name, website")
    .eq("id", organisationId)
    .maybeSingle<{ legal_name: string | null; website: string | null }>();

  if (orgError) {
    await reportError(orgError, {
      operation: "admin.incomplete_records.location_lookup_org",
      organisationId,
    });
    return {
      kind: "error",
      message: "The client record could not be read. Refresh and try again.",
    };
  }

  const urlToFetch = input.url?.trim() || orgData?.website?.trim() || null;
  if (!urlToFetch) {
    return {
      kind: "error",
      message: "This record has no website on file. Add one first, then read the location from it.",
    };
  }

  let pageResult;
  try {
    pageResult = await fetchImportPage(urlToFetch);
  } catch (err) {
    await reportError(err, {
      operation: "admin.incomplete_records.location_lookup_fetch",
      url: urlToFetch,
    });
    return {
      kind: "error",
      message: "The website could not be reached. Check the URL or enter a location manually.",
    };
  }

  if (pageResult.status !== "fetched") {
    return {
      kind: "skipped",
      message:
        pageResult.status === "disallowed_by_robots"
          ? "This website does not allow automated reading (robots.txt). Check it manually in your browser."
          : pageResult.reason || "The website could not be fetched.",
    };
  }

  const html = pageResult.body;
  const extraction = extractOrganisation(html, pageResult.finalUrl);
  let hostname = "";
  try {
    hostname = new URL(pageResult.finalUrl).hostname.replace(/^www\./, "");
  } catch {
    hostname = urlToFetch;
  }

  // 1. If structured data gave a city
  if (extraction.city && !containsRedactionPlaceholder(extraction.city)) {
    return {
      kind: "proposed",
      city: displayPlaceName(extraction.city),
      evidence: "declared in site metadata",
      hostname,
    };
  }

  // 2. If a UK postcode was found, look up its council/town
  const postcodeCandidate = extraction.postcode;
  if (postcodeCandidate) {
    try {
      const placesResult = await lookupPostcodePlaces(
        postcodeCandidate,
        createDefaultPostcodeLookupDependencies(),
      );
      if (placesResult.status === "found" && placesResult.districts.length > 0) {
        return {
          kind: "proposed",
          city: displayPlaceName(placesResult.districts[0]),
          evidence: `mapped from postcode ${placesResult.postcode}`,
          hostname,
        };
      }
    } catch {
      // Continue to next check
    }
  }

  return {
    kind: "skipped",
    message: "No town, city, or UK postcode could be found on the website.",
  };
}
