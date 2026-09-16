"use server";

import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import { reportError } from "@/lib/error-logging";
import { createClient } from "@/lib/supabase/server";
import { validateWebsiteFormat } from "@/lib/website-validation";
import { checkWebsiteReachability } from "@/lib/website-reachability";
import {
  charityByRegisteredNumber,
  registerUnavailableReason,
} from "@/lib/charity-register/sqlite";
import {
  companiesRegisterUnavailableReason,
  companyByNumber,
} from "@/lib/companies-register/sqlite";
import {
  REGISTER_OPTIONS,
  normaliseRegistrationNumber,
  type RegisterId,
} from "@/lib/registration-number";

/**
 * The add-a-client form's as-you-type checks.
 *
 * ── Why these run on the server ──
 *
 * Reachability needs a network request from somewhere that is not the browser —
 * a browser fetch to someone else's site is blocked by CORS and would answer
 * "unreachable" for every site that works. And the register files live in the
 * deployment, not the bundle. Both checks are called after the person stops
 * typing, never per keystroke.
 *
 * ── What blocks and what warns ──
 *
 * A website that is not a web address, or a number that cannot be one the
 * register issued, blocks submit. A site that did not answer, or a number the
 * file does not hold, only warns: sites go down for an afternoon, and the
 * companies file is a filtered ~12% of the register, so neither is proof.
 */

export type WebsiteCheck =
  | { status: "reachable"; hostname: string }
  | { status: "unreachable"; message: string }
  | { status: "invalid"; message: string }
  | { status: "error"; message: string };

export async function checkWebsiteField(value: string): Promise<WebsiteCheck> {
  const authorization = await getCurrentActor("client:edit", { route: "/clients/new" });
  if (!authorization.ok) {
    return { status: "error", message: actorFailureMessage(authorization.reason) };
  }

  const format = validateWebsiteFormat(String(value ?? "").slice(0, 500));
  if (format.status === "missing") return { status: "invalid", message: "Enter the website address." };
  if (format.status === "invalid") {
    return { status: "invalid", message: "That is not a web address — try something like https://example.org." };
  }

  try {
    const reach = await checkWebsiteReachability(format.url);
    if (reach.status === "unreachable") {
      return {
        status: "unreachable",
        message: "The site did not answer. Check the address — you can still submit if it is right.",
      };
    }
    if (reach.status === "invalid" || reach.status === "missing") {
      return { status: "invalid", message: "That is not a web address — try something like https://example.org." };
    }
    return { status: "reachable", hostname: format.hostname.replace(/^www\./, "") };
  } catch (error) {
    await reportError(error, { operation: "clients.new.check_website", actorUserId: authorization.actor.id });
    return { status: "error", message: "The website could not be checked just now." };
  }
}

export type RegistrationCheck =
  | { status: "invalid"; message: string }
  | {
      status: "found";
      number: string;
      name: string;
      listedOrganisationId: string | null;
    }
  | { status: "not_found"; number: string; message: string; listedOrganisationId: string | null }
  | { status: "unchecked"; number: string; message: string; listedOrganisationId: string | null }
  | { status: "error"; message: string };

/** The client already carrying this number, read through the caller's own session. */
async function listedOrganisation(number: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organisation_identifiers")
    .select("organisation_id")
    .eq("identifier_value", number)
    .limit(1)
    .maybeSingle();
  if (error) {
    await reportError(error, { operation: "clients.new.check_registration.listed" });
    return null;
  }
  return data?.organisation_id ?? null;
}

export async function checkRegistrationField(
  register: string,
  value: string,
): Promise<RegistrationCheck> {
  const authorization = await getCurrentActor("client:edit", { route: "/clients/new" });
  if (!authorization.ok) {
    return { status: "error", message: actorFailureMessage(authorization.reason) };
  }

  const option = REGISTER_OPTIONS.find((candidate) => candidate.id === register);
  if (!option || option.id === "other") {
    return { status: "error", message: "Choose one of the listed registers to check a number." };
  }

  const shape = normaliseRegistrationNumber(option.id as RegisterId, String(value ?? "").slice(0, 40));
  if (!shape.ok) return { status: "invalid", message: shape.message };
  const number = shape.value;

  try {
    const listedOrganisationId = await listedOrganisation(number);

    if (option.id === "ccew") {
      if (registerUnavailableReason()) {
        return {
          status: "unchecked",
          number,
          listedOrganisationId,
          message: "The charity register file is not loaded here, so only the number's shape was checked.",
        };
      }
      const charity = charityByRegisteredNumber(Number(number));
      return charity
        ? { status: "found", number, name: charity.name, listedOrganisationId }
        : {
            status: "not_found",
            number,
            listedOrganisationId,
            message: "No charity in the England and Wales register has this number. Check it before you submit.",
          };
    }

    if (option.id === "companies_house") {
      if (companiesRegisterUnavailableReason()) {
        return {
          status: "unchecked",
          number,
          listedOrganisationId,
          message: "The companies register file is not loaded here, so only the number's shape was checked.",
        };
      }
      const company = companyByNumber(number);
      return company
        ? { status: "found", number, name: company.company.name, listedOrganisationId }
        : {
            status: "not_found",
            number,
            listedOrganisationId,
            message:
              "Not in the companies file we hold — that file is a filtered slice of the register, so this is not proof it is wrong.",
          };
    }

    return {
      status: "unchecked",
      number,
      listedOrganisationId,
      message: "The right shape. We hold no copy of this register, so the number itself is not checked.",
    };
  } catch (error) {
    await reportError(error, {
      operation: "clients.new.check_registration",
      actorUserId: authorization.actor.id,
    });
    return { status: "error", message: "The number could not be checked just now." };
  }
}
