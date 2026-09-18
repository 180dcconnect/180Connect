"use server";

import { actorFailureMessage, getCurrentActor } from "@/lib/auth/actor";
import {
  createDefaultPostcodeLookupDependencies,
  looksLikePostcode,
  lookupPostcodePlaces,
  searchPlacesByName,
} from "@/lib/postcode-lookup";

/**
 * "Which council is this postcode in?", for the place picker's search box.
 *
 * On the server rather than in the browser so the outbound call leaves from one
 * place the app controls, and so the answer is cached per postcode across
 * everyone using the screen rather than per browser tab.
 *
 * It reads nothing and writes nothing: no client record is touched, and the
 * only thing that leaves the app is the postcode that was typed. The actor
 * gate is here because an unauthenticated visitor has no business spending the
 * app's outbound requests, not because the answer is sensitive — it is public
 * ONS data.
 */

export type PostcodePlacesState =
  | { kind: "places"; postcode: string; places: string[] }
  | { kind: "none"; message: string };

export async function lookupPostcodePlacesAction(input: {
  query: string;
}): Promise<PostcodePlacesState> {
  const authorization = await getCurrentActor("client:edit", {
    route: "/admin/incomplete-records",
  });
  if (!authorization.ok) {
    return { kind: "none", message: actorFailureMessage(authorization.reason) };
  }

  const query = input.query.trim();
  if (!looksLikePostcode(query)) {
    return { kind: "none", message: "That does not look like a UK postcode." };
  }

  const result = await lookupPostcodePlaces(query, createDefaultPostcodeLookupDependencies());
  if (result.status !== "found") {
    return { kind: "none", message: result.message };
  }

  return { kind: "places", postcode: result.postcode, places: result.districts };
}

export type NamedPlacesState =
  | { kind: "places"; places: { name: string; county: string | null }[] }
  | { kind: "none"; message: string };

/**
 * "Which towns are called this?", for the same search box.
 *
 * The council list the picker is built from is the Charity Commission's, which
 * is upper-tier only — it holds Essex but not Colchester, Kent but not
 * Canterbury. A postcode already resolved to the lower tier, so typing CO1 1AA
 * surfaced Colchester while typing the name found nothing. This closes that
 * gap from the same open service, so both routes reach the same place.
 *
 * Reads nothing, writes nothing: the only thing that leaves the app is the text
 * that was typed into the place search.
 */
export async function searchPlacesByNameAction(input: {
  query: string;
}): Promise<NamedPlacesState> {
  const authorization = await getCurrentActor("client:edit", {
    route: "/admin/incomplete-records",
  });
  if (!authorization.ok) {
    return { kind: "none", message: actorFailureMessage(authorization.reason) };
  }

  const query = input.query.trim();
  if (looksLikePostcode(query)) {
    return { kind: "none", message: "That is a postcode — it is looked up separately." };
  }

  const result = await searchPlacesByName(query, createDefaultPostcodeLookupDependencies());
  if (result.status !== "found") {
    return { kind: "none", message: result.message };
  }

  return { kind: "places", places: result.places };
}
