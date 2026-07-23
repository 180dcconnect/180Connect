// Tests for the logout() server action.
// We don't call real Supabase here — we fake ("mock") it,
// so this test runs instantly with no live credentials needed.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Fake version of signOut() that we control per-test
const mockSignOut = vi.fn()

// Replace the real createClient with one that returns our fake Supabase
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { signOut: mockSignOut },
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
  })

  it('calls signOut and redirects to /login on success', async () => {
    mockSignOut.mockResolvedValue({ error: null })

    await logout()

    expect(mockSignOut).toHaveBeenCalledOnce()
    expect(redirect).toHaveBeenCalledWith('/login')
  })

  it('still redirects to /login even if signOut fails', async () => {
    mockSignOut.mockResolvedValue({ error: { message: 'Something broke' } })

    await logout()

    expect(mockSignOut).toHaveBeenCalledOnce()
    expect(redirect).toHaveBeenCalledWith('/login')
  })
})