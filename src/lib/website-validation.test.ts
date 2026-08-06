import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkWebsite,
  isPrivateAddress,
  validateWebsiteFormat,
  type WebsiteCheckDependencies,
} from "./website-validation.ts";

const publicDns = async () => ["93.184.216.34"];

function dependencies(response: Response, resolve = publicDns): WebsiteCheckDependencies {
  return { resolve, fetch: async () => response };
}

describe("validateWebsiteFormat", () => {
  it("accepts a valid HTTPS website", () => {
    const result = validateWebsiteFormat(" https://example.org/path ");
    assert.equal(result.status, "valid");
    assert.equal(result.url, "https://example.org/path");
  });

  it("flags a malformed website without changing the original field", () => {
    const result = validateWebsiteFormat("example dot org");
    assert.equal(result.status, "invalid");
    assert.equal(result.url, "example dot org");
  });

  it("distinguishes a missing optional website", () => {
    assert.equal(validateWebsiteFormat(null).status, "missing");
  });

  it("blocks local and private destinations", () => {
    assert.equal(validateWebsiteFormat("http://localhost:54321").status, "invalid");
    assert.equal(validateWebsiteFormat("http://127.0.0.1").status, "invalid");
    assert.equal(isPrivateAddress("10.1.2.3"), true);
    assert.equal(isPrivateAddress("192.168.1.1"), true);
    assert.equal(isPrivateAddress("93.184.216.34"), false);
  });
});

describe("checkWebsite", () => {
  it("marks a resolving successful website as reachable", async () => {
    const result = await checkWebsite(
      "https://example.org",
      dependencies(new Response(null, { status: 200 })),
    );
    assert.equal(result.status, "reachable");
  });

  it("flags a hostname that does not resolve", async () => {
    const result = await checkWebsite(
      "https://missing.example",
      dependencies(new Response(null, { status: 200 }), async () => []),
    );
    assert.equal(result.status, "unreachable");
  });

  it("flags a broken HTTP response", async () => {
    const result = await checkWebsite(
      "https://example.org",
      dependencies(new Response(null, { status: 404 })),
    );
    assert.deepEqual(result, {
      status: "unreachable",
      url: "https://example.org/",
      message: "This website returned HTTP 404.",
    });
  });

  it("flags a conflicting redirect to a private destination", async () => {
    const fetches: string[] = [];
    const result = await checkWebsite("https://example.org", {
      resolve: publicDns,
      fetch: async (input) => {
        fetches.push(String(input));
        return new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/admin" },
        });
      },
    });
    assert.equal(result.status, "unreachable");
    assert.equal(fetches.length, 1);
  });

  it("preserves the existing record when validation fails", async () => {
    const original = { legal_name: "Useful Charity", website: "https://broken.example" };
    await checkWebsite(original.website, {
      resolve: async () => {
        throw new Error("DNS unavailable");
      },
      fetch: async () => new Response(null, { status: 200 }),
    });
    assert.deepEqual(original, {
      legal_name: "Useful Charity",
      website: "https://broken.example",
    });
  });
});
