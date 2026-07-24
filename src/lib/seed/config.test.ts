import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DB_URL_VAR,
  PRODUCTION_PROJECT_REF,
  STAGING_PROJECT_REF,
  SeedConfigError,
  SeedRefusedError,
  extractProjectRef,
  isProductionEnvironment,
  resolveSeedConfig,
} from "./config.ts";

const stagingUrl = `postgresql://postgres:pw@db.${STAGING_PROJECT_REF}.supabase.co:5432/postgres`;
const productionUrl = `postgresql://postgres:pw@db.${PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`;
const localUrl = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("extractProjectRef", () => {
  it("reads the ref from a direct connection host", () => {
    assert.equal(extractProjectRef(stagingUrl), STAGING_PROJECT_REF);
  });

  it("reads the ref from a pooler username", () => {
    const pooled = `postgresql://postgres.${STAGING_PROJECT_REF}:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres`;
    assert.equal(extractProjectRef(pooled), STAGING_PROJECT_REF);
  });

  it("returns undefined for a local database", () => {
    assert.equal(extractProjectRef(localUrl), undefined);
  });

  it("returns undefined rather than throwing on nonsense", () => {
    assert.equal(extractProjectRef("not a url"), undefined);
  });
});

describe("isProductionEnvironment", () => {
  it("detects NODE_ENV=production", () => {
    assert.equal(isProductionEnvironment({ NODE_ENV: "production" }), true);
  });

  it("detects VERCEL_ENV=production", () => {
    assert.equal(isProductionEnvironment({ VERCEL_ENV: "production" }), true);
  });

  it("is not fooled by preview or development", () => {
    assert.equal(
      isProductionEnvironment({ NODE_ENV: "development", VERCEL_ENV: "preview" }),
      false,
    );
  });
});

describe("resolveSeedConfig", () => {
  it("accepts staging", () => {
    const config = resolveSeedConfig({ [DB_URL_VAR]: stagingUrl });
    assert.equal(config.projectRef, STAGING_PROJECT_REF);
    assert.match(config.target, /180connect-staging/);
  });

  it("accepts a local database", () => {
    const config = resolveSeedConfig({ [DB_URL_VAR]: localUrl });
    assert.equal(config.projectRef, undefined);
    assert.equal(config.databaseUrl, localUrl);
  });

  it("refuses the production project even when the environment looks safe", () => {
    assert.throws(
      () => resolveSeedConfig({ NODE_ENV: "development", [DB_URL_VAR]: productionUrl }),
      SeedRefusedError,
    );
  });

  it("refuses a production environment even when the URL looks safe", () => {
    assert.throws(
      () => resolveSeedConfig({ NODE_ENV: "production", [DB_URL_VAR]: stagingUrl }),
      SeedRefusedError,
    );
  });

  it("never puts the connection string in the target banner", () => {
    const config = resolveSeedConfig({ [DB_URL_VAR]: stagingUrl });
    assert.equal(config.target.includes("pw"), false);
  });

  it("fails loudly when the variable is missing", () => {
    assert.throws(() => resolveSeedConfig({}), (error: unknown) => {
      assert.ok(error instanceof SeedConfigError);
      assert.match(error.message, new RegExp(DB_URL_VAR));
      assert.match(error.message, /required but not set/);
      return true;
    });
  });

  it("fails loudly when the variable is blank", () => {
    assert.throws(() => resolveSeedConfig({ [DB_URL_VAR]: "   " }), SeedConfigError);
  });

  it("rejects a connection string that is not postgres", () => {
    assert.throws(
      () => resolveSeedConfig({ [DB_URL_VAR]: "https://example.com/db" }),
      SeedConfigError,
    );
  });
});
