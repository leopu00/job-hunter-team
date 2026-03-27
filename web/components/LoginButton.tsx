'use client'

import Link from 'next/link'

export default function LoginButton() {
  return (
    <Link
      href="/?login=true"
      className="text-[11px] font-semibold tracking-widest uppercase text-[var(--color-muted)] hover:text-[var(--color-green)] transition-colors px-3 py-1.5 border border-[var(--color-border)] rounded hover:border-[var(--color-green)] no-underline"
    >
      login
    </Link>
  )
}
