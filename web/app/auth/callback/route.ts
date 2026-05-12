import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Difesa contro open redirect: solo path relativi che iniziano con
// `/` ma non `//` (protocol-relative URL → punterebbero a domini
// esterni). Senza questo, un attaccante puo' farsi inviare via mail
// un link tipo `/auth/callback?code=...&next=//evil.com` e dopo
// login l'utente atterra su evil.com.
function safeNext(raw: string | null): string {
  if (!raw) return '/dashboard'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard'
  return raw
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = safeNext(searchParams.get('next'))

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Auth fallita — torna alla pagina login con errore
  return NextResponse.redirect(`${origin}/?login=true&error=auth_failed`)
}
