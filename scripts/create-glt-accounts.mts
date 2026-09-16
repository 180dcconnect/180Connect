/**
 * Creates the shared Global Leadership Team logins (viewer role).
 *
 * GLT members see every screen an admin sees and write nothing — the `viewer`
 * role is enforced at the database layer, not just in the UI
 * (supabase/migrations/20260724100000_viewer_role_write_lockout.sql).
 *
 * The password is never stored in this file. Pass it at run time:
 *
 *   GLT_PASSWORD='...' npm run seed:glt-accounts
 *
 * Re-running is safe: an existing account has its password reset and its role
 * re-asserted rather than being duplicated.
 */
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { resolveSeedConfig } from "../src/lib/seed/config.ts";

const { Client } = pg;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.GLT_PASSWORD;

if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

if (!password) {
  console.error("Missing GLT_PASSWORD. Run as: GLT_PASSWORD='...' npm run seed:glt-accounts");
  process.exit(1);
}

const supabaseAdmin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ACCOUNTS = [1, 2, 3].map((n) => ({
  email: `glt${n}@180dc.org`,
  fullName: `GLT ${n}`,
  role: "viewer" as const,
}));

async function main(): Promise<void> {
  const seedConfig = resolveSeedConfig(process.env);
  console.log(`[create-glt-accounts] target: ${seedConfig.target}`);

  const pgClient = new Client({ connectionString: seedConfig.databaseUrl });
  await pgClient.connect();

  const { data: usersData, error: listError } = await supabaseAdmin.auth.admin.listUsers();
  if (listError) {
    console.error("Error listing users:", listError);
    throw listError;
  }

  for (const account of ACCOUNTS) {
    console.log(`\nProcessing ${account.email} (${account.role})...`);

    const existingUser = usersData.users.find(
      (u) => u.email?.toLowerCase() === account.email.toLowerCase(),
    );

    let userId: string;

    if (existingUser) {
      console.log(`Exists (ID: ${existingUser.id}). Resetting password and confirming email...`);
      userId = existingUser.id;
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password,
        email_confirm: true,
        user_metadata: { full_name: account.fullName },
      });
      if (updateError) {
        console.error(`Failed to update ${account.email}:`, updateError);
        throw updateError;
      }
    } else {
      console.log(`Creating ${account.email}...`);
      const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: account.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: account.fullName },
      });
      if (createError) {
        console.error(`Failed to create ${account.email}:`, createError);
        throw createError;
      }
      userId = createData.user.id;
    }

    await pgClient.query(
      `
      insert into public.users (id, email, full_name, role, is_active, is_seed)
      values ($1, $2, $3, $4, true, false)
      on conflict (id) do update
      set email = $2,
          full_name = $3,
          role = $4,
          is_active = true;
      `,
      [userId, account.email, account.fullName, account.role],
    );

    console.log(`Verified public.users row for ${account.email} as role=${account.role}`);
  }

  const res = await pgClient.query(
    `select u.email, u.full_name, u.role, u.is_active, au.confirmed_at
     from public.users u
     join auth.users au on u.id = au.id
     where u.email = any($1)
     order by u.email`,
    [ACCOUNTS.map((a) => a.email)],
  );
  console.log("\nGLT accounts:");
  console.table(res.rows);

  await pgClient.end();
  console.log("\nAll done!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
