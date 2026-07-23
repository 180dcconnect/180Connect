// This file runs on EVERY request before the page loads.
// It checks whether the user has a valid session, and if not,
// blocks them from protected pages (like /dashboard) and sends
// them to /login instead — even if they hit "back" in the browser.
import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Add any route that should require login here
const PROTECTED_ROUTES = ['/dashboard']

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Ask Supabase: is there a valid session for this request?
  const { data: { user } } = await supabase.auth.getUser()

  const isProtectedRoute = PROTECTED_ROUTES.some((route) =>
    request.nextUrl.pathname.startsWith(route)
  )

  // No session + trying to access a protected page → send to login
  if (!user && isProtectedRoute) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return response
}

// Tells Next.js which routes this middleware should run on
export const config = {
  matcher: ['/dashboard/:path*'],
}