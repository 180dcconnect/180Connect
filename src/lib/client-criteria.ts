import {
  CLIENT_CRITERIA,
  type ClientCriteriaConfig,
} from "./client-criteria-config.ts";

export type ClientCriteriaInput = {
  organisationType: string;
  city?: string | null;
  postcode?: string | null;
  countryCode?: string | null;
  geographicReach?: string | null;
  sector?: string | null;
  mission?: string | null;
};

export type ClientCriteriaResult = {
  outcome: "meets" | "needs_review" | "does_not_meet";
  priority: "standard" | "south_yorkshire";
  healthcareAligned: boolean;
  reasons: string[];
};

const normalise = (value: string | null | undefined) => value?.trim().toLowerCase() ?? "";

/** Shared by imports now and Manual Entry when that workflow is implemented. */
export function checkClientCriteria(
  input: ClientCriteriaInput,
  config: ClientCriteriaConfig = CLIENT_CRITERIA,
): ClientCriteriaResult {
  const type = normalise(input.organisationType);
  const city = normalise(input.city);
  const postcode = (input.postcode ?? "").trim().toUpperCase();
  const local = config.priorityCities.includes(city)
    || config.priorityPostcodePrefixes.some((prefix) => postcode.startsWith(prefix));
  const missionContext = `${normalise(input.sector)} ${normalise(input.mission)}`;
  const healthcareAligned = config.healthcareKeywords.some((keyword) =>
    missionContext.includes(keyword.toLowerCase()),
  );

  if (config.acceptedOrganisationTypes.includes(type as never)) {
    return {
      outcome: "meets",
      priority: local ? "south_yorkshire" : "standard",
      healthcareAligned,
      reasons: [
        "Organisation type meets the target-client criteria.",
        local
          ? "Sheffield/South Yorkshire location receives priority."
          : "National and international organisations remain eligible.",
      ],
    };
  }

  if (config.reviewOrganisationTypes.includes(type as never)) {
    return {
      outcome: "needs_review",
      priority: local ? "south_yorkshire" : "standard",
      healthcareAligned,
      reasons: [
        "Organisation type needs evidence of non-profit or social purpose before activation.",
      ],
    };
  }

  return {
    outcome: "does_not_meet",
    priority: local ? "south_yorkshire" : "standard",
    healthcareAligned,
    reasons: ["Organisation type is outside the configured target-client criteria."],
  };
}
