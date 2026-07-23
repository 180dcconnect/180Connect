'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function logout() {
  const supabase = await createClient()
  const { error } = await supabase.auth.signOut()

  if (error) {
    // Log failure to ERROR_LOG per DoD requirement.
    // error_log table is expected to exist already — created by a separate
    // database setup task, not by this code. (See PRD step 13)
    // Not created here to avoid conflicting with that migration.
    try {
      await supabase.from('error_log').insert({
        component: 'auth', // not in PRD's example list (ingestion/scoring/email/sync/ui) — flagging for review
        error_type: 'logout_failed',
        message: error.message,
        stack_trace: JSON.stringify(error), // Supabase errors don't include a real stack trace
        // resolved_at intentionally omitted — stays null until triaged
      })
    } catch (logError) {
      // Insert can fail if error_log doesn't exist yet (pre-migration).
      // Don't let that break logout — just surface it locally.
      console.error('Failed to write to ERROR_LOG:', logError)
    }
    
    console.error('Logout failed:', error.message)
    // Still redirect so the user isn't stuck, but this at least
    // makes the failure visible instead of silently disappearing
  }
  redirect('/login')
}