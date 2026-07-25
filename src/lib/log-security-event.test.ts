import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { logSecurityEvent } from "./log-security-event.ts";

describe("logSecurityEvent", () => {
  it("logs the event name and metadata", () => {
    const errorMock = mock.method(console, "error", () => {});
    try {
      logSecurityEvent("validation.rejected", { form: "login", fields: "email" });

      assert.equal(errorMock.mock.calls.length, 1);
      const [, meta] = errorMock.mock.calls[0].arguments as [string, Record<string, unknown>];
      assert.equal(meta.event, "validation.rejected");
      assert.equal(meta.form, "login");
      assert.equal(meta.fields, "email");
    } finally {
      errorMock.mock.restore();
    }
  });

  it("defaults to no extra metadata", () => {
    const errorMock = mock.method(console, "error", () => {});
    try {
      logSecurityEvent("permission.denied");

      assert.equal(errorMock.mock.calls.length, 1);
      const [, meta] = errorMock.mock.calls[0].arguments as [string, Record<string, unknown>];
      assert.deepEqual(meta, { event: "permission.denied" });
    } finally {
      errorMock.mock.restore();
    }
  });
});
