import type { CommonRecord, DataSourceAdapter } from "../type";

const COMPANIES_HOUSE_URL = "https://api.company-information.service.gov.uk";

type CompaniesHouseSearchItem = {
  company_number: string;
  [key: string]: unknown;
};

type CommonRecordList = CommonRecord[] & { truncated?: boolean };

function shape(raw: CompaniesHouseSearchItem): CommonRecord {
  return {
    source_record_id: raw.company_number,
    raw_payload: raw,
  };
}

export const companiesHouseAdapter: DataSourceAdapter = {
  name: "companies_house",

  async fetch(): Promise<CommonRecord[]> {
    const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
    if (!apiKey) {
      throw new Error("COMPANIES_HOUSE_API_KEY is not set.");
    }
    const encodedKey = Buffer.from(`${apiKey}:`).toString("base64");
    const allRecords: CompaniesHouseSearchItem[] = [];
    const itemsPerPage = 100; // Companies House's documented max per page
    const MAX_PAGES = 10; // Limit the number of pages to fetch to avoid excessive API calls
    let pageCount = 0;
    let startIndex = 0;
    let totalResults = Infinity;
    let truncated = false;

    while (
      startIndex < totalResults &&
      pageCount < MAX_PAGES &&
      startIndex + itemsPerPage <= 1000
    ) {
      const res = await fetch(
        `${COMPANIES_HOUSE_URL}/search/companies?q=charity&items_per_page=${itemsPerPage}&start_index=${startIndex}`,
        { headers: { Authorization: `Basic ${encodedKey}` } },
      );

      if (!res.ok) {
        const errorBody = await res.text();
        console.log("Companies House error body:", errorBody);
        throw new Error(`Companies House API returned ${res.status}`);
      }

      const json = await res.json();
      if (!Array.isArray(json.items)) {
        throw new Error("Companies House response is missing an items array.");
      }

      allRecords.push(...json.items);
      if (json.items.length === 0) break; // stop if a page comes back empty, regardless of total_results
      totalResults = json.total_results;
      startIndex += itemsPerPage;
      pageCount++;

      if (pageCount >= MAX_PAGES || startIndex + itemsPerPage > 1000) {
        truncated = true;
      }
    }

    if (truncated) {
      console.warn(
        `[companies_house] hit the ~1000-record search ceiling — total_results was ${totalResults}, only fetched ${allRecords.length}.`,
      );
    }

    const result = allRecords.map(shape) as CommonRecordList;
    result.truncated = truncated;
    return result;
  },

  onError(err: Error) {
    console.error(`[companies_house] ingestion failed:`, err.message);
  },
};
