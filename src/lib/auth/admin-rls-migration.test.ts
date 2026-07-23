import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260723224500_create_users_and_admin_rls.sql",
  "utf8",
);

describe("USERS row-level access rules", () => {
  it("enables RLS and limits ordinary users to their own profile", () => {
    assert.match(migration, /alter table public\."USERS" enable row level security/i);
    assert.match(migration, /using \(id = auth\.uid\(\)\)/i);
  });

  it("requires the current database role to be admin for team reads and writes", () => {
    assert.match(migration, /admins_read_all_users[\s\S]*current_app_role\(\) = 'admin'/i);
    assert.match(migration, /admins_update_users[\s\S]*current_app_role\(\) = 'admin'/i);
  });

  it("does not grant CAM role updates", () => {
    assert.doesNotMatch(migration, /grant\s+update[\s\S]*\bcam\b/i);
  });
});
