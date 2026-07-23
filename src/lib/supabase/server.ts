// This file creates a Supabase client for use on the SERVER
// (i.e. inside server actions, like our logout function)
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
    // Gets access to the browser's cookies, since that's where
    // the user's login session is stored
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        // Reads all current cookies (used to check if a session exists)
        getAll: () => cookieStore.getAll(),
        // Writes/updates cookies (used when logging in or out,
        // so the session cookie gets created or cleared properly)
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )
}