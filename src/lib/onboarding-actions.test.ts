import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * F255 — the guarantees about the guide's Server Actions that neither of the other
 * two suites can see.
 *
 * The actions cannot be executed here: they carry "use server" and import
 * `next/cache`, which only resolves inside the bundler. Same constraint the
 * Companies House actions are tested under (actions-module.test.ts).
 *
 * That is why the work is split three ways. What each write *decides* is in
 * onboarding-writes.ts, exercised for real in onboarding-writes.test.ts. What the
 * database *permits* is in the policies, exercised for real by
 * supabase/tests/rls_policies.test.sql (`suite_onboarding`). What is left — that
 * this file wires those two together without a hole between them — is asserted
 * against the source here.
 */

const ACTIONS = "src/lib/onboarding-actions.ts";

describe("onboarding action module", () => {
  it("exports exactly the three guide actions", async () => {
    const source = await readFile(ACTIONS, "utf8");
    const exported = source.match(/export async function (\w+)/g) ?? [];

    assert.deepEqual(exported.sort(), [
      "export async function dismissGuideAction",
      "export async function finishGuideAction",
      "export async function recordOnboardingStepAction",
    ]);
  });

  it("looks the actor up itself on every write path", async () => {
    const source = await readFile(ACTIONS, "utf8");

    // A Server Action is a public endpoint regardless of which page renders it, so
    // one that trusted its caller would be reachable by anyone holding the action
    // id. Two call sites for three actions is correct here: the two guide-ending
    // actions share one helper.
    const actorChecks = source.match(/getCurrentActor\(/g) ?? [];
    assert.equal(actorChecks.length, 2);

    const guards = source.match(/if \(!authorization\.ok\) return \{ ok: false \}/g) ?? [];
    assert.equal(guards.length, 2, "every actor lookup is acted on");
  });

  it("takes no user id from the caller", async () => {
    const source = await readFile(ACTIONS, "utf8");

    // The id written or filtered on is always the one the server looked up. An
    // action that accepted a user id would be asking the policies to be the only
    // thing standing between a caller and someone else's row.
    assert.doesNotMatch(source, /export async function \w+\([^)]*userId/);
    assert.match(source, /authorization\.actor\.id/);
  });

  it("never reaches for the service-role client", async () => {
    const source = await readFile(ACTIONS, "utf8");

    // These writes are governed by RLS and a column grant (matrix §3.12). A
    // service-role client bypasses the policies that are the entire enforcement
    // here, and nothing about onboarding needs it.
    assert.doesNotMatch(source, /supabase\/admin|service_role|SERVICE_ROLE/);
    assert.match(source, /from "@\/lib\/supabase\/server"/);
  });

  it("keeps the first ending's timestamp", async () => {
    const source = await readFile(ACTIONS, "utf8");

    // The condition has to travel in the same statement as the write. A
    // read-then-write would let two clicks in flight produce two different answers
    // to "when did they end it".
    assert.match(source, /\.is\(column, null\)/);
  });

  it("reports write failures to ERROR_LOG rather than swallowing them", async () => {
    const source = await readFile(ACTIONS, "utf8");
    const reports = source.match(/reportError\(/g) ?? [];

    assert.equal(reports.length, 2, "both write paths report their own failures");
  });

  it("refreshes the dashboard after a successful write", async () => {
    const source = await readFile(ACTIONS, "utf8");
    const revalidations = source.match(/revalidatePath\("\/dashboard"\)/g) ?? [];

    // AC4: the tick has to be there when the CAM returns, without them reloading.
    assert.equal(revalidations.length, 2);
  });
});
