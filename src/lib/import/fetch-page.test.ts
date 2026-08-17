import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fetchPage, type PageFetchDependencies, type PageResponse } from "./fetch-page.ts";

function response(overrides: Partial<PageResponse> = {}): PageResponse {
  return {
    status: 200,
    location: null,
    contentType: "text/html; charset=utf-8",
    body: "<html><body>Hello</body></html>",
    truncated: false,
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<PageFetchDependencies> = {},
): PageFetchDependencies {
  return {
    resolve: async () => ["93.184.216.34"],
    request: async () => response(),
    ...overrides,
  };
}

describe("fetchPage", () => {
  it("returns the page and where the fetch ended up", async () => {
    const result = await fetchPage("https://example.org", dependencies());

    assert.equal(result.status, "fetched");
    assert.equal(result.status === "fetched" && result.finalUrl, "https://example.org/");
  });

  it("follows redirects and reports the destination as the final URL", async () => {
    const requested: string[] = [];
    const result = await fetchPage("https://example.org", dependencies({
      request: async (url) => {
        requested.push(url);
        return requested.length === 1
          ? response({ status: 301, location: "https://www.example.org/home" })
          : response();
      },
    }));

    assert.equal(result.status, "fetched");
    assert.equal(result.status === "fetched" && result.finalUrl, "https://www.example.org/home");
  });

  it("re-resolves each redirect hop rather than trusting the first check", async () => {
    const resolved: string[] = [];
    await fetchPage("https://example.org", dependencies({
      resolve: async (hostname) => {
        resolved.push(hostname);
        return ["93.184.216.34"];
      },
      request: async (url) =>
        url.includes("www.")
          ? response()
          : response({ status: 302, location: "https://www.example.org/" }),
    }));

    assert.deepEqual(resolved, ["example.org", "www.example.org"]);
  });

  it("refuses a redirect to a private address", async () => {
    const result = await fetchPage("https://example.org", dependencies({
      resolve: async (hostname) => (hostname === "example.org" ? ["93.184.216.34"] : ["127.0.0.1"]),
      request: async () => response({ status: 302, location: "http://internal.example.org/" }),
    }));

    assert.equal(result.status, "unreachable");
  });

  it("rejects a URL that never had a chance of being safe", async () => {
    for (const value of ["http://localhost/admin", "https://192.168.0.1/", "not a url"]) {
      const result = await fetchPage(value, dependencies());
      assert.equal(result.status, "invalid_url", value);
    }
  });

  it("asks for a website address when nothing was pasted", async () => {
    const result = await fetchPage("", dependencies());
    assert.equal(result.status, "invalid_url");
    assert.match(result.status === "invalid_url" ? result.message : "", /Enter the website address/);
  });

  it("never puts an HTTP status or a host error in the CAM's message", async () => {
    for (const status of [403, 404, 429, 500, 503]) {
      const result = await fetchPage("https://example.org", dependencies({
        request: async () => response({ status }),
      }));

      assert.equal(result.status, "unreachable");
      const message = result.status === "unreachable" ? result.message : "";
      assert.doesNotMatch(message, /\d{3}|HTTP|error|stack/i, `HTTP ${status}`);
    }
  });

  it("still records the real status for engineers", async () => {
    const logged: string[] = [];
    await fetchPage("https://example.org", dependencies({
      request: async () => response({ status: 503 }),
      onFailure: (error) => {
        logged.push(error instanceof Error ? error.message : String(error));
      },
    }));

    assert.deepEqual(logged, ["Import fetch returned HTTP 503"]);
  });

  it("rejects a response that is a file rather than a page", async () => {
    const result = await fetchPage("https://example.org/report.pdf", dependencies({
      request: async () => response({ contentType: "application/pdf" }),
    }));

    assert.equal(result.status, "not_html");
  });

  it("separates an empty page from an unreachable one", async () => {
    const result = await fetchPage("https://example.org", dependencies({
      request: async () => response({ body: "   \n  " }),
    }));

    assert.equal(result.status, "empty");
  });

  it("gives up rather than following a redirect loop forever", async () => {
    let hops = 0;
    const result = await fetchPage("https://example.org", dependencies({
      request: async () => {
        hops++;
        return response({ status: 302, location: `https://example.org/${hops}` });
      },
    }));

    assert.equal(result.status, "unreachable");
    assert.ok(hops <= 4, `stopped after ${hops} hops`);
  });

  it("turns a transport failure into a message, not an exception", async () => {
    const result = await fetchPage("https://example.org", dependencies({
      request: async () => {
        throw new Error("socket hang up");
      },
    }));

    assert.equal(result.status, "unreachable");
    assert.doesNotMatch(result.status === "unreachable" ? result.message : "", /socket/i);
  });

  it("logs a transport failure exactly once", async () => {
    const failures: unknown[] = [];
    await fetchPage("https://example.org", dependencies({
      request: async () => {
        throw new Error("socket hang up");
      },
      onFailure: (error) => {
        failures.push(error);
      },
    }));

    assert.equal(failures.length, 1);
  });

  it("keeps a truncated page, flagged", async () => {
    const result = await fetchPage("https://example.org", dependencies({
      request: async () => response({ truncated: true }),
    }));

    assert.equal(result.status === "fetched" && result.truncated, true);
  });
});
