import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // `src/lib/supabase/admin-client-factory.ts` holds the service-role key and
    // deliberately carries no `server-only` guard, because the F038 ingestion
    // runner executes outside Next.js and `server-only` throws there. That makes
    // it the one way to obtain an RLS-bypassing client without tripping the guard,
    // so importing it is restricted to the two places that legitimately need it.
    // Everything else goes through `admin.ts`, which keeps the guard.
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/lib/supabase/admin.ts",
      "src/lib/ingestion/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/supabase/admin-client-factory"],
              message:
                "Import createAdminClient from src/lib/supabase/admin.ts instead — it keeps the `server-only` guard. admin-client-factory.ts is reserved for admin.ts and the F038 ingestion runner, which runs outside Next.js.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
