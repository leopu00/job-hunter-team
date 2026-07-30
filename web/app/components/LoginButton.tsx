'use client'

import Link from 'next/link'
import { useLocale } from '@/lib/use-locale'
import type { Locale } from '@/i18n/config'

const T: Record<Locale, { login: string }> = {
  it: { login: 'Accedi' },
  en: { login: 'Sign in' },
  es: { login: 'Iniciar sesión' },
  fr: { login: 'Se connecter' },
  de: { login: 'Anmelden' },
  hu: { login: 'Bejelentkezés' },
  pt: { login: 'Entrar' },
}

export default function LoginButton() {
  const t = T[useLocale()]
  return (
    <Link
      href="/?login=true"
      className="text-[11px] font-semibold tracking-widest uppercase text-[var(--color-muted)] hover:text-[var(--color-green)] transition-colors px-3 py-1.5 border border-[var(--color-border)] rounded hover:border-[var(--color-green)] no-underline"
    >
      {t.login}
    </Link>
  )
}
