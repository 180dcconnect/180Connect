// Tests for the logout() server action.
// We don't call real Supabase here — we fake ("mock") it,
// so this test runs instantly with no live credentials needed.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Fake version of signOut() that we control per-test
const mockSignOut = vi.fn()

// Fake version of .from('error_log').insert(...) that we control per-test
const mockInsert = vi.fn()
const mockFrom = vi.fn(() => ({ insert: mockInsert }))

// Replace the real createClient with one that returns our fake Supabase.
// Now includes both `auth.signOut` and `from(...).insert(...)`, since
// logout() uses both.
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { signOut: mockSignOut },
    from: mockFrom,
  }),
}))

// Replace Next's redirect() so it doesn't actually try to navigate
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

import { logout } from '../auth'
import { redirect } from 'next/navigation'

describe('logout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: insert succeeds unless a test overrides this
    mockInsert.mockResolvedValue({ error: null })
  })

  it('calls signOut and redirects to /login on success', async () => {
    mockSignOut.mockResolvedValue({ error: null })

    await logout()

    expect(mockSignOut).toHaveBeenCalledOnce()
    expect(redirect).toHaveBeenCalledWith('/login')
    // No error occurred, so we should NOT have tried to log anything
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('writes to error_log and still redirects when signOut fails', async () => {
    mockSignOut.mockResolvedValue({ error: { message: 'Something broke' } })

    await logout()

    expect(mockSignOut).toHaveBeenCalledOnce()

    // Confirm we tried to insert into the correct table
    expect(mockFrom).toHaveBeenCalledWith('error_log')

    // Confirm the row we tried to insert has the right shape
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        component: 'auth',
        error_type: 'logout_failed',
        message: 'Something broke',
      })
    )

    expect(redirect).toHaveBeenCalledWith('/login')
  })

  it('still redirects even if writing to error_log itself fails', async () => {
    mockSignOut.mockResolvedValue({ error: { message: 'Something broke' } })
    // Simulate the error_log table not existing yet
    mockInsert.mockRejectedValue(new Error('relation "error_log" does not exist'))

    await logout()

    // Even though logging failed, logout should not crash —
    // it should still redirect the user
    expect(redirect).toHaveBeenCalledWith('/login')
  })
})