import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, describe, it } from "node:test";
import type { AddressInfo } from "node:net";

import { requestPinned } from "./website-reachability.ts";

/**
 * HEAD-refusing hosts (live case: http://www.cads-online.org/ answers HEAD
 * 405 behind AWS ELB while GET serves 200). requestPinned must retry the same
 * pinned address with GET rather than reporting the row unreachable.
 */
describe("requestPinned HEAD fallback", () => {
  const servers: Server[] = [];
  after(() => Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve)))));

  async function localUrl(handler: (method: string | undefined) => { status: number; location?: string }): Promise<string> {
    const server = createServer((req, res) => {
      const verdict = handler(req.method);
      if (verdict.location) res.setHeader("location", verdict.location);
      res.writeHead(verdict.status, { "content-type": "text/html" });
      res.end("<p>hello</p>");
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  }

  it("retries with GET when HEAD is refused with 405", async () => {
    const url = await localUrl((method) => (method === "HEAD" ? { status: 405 } : { status: 200 }));
    const result = await requestPinned(url, "127.0.0.1");
    assert.equal(result.status, 200);
  });

  it("retries with GET when HEAD is refused with 501", async () => {
    const url = await localUrl((method) => (method === "HEAD" ? { status: 501 } : { status: 200 }));
    const result = await requestPinned(url, "127.0.0.1");
    assert.equal(result.status, 200);
  });

  it("reports the GET verdict when both methods disagree", async () => {
    const url = await localUrl((method) => (method === "HEAD" ? { status: 405 } : { status: 404 }));
    const result = await requestPinned(url, "127.0.0.1");
    assert.equal(result.status, 404);
  });

  it("does not retry other statuses", async () => {
    const url = await localUrl(() => ({ status: 404 }));
    const result = await requestPinned(url, "127.0.0.1");
    assert.equal(result.status, 404);
  });
});
