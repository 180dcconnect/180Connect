import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";

async function source(relative: string) {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

const SRC_ROOT = new URL("../../", import.meta.url);

/** Every non-test TypeScript source under src/, relative to src/. */
async function allSources(): Promise<Map<string, string>> {
  const paths = (await readdir(SRC_ROOT, { recursive: true })).filter(
    (p) => /\.(ts|tsx)$/.test(p) && !p.endsWith(".test.ts"),
  );
  return new Map(
    await Promise.all(
      paths.map(async (p) => [p.replaceAll("\\", "/"), await readFile(new URL(p, SRC_ROOT), "utf8")] as const),
    ),
  );
}

/**
 * The only files allowed to reach the Gmail transport. Anything else that
 * starts importing it — a new route, action, script, dependency graph drift —
 * fails this test before it can ship a hidden send path.
 */
const GMAIL_TRANSPORT_ALLOWLIST = new Set([
  "lib/gmail/branch-sender.ts",
  "lib/gmail/client.ts",
  "app/clients/[id]/outreach-actions.ts",
  "lib/outreach/scheduled-worker.ts",
]);

describe("F250 human-send architecture", () => {
  it("keeps Gmail transport out of every AI generation endpoint", async () => {
    const generationSources = await Promise.all([
      source("../../app/api/clients/[id]/booklet/route.ts"),
      source("../../app/api/clients/[id]/outreach-drafts/stage-one/route.ts"),
      source("../../app/api/clients/[id]/outreach-drafts/stage-two/route.ts"),
    ]);
    for (const text of generationSources) {
      assert.doesNotMatch(text, /sendBranchOutreach|sendGmailMessage|messages\/send/);
    }
  });

  it("requires the explicit review gate before the interactive send call", async () => {
    const action = await source("../../app/clients/[id]/outreach-actions.ts");
    assert.match(
      action,
      /humanReviewDecision\(\s*[^)]*explicitlyApproved,?\s*\)/,
    );
    assert.match(action, /sendBranchOutreach/);
    const lastGateCall = action.lastIndexOf("humanReviewDecision(");
    const sendCall = action.indexOf("await sendBranchOutreach({");
    assert.ok(sendCall > -1, "the interactive send call site must exist");
    assert.ok(lastGateCall > -1, "a review-gate call site must exist");
    assert.ok(lastGateCall < sendCall, "every review-gate call must precede the Gmail send call");
  });

  it("makes the deliberate control unambiguous to the CAM", async () => {
    const editor = await source("../../app/clients/[id]/compose-button.tsx");
    assert.match(editor, /Send reviewed email/);
    assert.match(editor, /I have reviewed the recipient, subject and body/);
  });

  it("cron delivery only ever picks up rows whose status proves prior human approval", async () => {
    const worker = await source("../../lib/outreach/scheduled-worker.ts");
    const entryStart = worker.indexOf("export async function sendDueReviewedEmails");
    assert.ok(entryStart > -1, "the cron entry point must exist");
    const entry = worker.slice(entryStart);
    const loadDue = entry.slice(entry.indexOf("async loadDue"), entry.indexOf("async isSuppressed"));
    const claim = entry.slice(entry.indexOf("async claim("), entry.indexOf("async deliver("));
    const markSent = entry.slice(entry.indexOf("async markSent("));
    assert.match(
      loadDue,
      /\.eq\("send_status", "scheduled"\)/,
      "loadDue must be conditioned on send_status='scheduled'",
    );
    // F128: the claim itself moved into an audited service-role RPC (so the
    // branch-wide daily cap can be enforced atomically alongside it — see
    // that migration's header) — so the scheduled-only condition is pinned
    // THERE, not in this adapter.
    assert.match(
      claim,
      /claim_scheduled_outreach_send/,
      "the worker must claim deliveries through the atomic F128/F129 RPC",
    );
    // F157: the recordal itself moved into the audited service-role RPC — so
    // the scheduled-only condition must be pinned THERE, not in this adapter.
    assert.match(
      markSent,
      /mark_scheduled_outreach_delivered/,
      "the worker must record deliveries through the audited F157 RPC",
    );
    const rpcMigration = await readFile(
      new URL(
        "../../../supabase/migrations/20260909090000_atomic_send_status.sql",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(rpcMigration, /send_claimed_at = p_claim_token/, "the RPC must stay pinned to the claiming run's token");
    const claimMigration = await readFile(
      new URL(
        "../../../supabase/migrations/20260913100100_enforce_daily_send_limit_atomically.sql",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(
      claimMigration,
      /and\s+send_status\s*=\s*'scheduled'/,
      "the claim RPC must stay conditioned on send_status='scheduled'",
    );
    assert.doesNotMatch(
      worker,
      /\.eq\(\s*"send_status"\s*,\s*"draft"\s*\)/,
      "the cron worker must never touch draft rows",
    );
  });

  it("keeps the Gmail send surface limited to the reviewed-send call sites", async () => {
    const sources = await allSources();
    const offenders: string[] = [];
    for (const [path, text] of sources) {
      if (!GMAIL_TRANSPORT_ALLOWLIST.has(path) && /gmail\/(branch-sender|client)(\.ts)?["']/.test(text)) {
        offenders.push(path);
      }
    }
    assert.deepEqual(offenders, [], "only the interactive send action, the cron worker and the transport itself may reach Gmail");
  });
});
