// the following code acts like an adpater with the shaping function to get the data from the API endpoint and shape it to the CommonRecord interface defined by F038 structuring
//code

// the following code does not work ATM

const CHARITYBASE_URL = "https://charitybase.uk/api/graphql"; //graphql endpoint for charitybase API

// GraphQL query to fetch charity data from CharityBase API
const QUERY = `
  {
    CHC {
      getCharities(filters: {}) {
        list {
          id
          names { value }
        }
      }
    }
  }
`;

// Function to fetch data from CharityBase API and shape it into CommonRecord format --> testing
export async function fetchFromCharityBase() {
  const res = await fetch(CHARITYBASE_URL, {
    method: "POST",
    headers: {
      Authorization: `Apikey ${process.env.CHARITYBASE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: QUERY }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    console.log("CharityBase error body:", errorBody);
    throw new Error(`CharityBase API returned ${res.status}`);
  }

  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
  return json.data.CHC.getCharities.list;
}
