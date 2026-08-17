import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkWebsite,
  isPrivateAddress,
  validateWebsiteFormat,
  type WebsiteCheckDependencies,
} from "./website-validation.ts";
import { pinnedLookup } from "./website-reachability.ts";

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

  it("calls onFailure exactly once when DNS throws", async () => {
    // Regression: before the fix, an exception in the try block would fire onFailure
    // inside the catch block, then fall through and fire it again with the misleading
    // "redirect limit" message below the try/catch.
    const failures: string[] = [];
    const result = await checkWebsite("https://example.org", {
      resolve: async () => {
        throw new Error("DNS unavailable");
      },
      request: async () => ({ status: 200, location: null }),
      onFailure: async (error) => {
        failures.push(error instanceof Error ? error.message : String(error));
      },
    });
    assert.equal(result.status, "unreachable");
    assert.equal(failures.length, 1, "onFailure must be called exactly once");
    assert.equal(failures[0], "DNS unavailable");
  });
});

describe("pinnedLookup", () => {
  it("handles the 3-argument call shape with { all: true }", () => {
    const lookup = pinnedLookup("93.184.216.34", 4);
    let result: unknown;
    lookup("example.org", { all: true }, (err, addresses) => {
      assert.equal(err, null);
      result = addresses;
    });
    assert.deepEqual(result, [{ address: "93.184.216.34", family: 4 }]);
  });

  it("handles the 3-argument call shape without all", () => {
    const lookup = pinnedLookup("93.184.216.34", 4);
    let resolvedAddress: string | undefined;
    let resolvedFamily: number | undefined;
    lookup("example.org", {}, (err, address, family) => {
      assert.equal(err, null);
      resolvedAddress = address as string;
      resolvedFamily = family;
    });
    assert.equal(resolvedAddress, "93.184.216.34");
    assert.equal(resolvedFamily, 4);
  });

  it("handles the 2-argument (hostname, callback) call shape", () => {
    const lookup = pinnedLookup("2606:2800:220:1:248:1893:25c8:1946", 6);
    let resolvedAddress: string | undefined;
    let resolvedFamily: number | undefined;
    // Calling with 2 args: lookup(hostname, callback)
    (lookup as unknown as (hostname: string, cb: (err: null, addr: string, fam: number) => void) => void)(
      "example.org",
      (err, address, family) => {
        assert.equal(err, null);
        resolvedAddress = address;
        resolvedFamily = family;
      },
    );
    assert.equal(resolvedAddress, "2606:2800:220:1:248:1893:25c8:1946");
    assert.equal(resolvedFamily, 6);
  });
});
