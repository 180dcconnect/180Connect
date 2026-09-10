/**
 * Talking to Companies House: credentials, timeouts and the retry policy.
 *
 * Lifted out of companieshouse.ts unchanged when a second caller appeared. The
 * import adapter reads the JSON API; the CIC36 statement job
 * (src/lib/cic-statement/) reads the filing history from the same API and then
 * the filing itself from the Document API, which is a different host on the
 * same credentials. Two callers, one account, one rate limit — so they must
 * share a retry policy rather than each invent one, or a 429 earned by one is
 * paid for by the other with no coordination.
 *
 * Nothing here knows what it is fetching. Shaping a response is the caller's
 * job; this module's whole responsibility is that a request is authenticated,
 * bounded in time, and retried on the failures worth retrying.
 */

/** The JSON API: company profiles, search, filing history. */
export const COMPANIES_HOUSE_URL = "https://api.company-information.service.gov.uk";

/**
 * The document store, where a filing's actual bytes live. A separate host, and
 * deliberately a separate constant: the JSON API's `links.document_metadata`
 * already arrives as an absolute URL onto this host, so anything that joins a
 * path onto COMPANIES_HOUSE_URL to reach a document is a bug.
 */
export const COMPANIES_HOUSE_DOCUMENT_URL =
  "https://document-api.company-information.service.gov.uk";

export const REQUEST_TIMEOUT_MS = 15_000;
export const MAX_ATTEMPTS = 3;
export const RETRY_BASE_DELAY_MS = 1_000;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Basic auth with the API key as the username and an empty password — the
 * scheme Companies House documents. The trailing colon is not decorative: it is
 * the empty password, and dropping it produces a 401 that reads like a bad key.
 */
export function authenticationHeaders(): Record<string, string> {
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY?.trim();
  if (!apiKey) throw new Error("COMPANIES_HOUSE_API_KEY is not set.");
  return {
    Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
  };
}

/**
 * One request, retried on 429 and 5xx and on a network-level failure.
 *
 * A 4xx other than 429 comes straight back to the caller: a 404 for a company
 * that filed nothing is an answer, not a failure, and retrying it three times
 * would spend the rate limit learning the same thing twice more.
 *
 * `retry-after` is honoured when the server sends one, because the server knows
 * when it will next serve us and the backoff schedule is only a guess.
 */
export async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) return response;

      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfter = Number(retryAfterHeader);
      const delay = retryAfterHeader !== null && Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      console.warn(
        `[companies_house] ${response.status} on attempt ${attempt}, retrying in ${delay}ms`,
      );
      await sleep(delay);
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS) break;
      const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      console.warn(
        `[companies_house] request failed on attempt ${attempt}, retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Companies House request failed.");
}
