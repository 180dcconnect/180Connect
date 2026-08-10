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
  /** Strong external evidence (e.g. Companies House Tier A/B legal form) that
   * can bypass the human-review hold for a type in strongEvidenceTypes. Absent
   * or "weak" changes nothing versus the existing accepted/review/reject logic. */
  sourceConfidence?: "strong" | "weak";
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
    || config.priorityPostcodePrefixes.some((prefix) => {
      const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`^${escaped}\\d`).test(postcode);
    });
  const missionContext = `${normalise(input.sector)} ${normalise(input.mission)}`;
  const healthcareAligned = config.healthcareKeywords.some((keyword) =>
    missionContext.includes(keyword.toLowerCase()),
  );
  const priority = local ? "south_yorkshire" : "standard";

  // `type` is an arbitrary normalised string (source data or, eventually, Manual
  // Entry free text), not a checked OrganisationType — `includes` is typed against
  // the config arrays' element type, so the membership check itself has to compare
  // as plain strings rather than assert `type` into that type.
  const acceptedTypes: readonly string[] = config.acceptedOrganisationTypes;
  const reviewTypes: readonly string[] = config.reviewOrganisationTypes;

  if (acceptedTypes.includes(type)) {
    return {
      outcome: "meets",
      priority,
      healthcareAligned,
      reasons: [
        "Organisation type meets the target-client criteria.",
        local
          ? "Sheffield/South Yorkshire location receives priority."
          : "National and international organisations remain eligible.",
      ],
    };
  }

  const strongEvidenceTypes: readonly string[] = config.strongEvidenceTypes;
  if (input.sourceConfidence === "strong" && strongEvidenceTypes.includes(type)) {
    return {
      outcome: "meets",
      priority,
      healthcareAligned,
      reasons: [
        "Strong external evidence (legal form) confirms mission fit without human review.",
      ],
    };
  }

  if (reviewTypes.includes(type)) {
    return {
      outcome: "needs_review",
      priority,
      healthcareAligned,
      reasons: [
        "Organisation type needs evidence of non-profit or social purpose before activation.",
      ],
    };
  }

  return {
    outcome: "does_not_meet",
    priority,
    healthcareAligned,
    reasons: ["Organisation type is outside the configured target-client criteria."],
  };
}
