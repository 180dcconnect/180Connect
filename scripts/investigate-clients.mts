const chApiKey = process.env.COMPANIES_HOUSE_API_KEY?.trim();

const chHeaders: Record<string, string> = chApiKey ? {
  Authorization: `Basic ${Buffer.from(`${chApiKey}:`).toString("base64")}`,
} : {};

type SearchCompanyItem = {
  title: string;
  company_number: string;
  company_type?: string;
  company_status?: string;
  address_snippet?: string;
};

type ReconcileResult = {
  id: string;
  name: string;
  score?: number;
  match?: boolean;
};

async function searchCompaniesHouse(name: string): Promise<SearchCompanyItem[]> {
  const url = `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(name)}&items_per_page=10`;
  const res = await fetch(url, { headers: chHeaders });
  if (!res.ok) return [];
  const json = (await res.json()) as { items?: SearchCompanyItem[] };
  return json.items || [];
}

async function searchCharityCommission(name: string): Promise<ReconcileResult[]> {
  const url = `https://findthatcharity.uk/reconcile?queries=${encodeURIComponent(JSON.stringify({ q0: { query: name } }))}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = (await res.json()) as { q0?: { result?: ReconcileResult[] } };
  return json.q0?.result || [];
}

async function investigateClient(clientQuery: string, extraTerms?: string[]) {
  console.log(`\n======================================================`);
  console.log(`INVESTIGATING: "${clientQuery}"`);
  console.log(`======================================================`);

  // 1. Charity search
  const charityResults = await searchCharityCommission(clientQuery);
  console.log(`\n[Charity Search Candidates]:`);
  for (const c of charityResults.slice(0, 3)) {
    console.log(` - ${c.name} (ID: ${c.id}, score: ${c.score}, match: ${c.match})`);
  }

  // 2. Companies House search
  const chResults = await searchCompaniesHouse(clientQuery);
  console.log(`\n[Companies House Candidates]:`);
  for (const c of chResults.slice(0, 5)) {
    console.log(` - ${c.title} (Number: ${c.company_number}, Type: ${c.company_type}, Status: ${c.company_status}, Address: ${c.address_snippet})`);
  }

  // Also check extra terms if provided
  if (extraTerms) {
    for (const term of extraTerms) {
      console.log(`\nSearching extra term: "${term}"`);
      const extraCh = await searchCompaniesHouse(term);
      for (const c of extraCh.slice(0, 3)) {
        console.log(` - [CH] ${c.title} (No: ${c.company_number}, Type: ${c.company_type}, Status: ${c.company_status}, Loc: ${c.address_snippet})`);
      }
      const extraCC = await searchCharityCommission(term);
      for (const c of extraCC.slice(0, 2)) {
        console.log(` - [CC] ${c.name} (ID: ${c.id})`);
      }
    }
  }
}

async function run() {
  await investigateClient("Always an alternative");
  await investigateClient("Decay", ["Decay Sheffield", "Decay CIC", "Decay youth"]);
  await investigateClient("Healthwatch Sheffield", ["Healthwatch", "Voluntary Action Sheffield"]);
  await investigateClient("Labres Hope", ["Labre's Hope"]);
  await investigateClient("Sheffield action on plastic", ["Action on plastic Sheffield", "Plastic Sheffield"]);
  await investigateClient("Sustainability learning cic", ["Sustainability learning"]);
  await investigateClient("The Link community", ["The Link Sheffield", "The Link Community Hub"]);
  await investigateClient("7Roadlight", ["7 Roadlight", "Roadlight"]);
  await investigateClient("Irise", ["Irise International"]);
  await investigateClient("MS therapy", ["Sheffield MS Therapy", "MS Therapy Sheffield", "South Yorkshire MS Therapy"]);
  await investigateClient("Sheffield Mind");
  await investigateClient("Tickets for Good", ["Tickets for Good Foundation"]);
}

await run();
