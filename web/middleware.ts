import { NextResponse, type NextRequest } from 'next/server'

// Espone `x-pathname` ai server component — il layout `(protected)` lo
// usa per redirigere l'utente su `/onboarding` quando il profilo non
// è ancora completo. Senza questo header non c'è modo di sapere la
// route richiesta da un server component senza fare ricorso al client.
export function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pathname', request.nextUrl.pathname)
  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
}
