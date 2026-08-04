/**
 * Proves matrix §6 gap 7 is actually closed (F012): admins racing each other — one
 * demoting the other via `set_user_role` while the second suspends the first via
 * `set_user_active`, or deactivates them via `deactivate_user` — must never jointly
 * commit to zero active admins.
 *
 *     npm run verify:last-admin
 *
 * WHY THIS CANNOT BE A pgTAP TEST. supabase/tests/rls_policies.test.sql runs single
 * session, single transaction. The guard's "would this hit zero?" branch is only
 * ever reachable when a second transaction is genuinely racing the first — a
 * sequential, legitimately-authorised call can never trigger it by itself, because
 * reaching the guard means the caller passed is_admin() and is not the target, so
 * the caller always survives a solo call (see the migration's own comment,
 * supabase/migrations/20260804153000_last_admin_guard.sql). Proving the race is
 * closed needs two real, concurrently-open connections — this script opens them
 * directly with `pg`, the same way scripts/seed.mts does, and impersonates two
 * different admins the same way supabase/tests/rls_policies.test.sql's
 * tests.login_as() does (`request.jwt.claims` + `set local role authenticated`),
 * so both calls go through the RPCs' own SECURITY DEFINER authorisation exactly as
 * PostgREST would run them, not as a superuser bypassing it.
 *
 * LOCAL DATABASES ONLY, and not only out of caution. The fixtures are `auth.users`
 * rows written by raw SQL, which is the shape that has broken sign-in project-wide
 * before now. On a throwaway local stack that costs nothing; on staging it is a
 * shared outage waiting for the one run that gets killed between seeding and
 * cleanup. `resolveSeedConfig` refuses production; this refuses anything carrying a
 * project ref at all, which is every hosted project.
 */

import { Client } from "pg";
import { resolveSeedConfig } from "../src/lib/seed/config.ts";

const ADMIN_A = "00000000-0000-4000-e000-000000000001";
const ADMIN_B = "00000000-0000-4000-e000-000000000002";
const FIXTURE_IDS = [ADMIN_A, ADMIN_B];

const failures: string[] = [];

function check(description: string, condition: boolean): void {
  if (condition) {
    console.log(`  ok — ${description}`);
  } else {
    console.log(`  FAIL — ${description}`);
    failures.push(description);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Mirrors tests.login_as() in supabase/tests/rls_policies.test.sql. */
async function impersonate(client: Client, userId: string): Promise<void> {
  await client.query("begin");
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await client.query("set local role authenticated");
}

/**
 * Two active admins and nothing else. Idempotent, so each race restarts from the same
 * state without tearing the fixtures down in between. `is_seed` per F233 AC4: every
 * row a script writes stays sweepable by `npm run seed:clear`, which matters precisely
 * in the case where cleanup never ran.
 */
async function seedTwoAdmins(admin: Client): Promise<void> {
  await admin.query("begin");
  await admin.query(
    `insert into auth.users (id, instance_id, aud, role, email)
     values
       ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'verify-last-admin-a@180dc.org'),
       ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'verify-last-admin-b@180dc.org')
     on conflict (id) do nothing`,
    [ADMIN_A, ADMIN_B],
  );
  await admin.query(
    `insert into public.users (id, email, full_name, role, is_active, is_seed)
     values
       ($1, 'verify-last-admin-a@180dc.org', 'Verify Admin A', 'admin', true, true),
       ($2, 'verify-last-admin-b@180dc.org', 'Verify Admin B', 'admin', true, true)
     on conflict (id) do update
       set role = 'admin', is_active = true, deactivated_at = null, is_seed = true`,
    [ADMIN_A, ADMIN_B],
  );
  await admin.query("commit");
}

async function cleanup(admin: Client): Promise<void> {
  // Cascades to public.users; audit_log.actor_user_id is ON DELETE SET NULL, so
  // this cannot be blocked by rows the run itself wrote.
  await admin
    .query("delete from auth.users where id = any($1)", [FIXTURE_IDS])
    .catch((error) => {
      console.error("[verify-last-admin-guard] cleanup failed:", error);
    });
}

type PgError = { message?: string; hint?: string };

/**
 * One race, always the same shape: connection A demotes admin B via `set_user_role`
 * and holds the guard's lock uncommitted, while connection B tries to remove admin A
 * through `callB`. B must block on the lock, then be refused once A commits.
 *
 * `label` names the door B comes through. Every RPC that writes `users.role` or
 * `users.is_active` needs a row here, or the race simply relocates to the one that
 * has none — which is exactly how `deactivate_user` was missed the first time.
 */
async function race(
  admin: Client,
  connA: Client,
  connB: Client,
  label: string,
  callB: string,
): Promise<void> {
  console.log(`\n[verify-last-admin-guard] === set_user_role vs ${label} ===`);
  await seedTwoAdmins(admin);
  await impersonate(connA, ADMIN_A);
  await impersonate(connB, ADMIN_B);

  console.log(
    "[verify-last-admin-guard] connection A demotes admin B via set_user_role " +
      "(holds the advisory lock, uncommitted)...",
  );
  await connA.query("select public.set_user_role($1, 'cam')", [ADMIN_B]);

  console.log(
    `[verify-last-admin-guard] connection B concurrently removes admin A via ${label} ` +
      "(should block on the same lock)...",
  );
  let bSettled = false;
  const pendingB = connB.query(callB, [ADMIN_A]).finally(() => {
    bSettled = true;
  });

  await sleep(300);
  check(
    `${label}: connection B is still blocked 300ms later — the two calls actually serialized, not just happened to run safely by luck`,
    !bSettled,
  );

  console.log("[verify-last-admin-guard] committing connection A...");
  await connA.query("commit");

  // Commit B on success and roll back only on failure — an unconditional rollback
  // would undo the very state corruption this script exists to catch, making the
  // final admin-count check pass whether or not the guard actually worked.
  let bError: PgError | null = null;
  try {
    await pendingB;
    await connB.query("commit");
  } catch (error) {
    bError = error as PgError;
    await connB.query("rollback").catch(() => {});
  }

  check(`${label}: connection B was refused, not silently applied`, bError !== null);
  check(
    `${label}: the refusal carries the last_admin hint`,
    bError?.hint === "last_admin",
  );

  const { rows } = await admin.query<{ count: string }>(
    `select count(*) as count from public.users
      where role = 'admin' and is_active and id = any($1)`,
    [FIXTURE_IDS],
  );
  const remaining = Number(rows[0].count);
  check(
    `${label}: exactly one active admin remains among the two fixtures (found ${remaining}, must never be 0)`,
    remaining === 1,
  );
}

async function main(): Promise<void> {
  const config = resolveSeedConfig(process.env);
  if (config.projectRef) {
    console.error(
      "[verify-last-admin-guard] refusing to run against hosted project " +
        `${config.projectRef}. This script writes auth.users rows directly and is for ` +
        "a local stack only — see the header. Point SUPABASE_DB_URL at " +
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres.",
    );
    process.exit(1);
  }
  console.log(`[verify-last-admin-guard] target: ${config.target}`);

  const admin = new Client({ connectionString: config.databaseUrl });
  const connA = new Client({ connectionString: config.databaseUrl });
  const connB = new Client({ connectionString: config.databaseUrl });
  await Promise.all([admin.connect(), connA.connect(), connB.connect()]);

  try {
    await race(
      admin,
      connA,
      connB,
      "set_user_active",
      "select public.set_user_active($1, false)",
    );
    await race(
      admin,
      connA,
      connB,
      "deactivate_user",
      "select public.deactivate_user($1, 'verify-last-admin-guard')",
    );

    if (failures.length > 0) {
      console.error(
        `\n[verify-last-admin-guard] ${failures.length} check(s) failed:`,
      );
      for (const failure of failures) console.error(`  - ${failure}`);
      process.exitCode = 1;
    } else {
      console.log(
        "\n[verify-last-admin-guard] all checks passed — the race is closed.",
      );
    }
  } finally {
    await cleanup(admin);
    await Promise.all([admin.end(), connA.end(), connB.end()]);
  }
}

main().catch((error: unknown) => {
  console.error("\n[verify-last-admin-guard] failed unexpectedly:", error);
  process.exit(1);
});
