/**
 * The shapes the Companies House Basic Company Data product actually
 * publishes, and the small amount of interpretation the companies-register
 * build does on each row.
 *
 * The product is a monthly ZIP of CSVs (~469MB zipped, ~2GB / ~5.2M rows,
 * September 2026), one row per live company, no key, no rate limit:
 * https://download.companieshouse.gov.uk/en_output.html
 *
 * Split from the build script (scripts/build-companies-register-sqlite.mts)
 * so the row vocabulary is testable without downloading half a gigabyte.
 * Only the fields the register file stores are typed — the CSV carries far
 * more (mortgages, previous names, filing dates) that nothing reads.
 *
 * ── Three things the file does not say the way our pipeline does ──
 *
 * 1. `CompanyCategory` is human wording ("Private Limited Company"), not the
 *    API's `company_type` slug ("ltd"). CATEGORY_TO_SLUG maps the wording the
 *    September 2026 file actually contains — the build fails loudly on an
 *    unmapped value rather than guessing, and the census that produced the
 *    map is recorded in the spike note in docs/companies-register-import.md.
 * 2. `CompanyStatus` is display text ("Active - Proposal to Strike off")
 *    where the API (and the status-recheck job) speaks lowercase slugs
 *    ("active"). normalizeCompanyStatus maps to the API vocabulary at build,
 *    so a freshly imported row never looks "changed" to the first recheck.
 * 3. SIC codes arrive as combined text ("86101 - Hospital activities") and
 *    include legacy 4-digit SIC2003 codes plus "None Supplied". parseSicCode
 *    keeps 5-digit SIC2007 codes only — the same vocabulary the API speaks,
 *    and the one TIER_C_SIC_ALLOWLIST is written in — so a legacy code simply
 *    never matches a filter instead of matching the wrong thing.
 */

export type CompaniesCsvHeader = { indexByName: Map<string, number> };

/** Columns the build reads. Names normalised the way the file spells them. */
const WANTED_COLUMNS = [
  "CompanyName",
  "CompanyNumber",
  "RegAddress.AddressLine1",
  "RegAddress.PostTown",
  "RegAddress.PostCode",
  "CompanyCategory",
  "CompanyStatus",
  "IncorporationDate",
  "SICCode.SicText_1",
  "SICCode.SicText_2",
  "SICCode.SicText_3",
  "SICCode.SicText_4",
] as const;

export type WantedColumn = (typeof WANTED_COLUMNS)[number];

/**
 * Maps a CSV header row to column indexes. The file pads some headers with
 * spaces (" CompanyNumber", " RegAddress.AddressLine2"), so names are
 * trimmed before matching. Throws on a missing column — a silently shifted
 * column would misfile millions of rows.
 */
export function indexCsvHeader(header: string[]): CompaniesCsvHeader {
  const indexByName = new Map<string, number>();
  header.forEach((name, index) => {
    const key = name.trim();
    if (!indexByName.has(key)) indexByName.set(key, index);
  });
  const missing = WANTED_COLUMNS.filter((name) => !indexByName.has(name));
  if (missing.length > 0) {
    throw new Error(`Company data CSV is missing columns: ${missing.join(", ")}`);
  }
  return { indexByName };
}

export function columnValue(
  record: string[],
  header: CompaniesCsvHeader,
  name: WantedColumn,
): string {
  return (record[header.indexByName.get(name) ?? -1] ?? "").trim();
}

/**
 * One CSV row, as far as the register build reads it. SIC codes are the
 * parsed 5-digit set; unparseable entries ("None Supplied", legacy 4-digit
 * codes) are dropped before they reach this shape.
 */
export type ExtractCompany = {
  companyNumber: string;
  companyName: string;
  categoryRaw: string;
  categorySlug: string;
  statusRaw: string;
  statusNorm: string;
  incorporationDate: string | null;
  postcode: string | null;
  postcodeArea: string | null;
  town: string | null;
  addressLine1: string | null;
  sicCodes: string[];
  /** Code to the file's own description, for the sic_label table. */
  sicTitles: Record<string, string>;
  isCic: boolean;
};

/**
 * Every `CompanyCategory` wording present in the September 2026 file, mapped
 * to the API `company_type` slug the standardiser and the tier classifier
 * read. "Other company type" and anything genuinely unknown map to "other" —
 * the tier classifier treats those as no-tier, which routes them to review
 * rather than to the client list.
 *
 * The CIC wording maps to "community-interest-company", which is not an API
 * `company_type` (there it is a subtype of an underlying form the file does
 * not publish). The tier classifier learns this one value alongside the
 * subtype check — see classifyCompaniesHouseTier — so the file's own flag
 * survives without inventing an underlying legal form.
 */
export const CATEGORY_TO_SLUG: Readonly<Record<string, string>> = {
  "Private Limited Company": "ltd",
  "PRI/LTD BY GUAR/NSC (Private, limited by guarantee, no share capital)":
    "private-limited-guarant-nsc",
  "Limited Partnership": "limited-partnership",
  "Limited Liability Partnership": "llp",
  "Community Interest Company": "community-interest-company",
  "Charitable Incorporated Organisation": "charitable-incorporated-organisation",
  "Overseas Entity": "oversea-company",
  "PRI/LBG/NSC (Private, Limited by guarantee, no share capital, use of 'Limited' exemption)":
    "private-limited-guarant-nsc-limited-exemption",
  "Other company type": "other",
  "Registered Society": "registered-society-non-jurisdictional",
  "Scottish Charitable Incorporated Organisation":
    "scottish-charitable-incorporated-organisation",
  "Public Limited Company": "plc",
  "Private Unlimited Company": "private-unlimited",
  "Royal Charter Company": "royal-charter",
  "Investment Company with Variable Capital": "investment-company-with-variable-capital",
  "Scottish Partnership": "scottish-partnership",
  "Industrial and Provident Society": "industrial-and-provident-society",
  "United Kingdom Economic Interest Grouping": "eeig",
  "Old Public Company": "old-public-company",
  "Investment Company with Variable Capital(Umbrella)": "icvc-umbrella",
  "Private Unlimited": "private-unlimited-nsc",
  "United Kingdom Societas": "united-kingdom-societas",
  "Investment Company with Variable Capital (Securities)": "icvc-securities",
  "PRIV LTD SECT. 30 (Private limited company, section 30 of the Companies Act)":
    "private-limited-shares-section-30-exemption",
  "Converted/Closed": "converted-or-closed",
  "Protected Cell Company": "protected-cell-company",
};

/** Raw file wordings, so the coverage rule reads as the file spells it. */
export const CIC_CATEGORY = "Community Interest Company";
export const TIER_A_CATEGORIES: ReadonlySet<string> = new Set([
  "Charitable Incorporated Organisation",
  "Scottish Charitable Incorporated Organisation",
]);
/** Kept regardless of SIC: tiny populations, definitive mission shape. */
export const TIER_C_CATEGORIES: ReadonlySet<string> = new Set([
  "Royal Charter Company",
  "United Kingdom Societas",
]);

/**
 * The API-vocabulary status. Only "active" feeds the client list by default;
 * every other value is stored so the filter screen can offer it and the
 * status-recheck job can compare against the API without a false "changed"
 * on first sight.
 */
export function normalizeCompanyStatus(value: string): string {
  const text = value.trim();
  if (text === "Active" || text === "Active - Proposal to Strike off") return "active";
  if (text === "Liquidation") return "liquidation";
  if (text.startsWith("In Administration")) return "administration";
  if (text === "Voluntary Arrangement") return "voluntary-arrangement";
  if (/receiv/i.test(text)) return "receivership";
  return "other";
}

/**
 * A 5-digit SIC2007 code from combined file text, or null. "None Supplied",
 * empty strings and legacy 4-digit SIC2003 codes ("4521 - …") all return
 * null: the first is an absence, the rest are a vocabulary our allowlist is
 * not written in, and none of them may match a filter.
 */
export function parseSicCode(value: string): string | null {
  const match = /^(\d{5})\b/.exec(value.trim());
  return match ? match[1] : null;
}

/**
 * A SIC field as code plus the file's own description ("86101 - Hospital
 * activities"), for the sic_label table. The title is display text only —
 * filtering always matches on the code.
 */
export function parseSicField(value: string): { code: string; title: string } | null {
  const text = value.trim();
  const code = parseSicCode(text);
  if (!code) return null;
  const title = text.replace(/^\d{5}\s+-\s*/, "");
  return { code, title: title === text ? "" : title };
}

/** DD/MM/YYYY (the file) to YYYY-MM-DD (the register), or null. */
export function parseIncorporationDate(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [, day, month, year] = match;
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) {
    return null;
  }
  return `${year}-${month}-${day}`;
}

/**
 * Whether a parsed row belongs in the register file: a Tier A legal form, a
 * CIC, a Tier C legal form, or a SIC code inside the build-time superset.
 * Everything else — ~88% of the register — is an ordinary commercial company
 * no filter on the import screen could want, and storing it would push the
 * file past what ships with the deployment.
 */
export function isCoveredCompany(
  categoryRaw: string,
  sicCodes: ReadonlySet<string> | readonly string[],
  sicSuperset: ReadonlySet<string>,
): boolean {
  if (TIER_A_CATEGORIES.has(categoryRaw)) return true;
  if (categoryRaw === CIC_CATEGORY) return true;
  if (TIER_C_CATEGORIES.has(categoryRaw)) return true;
  for (const code of sicCodes) {
    if (sicSuperset.has(code)) return true;
  }
  return false;
}

/** A parsed CSV record into the stored shape, or null when unusable. */
export function rowToExtractCompany(
  record: string[],
  header: CompaniesCsvHeader,
  postcodeAreaOf: (postcode: string | null | undefined) => string | null,
): ExtractCompany | null {
  const companyNumber = columnValue(record, header, "CompanyNumber");
  if (!companyNumber) return null;
  const companyName = columnValue(record, header, "CompanyName");
  if (!companyName) return null;

  const categoryRaw = columnValue(record, header, "CompanyCategory");
  const sicFields = [1, 2, 3, 4]
    .map((n) =>
      parseSicField(columnValue(record, header, `SICCode.SicText_${n}` as WantedColumn)),
    )
    .filter((field): field is { code: string; title: string } => field !== null);
  const sicCodes = [...new Set(sicFields.map((field) => field.code))];
  const sicTitles: Record<string, string> = {};
  for (const field of sicFields) {
    if (field.title && !(field.code in sicTitles)) sicTitles[field.code] = field.title;
  }

  const postcode = columnValue(record, header, "RegAddress.PostCode") || null;
  const statusRaw = columnValue(record, header, "CompanyStatus");

  return {
    companyNumber,
    companyName,
    categoryRaw,
    categorySlug: CATEGORY_TO_SLUG[categoryRaw] ?? "other",
    statusRaw,
    statusNorm: normalizeCompanyStatus(statusRaw),
    incorporationDate: parseIncorporationDate(columnValue(record, header, "IncorporationDate")),
    postcode,
    postcodeArea: postcodeAreaOf(postcode),
    town: columnValue(record, header, "RegAddress.PostTown") || null,
    addressLine1: columnValue(record, header, "RegAddress.AddressLine1") || null,
    sicCodes,
    sicTitles,
    isCic: categoryRaw === CIC_CATEGORY,
  };
}

// ── Streaming CSV records ──
//
// Company names and addresses contain commas, quotes and occasionally
// embedded newlines inside quoted fields, so records cannot be split on
// newlines first and parsed second. This is a small RFC 4180 reader fed
// with text chunks: push() accepts decoded text in any splits, onRecord
// fires once per complete record, end() flushes the tail. Malformed input
// (an unterminated quote at end of stream) is emitted as a final record
// rather than failing a 5-million-row pass.
//
// Line endings normalise to LF, including inside quoted addresses —
// harmless for what this file carries (towns and postcodes, not prose).

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);

export type CsvRecordCallback = (record: string[]) => void;

export function createCsvRecordStream(onRecord: CsvRecordCallback): {
  push: (chunk: string) => void;
  end: () => void;
} {
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let pendingCr = false;

  function emitField() {
    record.push(field);
    field = "";
  }

  function emitRecord() {
    onRecord(record);
    record = [];
  }

  // A quote just read inside a quoted section leaves an ambiguity — escaped
  // quote or closing quote — decided by the next character. quotePending
  // stashes it; the quoted section stays open until that character arrives.
  let quotePending = false;

  function consume(char: string) {
    if (quotePending) {
      quotePending = false;
      if (char === '"') {
        field += '"';
        return;
      }
      inQuotes = false;
      // Falls through: the character that closed the quotes is processed
      // as ordinary unquoted input below.
    }
    if (inQuotes) {
      if (char === '"') quotePending = true;
      else field += char;
      return;
    }
    if (char === '"') {
      // Quote opens a quoted section only at a field start; mid-field it is
      // literal (company names contain inches: 12" PIPE LTD).
      if (field === "") inQuotes = true;
      else field += char;
    } else if (char === ",") {
      emitField();
    } else if (char === LF || char === CR) {
      emitField();
      emitRecord();
    } else {
      field += char;
    }
  }

  return {
    push(chunk: string) {
      // A CRLF split across two chunks must not emit a phantom empty record:
      // a trailing CR is held back until the next chunk (or end()) decides it.
      let text = (pendingCr ? CR : "") + chunk;
      pendingCr = false;
      if (text.endsWith(CR)) {
        pendingCr = true;
        text = text.slice(0, -1);
      }
      text = text.split(CR + LF).join(LF).split(CR).join(LF);
      for (const char of text) consume(char);
    },
    end() {
      if (pendingCr) {
        pendingCr = false;
        consume(LF);
      }
      if (inQuotes || quotePending) {
        // Unterminated quote: a pending quote was a close, an open section
        // simply ends with the stream. Either way the field stands as read.
        quotePending = false;
        inQuotes = false;
      }
      if (field !== "" || record.length > 0) {
        emitField();
        emitRecord();
      }
    },
  };
}

/** One-shot parse for tests and small inputs. */
export function parseCsvText(text: string): string[][] {
  const records: string[][] = [];
  const stream = createCsvRecordStream((record) => records.push(record));
  stream.push(text);
  stream.end();
  return records;
}
