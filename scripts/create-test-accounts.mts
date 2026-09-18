import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { resolveSeedConfig } from "../src/lib/seed/config.ts";

const { Client } = pg;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabaseAdmin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const DEFAULT_PASSWORD = "TestPassword180!";

const ACCOUNTS = [
  {
    email: "test-admin@180dc.org",
    role: "admin" as const,
    fullName: "Test Admin",
    password: DEFAULT_PASSWORD,
  },
  {
    email: "test-cam@180dc.org",
    role: "cam" as const,
    fullName: "Test CAM",
    password: DEFAULT_PASSWORD,
  },
  {
    email: "test-viewer@180dc.org",
    role: "viewer" as const,
    fullName: "Test Viewer",
    password: DEFAULT_PASSWORD,
  },
];

async function main(): Promise<void> {
  const seedConfig = resolveSeedConfig(process.env);
  console.log(`[create-test-accounts] target: ${seedConfig.target}`);

  const pgClient = new Client({ connectionString: seedConfig.databaseUrl });
  await pgClient.connect();

  const { data: usersData, error: listError } = await supabaseAdmin.auth.admin.listUsers();
  if (listError) {
    console.error("Error listing users:", listError);
    throw listError;
  }

  // Remove test-scam and test-cum if present
  const toDelete = ["test-scam@180dc.org", "test-cum@180dc.org"];
  for (const email of toDelete) {
    const user = usersData.users.find((u) => u.email?.toLowerCase() === email);
    if (user) {
      console.log(`Removing ${email}...`);
      await pgClient.query("delete from public.users where id = $1", [user.id]);
      await supabaseAdmin.auth.admin.deleteUser(user.id);
    }
  }

  for (const account of ACCOUNTS) {
    console.log(`\nProcessing ${account.email} (${account.role})...`);

    const existingUser = usersData.users.find(
      (u) => u.email?.toLowerCase() === account.email.toLowerCase(),
    );

    let userId: string;

    if (existingUser) {
      console.log(`User ${account.email} already exists (ID: ${existingUser.id}). Updating password and email confirmation...`);
      userId = existingUser.id;
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: account.password,
        email_confirm: true,
        user_metadata: { full_name: account.fullName },
      });
      if (updateError) {
        console.error(`Failed to update ${account.email}:`, updateError);
        throw updateError;
      }
    } else {
      console.log(`Creating user ${account.email}...`);
      const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: account.email,
        password: account.password,
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
    `select u.id, u.email, u.full_name, u.role, u.is_active, au.confirmed_at
     from public.users u
     join auth.users au on u.id = au.id
     where u.email in ('test-admin@180dc.org', 'test-cam@180dc.org', 'test-viewer@180dc.org')
     order by u.role`,
  );
  console.log("\nActive test accounts:");
  console.table(res.rows);

  await pgClient.end();
  console.log("\nAll done!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
