// This file creates a Supabase client for use in the BROWSER
// (i.e. inside components that run on the user's device, like buttons and forms)
import { createBrowserClient } from '@supabase/ssr'

// Connects to our Supabase project using the URL and public key
// stored in .env.local. The "!" tells TypeScript these values will exist.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}