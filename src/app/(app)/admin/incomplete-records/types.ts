export type IncompleteClientRecord = {
  id: string;
  legal_name: string;
  organisation_type: string;
  city: string | null;
  postcode: string | null;
  country_code: string;
  sector: string | null;
  sub_sector: string | null;
  website: string | null;
  contact_email: string | null;
  mission: string | null;
  hasMission: boolean;
  hasSector: boolean;
  hasWebsite: boolean;
  /**
   * When someone recorded that this client genuinely has no website, or null.
   * Set from this screen; cleared by the database the moment a website is on
   * file. `hasWebsite` is already true for a marked record — this says *why* it
   * counts as complete, so the card can say so instead of showing a blank.
   */
  websiteAbsentAt: string | null;
  hasEmail: boolean;
  hasCity: boolean;
  /** True when any field holds a redaction placeholder that needs replacing. */
  hasRedacted: boolean;
  /** Names of the fields that are currently redacted (e.g. "email", "mission"). */
  redactedFields: string[];
  isIncomplete: boolean;
  /**
   * The pipeline's own sector classification for a record that has none —
   * review-and-apply only, never auto-filled. Null when the record already
   * has a sector or nothing was ever classified.
   */
  suggested_sector: string | null;
  suggested_sub_sector: string | null;
  /** Register numbers behind the "check the source" links — null when unrecorded. */
  charity_number: string | null;
  company_number: string | null;
};

export type FilterTab =
  | "all"
  | "redacted"
  | "mission"
  | "sector"
  | "website"
  | "email"
  | "city"
  | "audit";

export type IncompleteSummaryCounts = {
  totalIncomplete: number;
  missingMission: number;
  missingSector: number;
  missingWebsite: number;
  missingEmail: number;
  missingCity: number;
};
