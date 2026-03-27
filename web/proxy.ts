import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  // Se Supabase non è configurato, passa attraverso senza auth
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return supabaseResponse
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session (IMPORTANTE: non rimuovere)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // Rotte protette — redirect al login se non autenticato
  const isProtected =
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/profile') ||
    pathname.startsWith('/positions') ||
    pathname.startsWith('/applications') ||
    pathname.startsWith('/ready') ||
    pathname.startsWith('/risposte') ||
    pathname.startsWith('/crescita') ||
    pathname.startsWith('/team') ||
    pathname.startsWith('/scout') ||
    pathname.startsWith('/analista') ||
    pathname.startsWith('/scorer') ||
    pathname.startsWith('/scrittore') ||
    pathname.startsWith('/critico')

  if (isProtected && !user) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  // Utente autenticato sulla landing → redirect alla dashboard
  if (pathname === '/' && user) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
