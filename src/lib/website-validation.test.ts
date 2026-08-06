import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkWebsite,
  isPrivateAddress,
  validateWebsiteFormat,
  type WebsiteCheckDependencies,
} from "./website-validation.ts";

const publicDns = async () => ["93.184.216.34"];

function dependencies(
  response: { status: number; location: string | null },
  resolve = publicDns,
): WebsiteCheckDependencies {
  return { resolve, request: async () => response };
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
    assert.equal(validateWebsiteFormat("http://[::1]/").status, "invalid");
    assert.equal(validateWebsiteFormat("http://[fc00::1]/").status, "invalid");
    assert.equal(isPrivateAddress("::ffff:169.254.169.254"), true);
    assert.equal(isPrivateAddress("::ffff:172.20.1.2"), true);
    assert.equal(isPrivateAddress("::ffff:100.100.1.2"), true);
  });
});

describe("checkWebsite", () => {
  it("marks a resolving successful website as reachable", async () => {
    const result = await checkWebsite(
      "https://example.org",
      dependencies({ status: 200, location: null }),
    );
    assert.equal(result.status, "reachable");
  });

  it("flags a hostname that does not resolve", async () => {
    const result = await checkWebsite(
      "https://missing.example",
      dependencies({ status: 200, location: null }, async () => []),
    );
    assert.equal(result.status, "unreachable");
  });

  it("flags a broken HTTP response", async () => {
    const result = await checkWebsite(
      "https://example.org",
      dependencies({ status: 404, location: null }),
    );
    assert.deepEqual(result, {
      status: "unreachable",
      url: "https://example.org/",
      message: "This website returned HTTP 404.",
    });
  });

  it("flags a conflicting redirect to a private destination", async () => {
    const requests: { url: string; address: string }[] = [];
    const result = await checkWebsite("https://example.org", {
      resolve: publicDns,
      request: async (url, address) => {
        requests.push({ url, address });
        return { status: 302, location: "http://127.0.0.1/admin" };
      },
    });
    assert.equal(result.status, "unreachable");
    assert.deepEqual(requests, [
      { url: "https://example.org/", address: "93.184.216.34" },
    ]);
  });

  it("pins the request to the exact public IP that passed validation", async () => {
    const requests: { url: string; address: string }[] = [];
    await checkWebsite("https://example.org", {
      resolve: async () => ["93.184.216.34"],
      request: async (url, address) => {
        requests.push({ url, address });
        return { status: 200, location: null };
      },
    });
    assert.deepEqual(requests, [
      { url: "https://example.org/", address: "93.184.216.34" },
    ]);
  });

  it("preserves the existing record when validation fails", async () => {
    const original = { legal_name: "Useful Charity", website: "https://broken.example" };
    await checkWebsite(original.website, {
      resolve: async () => {
        throw new Error("DNS unavailable");
      },
      request: async () => ({ status: 200, location: null }),
    });
    assert.deepEqual(original, {
      legal_name: "Useful Charity",
      website: "https://broken.example",
    });
  });
});
