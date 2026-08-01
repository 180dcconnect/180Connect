import type { CommonRecord, DataSourceAdapter } from "../type";

// TODO: confirm real base URL and auth scheme — this is the open API-scope
// question on F033. Charity Commission's public register API details go here
// once confirmed.
const CHARITY_COMMISSION_URL = "https://register-of-charities.charitycommission.gov.uk/en/api";

type CharityCommissionItem = {
  organisation_number: string; // TODO: confirm actual field name from API docs
  [key: string]: unknown;
};

function shape(raw: CharityCommissionItem): CommonRecord {
  return {
    source_record_id: String(raw.organisation_number),
    raw_payload: raw,
  };
}

export const charityCommissionAdapter: DataSourceAdapter = {
  name: "charity_commission",
  async fetch(): Promise<CommonRecord[]> {
    // TODO: implement real fetch + pagination once API scope is confirmed.
    // Follow the companiesHouseAdapter pattern in companieshouse.ts:
    // page through results, mark `truncated` on the returned array if a
    // source-side ceiling is hit, map each raw item through shape().
    throw new Error("Not implemented — pending Charity Commission API scope decision");
  },
  onError(err: Error) {
    console.error(`[charity_commission] ingestion failed:`, err.message);
  },
};