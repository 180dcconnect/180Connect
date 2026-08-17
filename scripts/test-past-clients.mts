import { classifyCompaniesHouseTier } from "../src/lib/ingestion/sources/companies-house-criteria-config.ts";
import { checkClientCriteria } from "../src/lib/client-criteria.ts";
import { standardizeCompaniesHouseRecord, classifyCompaniesHouseSourceConfidence } from "../src/lib/standardize/companies-house.ts";
import { standardizeCharityCommissionRecord } from "../src/lib/standardize/charity-commission.ts";
import { reconcileOne } from "../src/lib/ingestion/sources/find_that_charity.ts";

const clientNames = [
  "Always an alternative",
  "Decay",
  "Healthwatch Sheffield",
  "Labres Hope",
  "Sheffield action on plastic",
  "Sustainability learning cic",
  "The Link community",
  "7Roadlight",
  "Irise",
  "MS therapy",
  "Sheffield Mind",
  "Tickets for Good"
];

const chApiKey = process.env.COMPANIES_HOUSE_API_KEY?.trim();
const ccApiKey = process.env.CHARITY_COMMISSION_API_KEY?.trim();

const chHeaders: Record<string, string> = chApiKey ? {
  Authorization: `Basic ${Buffer.from(`${chApiKey}:`).toString("base64")}`,
} : {};

const ccHeaders: Record<string, string> = ccApiKey ? {
  "Ocp-Apim-Subscription-Key": ccApiKey,
} : {};

async function searchCompaniesHouse(name: string) {
  try {
    const url = `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(name)}&items_per_page=5`;
    const res = await fetch(url, { headers: chHeaders });
    if (!res.ok) return { error: `CH returned ${res.status}` };
    const json = await res.json();
    return { items: json.items || [] };
  } catch (err: any) {
    return { error: err.message };
  }
}

async function getCompanyProfile(companyNumber: string) {
  try {
    const url = `https://api.company-information.service.gov.uk/company/${encodeURIComponent(companyNumber)}`;
    const res = await fetch(url, { headers: chHeaders });
    if (!res.ok) return { error: `CH returned ${res.status}` };
    return await res.json();
  } catch (err: any) {
    return { error: err.message };
  }
}

async function getCharityDetails(regNumber: string) {
  try {
    const url = `https://api.charitycommission.gov.uk/register/api/charitydetailsmulti/${encodeURIComponent(regNumber)}`;
    const res = await fetch(url, { headers: ccHeaders });
    if (!res.ok) return { error: `CC returned ${res.status}` };
    const json = await res.json();
    return Array.isArray(json) && json.length > 0 ? json[0] : null;
  } catch (err: any) {
    return { error: err.message };
  }
}

async function run() {
  const detailedResults = [];

  for (const name of clientNames) {
    console.log(`\n========================================\nAnalyzing: "${name}"\n========================================`);
    
    // 1. Reconcile with Find That Charity (often finds charity numbers)
    let ftc = null;
    try {
      ftc = await reconcileOne(name);
    } catch (e: any) {
      console.log("FTC error:", e.message);
    }

    // 2. Search Companies House
    const chSearch = await searchCompaniesHouse(name);
    const topChItems = chSearch.items || [];
    let chProfile = null;
    if (topChItems.length > 0) {
      // Pick best match or first active
      const best = topChItems.find((i: any) => i.company_status === "active") || topChItems[0];
      if (best.company_number) {
        chProfile = await getCompanyProfile(best.company_number);
      }
    }

    // 3. Charity Commission check
    let ccDetails = null;
    let charityNumber = null;
    if (ftc && ftc.id) {
      const match = ftc.id.match(/\d+/);
      if (match) {
        charityNumber = match[0];
        ccDetails = await getCharityDetails(charityNumber);
      }
    }

    // Also check if CH profile or search points to a charity or if name search on CC works
    let chTier = null;
    let chCriteria = null;
    let chStandard = null;
    if (chProfile && !chProfile.error) {
      chTier = classifyCompaniesHouseTier(chProfile);
      const sourceConfidence = classifyCompaniesHouseSourceConfidence(chProfile);
      chStandard = standardizeCompaniesHouseRecord(chProfile);
      chCriteria = checkClientCriteria({
        organisationType: chStandard.organisation_type,
        city: chStandard.city,
        postcode: chStandard.postcode,
        countryCode: chStandard.country_code,
        geographicReach: chStandard.geographic_reach,
        sector: null,
        mission: null,
        sourceConfidence,
      });
    }

    let ccCriteria = null;
    let ccStandard = null;
    if (ccDetails && !ccDetails.error) {
      ccStandard = standardizeCharityCommissionRecord(ccDetails);
      ccCriteria = checkClientCriteria({
        organisationType: ccStandard.organisation_type,
        city: ccStandard.city,
        postcode: ccStandard.postcode,
        countryCode: ccStandard.country_code,
        geographicReach: ccStandard.geographic_reach,
        sector: null,
        mission: null,
      });
    }

    const itemResult = {
      name,
      ftc,
      chSearch: topChItems.slice(0, 3).map((i: any) => ({
        title: i.title,
        company_number: i.company_number,
        company_type: i.company_type,
        company_status: i.company_status,
        address: i.address_snippet,
      })),
      chProfile: chProfile && !chProfile.error ? {
        company_name: chProfile.company_name,
        company_number: chProfile.company_number,
        type: chProfile.type,
        subtype: chProfile.subtype,
        status: chProfile.company_status,
        sic_codes: chProfile.sic_codes,
        locality: chProfile.registered_office_address?.locality,
        postal_code: chProfile.registered_office_address?.postal_code,
        tier: chTier,
        criteriaOutcome: chCriteria?.outcome,
        priority: chCriteria?.priority,
        reasons: chCriteria?.reasons,
        completeness: chStandard?.data_completeness_score,
      } : null,
      ccDetails: ccDetails && !ccDetails.error ? {
        charity_name: ccDetails.charity_name,
        reg_charity_number: ccDetails.reg_charity_number,
        reg_status: ccDetails.reg_status,
        charity_type: ccDetails.charity_type,
        postcode: ccDetails.address_post_code,
        email: ccDetails.email,
        phone: ccDetails.phone,
        web: ccDetails.web,
        criteriaOutcome: ccCriteria?.outcome,
        priority: ccCriteria?.priority,
        reasons: ccCriteria?.reasons,
        completeness: ccStandard?.data_completeness_score,
      } : null,
    };

    console.log("Result summary:", JSON.stringify(itemResult, null, 2));
    detailedResults.push(itemResult);
  }

  return detailedResults;
}

run();
