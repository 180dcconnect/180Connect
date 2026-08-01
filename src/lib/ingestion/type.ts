// this interface is used to represent a record fetched from a data source. It contains the raw payload and some metadata about the source of the record.
export interface CommonRecord {
  source_record_id: string;
  raw_payload: unknown;
  source_country?: string;
  source_registry_name?: string;
}

// This interface is implemented by each data source adapter. It defines the methods that the ingestion system expects to call on each adapter.
export interface DataSourceAdapter {
  name:
    | "charitybase"
    | "companies_house"
    | "360giving"
    | "find_that_charity"
    | "globalgiving"
    | "candid"
    | "charity_commission"; // added for F033 — do not remove existing members
  fetch(): Promise<CommonRecord[]>;
  onError(err: Error): void;
}