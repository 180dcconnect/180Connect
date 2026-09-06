import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CATEGORY_TO_SLUG,
  CIC_CATEGORY,
  columnValue,
  createCsvRecordStream,
  indexCsvHeader,
  isCoveredCompany,
  normalizeCompanyStatus,
  parseCsvText,
  parseIncorporationDate,
  parseSicCode,
  parseSicField,
  rowToExtractCompany,
  TIER_A_CATEGORIES,
  TIER_C_CATEGORIES,
} from "./csv-row.ts";

const HEADER = [
  "CompanyName",
  " CompanyNumber",
  "RegAddress.CareOf",
  "RegAddress.POBox",
  "RegAddress.AddressLine1",
  " RegAddress.AddressLine2",
  "RegAddress.PostTown",
  "RegAddress.County",
  "RegAddress.Country",
  "RegAddress.PostCode",
  "CompanyCategory",
  "CompanyStatus",
  "CountryOfOrigin",
  "DissolutionDate",
  "IncorporationDate",
  "Accounts.AccountRefDay",
  "Accounts.AccountRefMonth",
  "Accounts.NextDueDate",
  "Accounts.LastMadeUpDate",
  "Accounts.AccountCategory",
  "Returns.NextDueDate",
  "Returns.LastMadeUpDate",
  "Mortgages.NumMortCharges",
  "Mortgages.NumMortOutstanding",
  "Mortgages.NumMortPartSatisfied",
  "Mortgages.NumMortSatisfied",
  "SICCode.SicText_1",
  "SICCode.SicText_2",
  "SICCode.SicText_3",
  "SICCode.SicText_4",
  "LimitedPartnerships.NumGenPartners",
  "LimitedPartnerships.NumLimPartners",
  "URI",
];

function recordOf(values: Record<string, string>): string[] {
  const header = indexCsvHeader(HEADER);
  const record = new Array<string>(HEADER.length).fill("");
  for (const [name, value] of Object.entries(values)) {
    record[header.indexByName.get(name.trim()) ?? -1] = value;
  }
  return record;
}

describe("indexCsvHeader", () => {
  it("trims the file's padded header names", () => {
    const header = indexCsvHeader(HEADER);
    assert.equal(columnValue(["x"], header, "CompanyName"), "x");
  });

  it("refuses a header with a missing column", () => {
    assert.throws(() => indexCsvHeader(["CompanyName"]), /missing columns/);
  });
});

describe("CATEGORY_TO_SLUG", () => {
  // Census of the September 2026 file, part 1: every wording present must map
  // somewhere deliberate. An unmapped wording is a build failure, not a test
  // gap — this test pins the census so a new wording breaks loudly here too.
  it("covers every category wording in the file", () => {
    const census = [
      "Private Limited Company",
      "PRI/LTD BY GUAR/NSC (Private, limited by guarantee, no share capital)",
      "Limited Partnership",
      "Limited Liability Partnership",
      "Community Interest Company",
      "Charitable Incorporated Organisation",
      "Overseas Entity",
      "PRI/LBG/NSC (Private, Limited by guarantee, no share capital, use of 'Limited' exemption)",
      "Other company type",
      "Registered Society",
      "Scottish Charitable Incorporated Organisation",
      "Public Limited Company",
      "Private Unlimited Company",
      "Royal Charter Company",
      "Investment Company with Variable Capital",
      "Scottish Partnership",
      "Industrial and Provident Society",
      "United Kingdom Economic Interest Grouping",
      "Old Public Company",
      "Investment Company with Variable Capital(Umbrella)",
      "Private Unlimited",
      "United Kingdom Societas",
      "Investment Company with Variable Capital (Securities)",
      "PRIV LTD SECT. 30 (Private limited company, section 30 of the Companies Act)",
      "Converted/Closed",
      "Protected Cell Company",
    ];
    for (const wording of census) {
      assert.ok(
        typeof CATEGORY_TO_SLUG[wording] === "string" && CATEGORY_TO_SLUG[wording] !== "",
        `unmapped category: ${wording}`,
      );
    }
    assert.equal(CATEGORY_TO_SLUG["Private Limited Company"], "ltd");
    assert.equal(
      CATEGORY_TO_SLUG["Charitable Incorporated Organisation"],
      "charitable-incorporated-organisation",
    );
    assert.equal(CATEGORY_TO_SLUG[CIC_CATEGORY], "community-interest-company");
    assert.equal(CATEGORY_TO_SLUG["Royal Charter Company"], "royal-charter");
    assert.equal(CATEGORY_TO_SLUG["Other company type"], "other");
  });
});

describe("normalizeCompanyStatus", () => {
  it("maps display text to the API vocabulary", () => {
    assert.equal(normalizeCompanyStatus("Active"), "active");
    assert.equal(normalizeCompanyStatus("Active - Proposal to Strike off"), "active");
    assert.equal(normalizeCompanyStatus("Liquidation"), "liquidation");
    assert.equal(normalizeCompanyStatus("In Administration"), "administration");
    assert.equal(normalizeCompanyStatus("In Administration/Administrative Receiver"), "administration");
    assert.equal(normalizeCompanyStatus("Voluntary Arrangement"), "voluntary-arrangement");
    assert.equal(normalizeCompanyStatus("RECEIVERSHIP"), "receivership");
    assert.equal(normalizeCompanyStatus("Live but Receiver Manager on at least one charge"), "receivership");
    assert.equal(normalizeCompanyStatus("Something New"), "other");
  });
});

describe("parseSicCode", () => {
  it("keeps 5-digit SIC2007 codes", () => {
    assert.equal(parseSicCode("86101 - Hospital activities"), "86101");
    assert.equal(parseSicCode("99999 - Dormant Company"), "99999");
  });

  it("drops absences and legacy 4-digit codes", () => {
    assert.equal(parseSicCode("None Supplied"), null);
    assert.equal(parseSicCode(""), null);
    // SIC2003-era: our allowlist is SIC2007, so these must never match.
    assert.equal(parseSicCode("4521 - Gen construction & civil engineer"), null);
    assert.equal(parseSicCode("7499 - Non-trading company"), null);
  });
});

describe("parseSicField", () => {
  it("keeps the code and the file's own description", () => {
    assert.deepEqual(parseSicField("86101 - Hospital activities"), {
      code: "86101",
      title: "Hospital activities",
    });
  });

  it("drops absences and legacy codes", () => {
    assert.equal(parseSicField("None Supplied"), null);
    assert.equal(parseSicField("4521 - Gen construction & civil engineer"), null);
  });
});

describe("parseIncorporationDate", () => {
  it("converts DD/MM/YYYY to ISO", () => {
    assert.equal(parseIncorporationDate("11/09/2012"), "2012-09-11");
  });

  it("returns null for anything else", () => {
    assert.equal(parseIncorporationDate(""), null);
    assert.equal(parseIncorporationDate("2012-09-11"), null);
    assert.equal(parseIncorporationDate("99/99/2012"), null);
  });
});

describe("isCoveredCompany", () => {
  const superset = new Set(["86101", "88910"]);

  it("keeps Tier A, CIC and Tier C forms regardless of SIC", () => {
    for (const category of [...TIER_A_CATEGORIES, CIC_CATEGORY, ...TIER_C_CATEGORIES]) {
      assert.equal(isCoveredCompany(category, [], superset), true, category);
    }
  });

  it("keeps an ordinary company only on a SIC hit", () => {
    assert.equal(isCoveredCompany("Private Limited Company", ["86101"], superset), true);
    assert.equal(isCoveredCompany("Private Limited Company", ["99999"], superset), false);
    assert.equal(isCoveredCompany("Private Limited Company", [], superset), false);
  });
});

describe("rowToExtractCompany", () => {
  it("maps a CIC row to the stored shape", () => {
    const header = indexCsvHeader(HEADER);
    const company = rowToExtractCompany(
      recordOf({
        CompanyName: "Example CIC",
        " CompanyNumber": "12345678",
        "CompanyCategory": "Community Interest Company",
        "CompanyStatus": "Active",
        "IncorporationDate": "01/02/2020",
        "RegAddress.PostCode": "S1 2HE",
        "RegAddress.PostTown": "Sheffield",
        "RegAddress.AddressLine1": "1 Example Street",
        "SICCode.SicText_1": "88990 - Other social work",
      }),
      header,
      (postcode) => (postcode ? "S" : null),
    );
    assert.ok(company);
    assert.equal(company.companyNumber, "12345678");
    assert.equal(company.isCic, true);
    assert.equal(company.statusNorm, "active");
    assert.equal(company.incorporationDate, "2020-02-01");
    assert.equal(company.postcodeArea, "S");
    assert.equal(company.addressLine1, "1 Example Street");
    assert.deepEqual(company.sicCodes, ["88990"]);
    assert.deepEqual(company.sicTitles, { "88990": "Other social work" });
  });

  it("rejects rows without a number or name", () => {
    const header = indexCsvHeader(HEADER);
    assert.equal(
      rowToExtractCompany(recordOf({ CompanyName: "No Number" }), header, () => null),
      null,
    );
    assert.equal(
      rowToExtractCompany(recordOf({ " CompanyNumber": "123" }), header, () => null),
      null,
    );
  });
});

describe("createCsvRecordStream", () => {
  it("handles quoted commas, escaped quotes and embedded newlines", () => {
    const records = parseCsvText(
      'a,"b, c","d""e"\n"line1\nline2",f\n',
    );
    assert.deepEqual(records, [
      ["a", "b, c", 'd"e'],
      ["line1\nline2", "f"],
    ]);
  });

  it("treats CRLF as one ending, even split across chunks", () => {
    const seen: string[][] = [];
    const stream = createCsvRecordStream((record) => seen.push(record));
    stream.push("a,b\r");
    stream.push("\nc,d\r\n");
    stream.end();
    assert.deepEqual(seen, [
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps a mid-field quote literal", () => {
    assert.deepEqual(parseCsvText('12" PIPE LTD,123\n'), [["12\" PIPE LTD", "123"]]);
  });

  it("emits an unterminated tail rather than dropping it", () => {
    assert.deepEqual(parseCsvText("a,b\nc"), [
      ["a", "b"],
      ["c"],
    ]);
  });
});
