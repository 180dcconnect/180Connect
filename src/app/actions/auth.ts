'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function logout() {
  const supabase = await createClient()
  const { error } = await supabase.auth.signOut()

  if (error) {
    // TODO: once ERROR_LOG exists, write to it here instead of console
    console.error('Logout failed:', error.message)
    // Still redirect so the user isn't stuck, but this at least
    // makes the failure visible instead of silently disappearing
  }
  redirect('/login')
}