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
  isIncomplete: boolean;
};

export type FilterTab = "all" | "mission" | "sector" | "website" | "email";

export type IncompleteSummaryCounts = {
  totalIncomplete: number;
  missingMission: number;
  missingSector: number;
  missingWebsite: number;
  missingEmail: number;
};
