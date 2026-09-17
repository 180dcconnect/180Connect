export type IncompleteClientRecord = {
  id: string;
  legal_name: string;
  organisation_type: string;
  city: string | null;
  country_code: string;
  sector: string | null;
  sub_sector: string | null;
  website: string | null;
  contact_email: string | null;
  mission: string | null;
  hasMission: boolean;
  hasSector: boolean;
  hasWebsite: boolean;
  hasEmail: boolean;
  hasCity: boolean;
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

export type FilterTab = "all" | "mission" | "sector" | "website" | "email" | "city";

export type IncompleteSummaryCounts = {
  totalIncomplete: number;
  missingMission: number;
  missingSector: number;
  missingWebsite: number;
  missingEmail: number;
  missingCity: number;
};
