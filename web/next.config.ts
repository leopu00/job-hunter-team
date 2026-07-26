import type { NextConfig } from 'next'
import withBundleAnalyzerInit from '@next/bundle-analyzer';
import path from 'node:path'
import { readFileSync } from 'node:fs'

// Bundle analyzer: attivo solo con ANALYZE=true per non rallentare le
// build normali. `npm run analyze` da web/ apre i report HTML in
// .next/analyze/client.html e server.html (vedi
// docs/internal/postmortems/2026-05-22-vercel-quota-exhaustion.md insight #10).
const withBundleAnalyzer = withBundleAnalyzerInit({
  enabled: process.env.ANALYZE === 'true',
  openAnalyzer: false,
});

// Locale: build parte da web/ (cwd termina con /web). Vercel: build parte dalla repo root.
const CWD = process.cwd()
const MONOREPO_ROOT =
  CWD.endsWith(`${path.sep}web`) || CWD.endsWith('/web') ? path.dirname(CWD) : CWD

// Versione app dalla single source di verità (root package.json): la footer la
// legge via NEXT_PUBLIC_APP_VERSION e si aggiorna da sola a ogni bump.
let APP_VERSION = '0.0.0'
try {
  APP_VERSION =
    (JSON.parse(
      readFileSync(path.join(MONOREPO_ROOT, 'package.json'), 'utf8'),
    ).version as string) || APP_VERSION
} catch {
  /* fallback al default */
}

// Static security headers. The Content-Security-Policy header is *not*
// here: it carries a per-request nonce and is therefore set by
// `web/middleware.ts`, which runs on every HTML response.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // microphone=(self) permette al nostro origin di richiedere
  // l'accesso via navigator.mediaDevices.getUserMedia (serve per il
  // bottone "detta a voce" nell'onboarding). Camera e geolocation
  // restano disabilitate: nessuna pagina le usa al momento.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
]

const nextConfig: NextConfig = {
  output: 'standalone',
  env: { NEXT_PUBLIC_APP_VERSION: APP_VERSION },
  outputFileTracingRoot: MONOREPO_ROOT,
  // Pattern path-assoluti relativi al MONOREPO_ROOT: i glob `../X/**`
  // erano relativi a CWD (web/) e funzionavano in build locale ma su
  // Vercel CWD = MONOREPO_ROOT, quindi `../` esce dalla project root
  // e Turbopack rifiuta con "glob navigates out of project root".
  // Path assoluti rendono il pattern equivalente in entrambi gli env.
  outputFileTracingExcludes: {
    '*': [
      path.join(MONOREPO_ROOT, 'cli/**'),
      path.join(MONOREPO_ROOT, 'agents/**'),
      path.join(MONOREPO_ROOT, 'e2e/**'),
      path.join(MONOREPO_ROOT, 'tests/**'),
      path.join(MONOREPO_ROOT, 'docs/**'),
      path.join(MONOREPO_ROOT, 'scripts/**'),
      path.join(MONOREPO_ROOT, 'launcher/**'),
      path.join(MONOREPO_ROOT, 'data/**'),
      path.join(MONOREPO_ROOT, 'sentinella/**'),
      path.join(MONOREPO_ROOT, 'assets/**'),
      path.join(MONOREPO_ROOT, '.githooks/**'),
      path.join(MONOREPO_ROOT, 'node_modules/.cache/**'),
      '**/*.map',
    ],
  },
  // Turbopack root: lasciamo sempre cwd (web/). Usare MONOREPO_ROOT scatena
  // un loop nel resolver di @tailwindcss/postcss che spawna worker che non
  // muoiono (leak RAM lineare → freeze Mac, vedi crash 25/04). Per il
  // file-tracing del build resta outputFileTracingRoot sopra; quello vale
  // per `next build --output=standalone` e non tocca il dev server.
  turbopack: {},
  // Sposta il devtools indicator a bottom-right per liberare bottom-left
  // ai widget custom dell'app (es. ProfileAssistantFab).
  devIndicators: { position: 'bottom-right' },
  poweredByHeader: false,
  serverExternalPackages: ['better-sqlite3', 'node:sqlite'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com', // Avatar Google OAuth
      },
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com', // Avatar GitHub OAuth
      },
    ],
  },
  async redirects() {
    return [
      // Il form manuale /profile/edit è stato rimosso: la modifica del profilo
      // passa dalla chat con l'Assistente (vedi ProfileAssistantFab). Vecchi
      // bookmark/link → pagina profilo.
      { source: '/profile/edit', destination: '/profile', permanent: false },
    ]
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      {
        source: '/install.sh',
        headers: [
          { key: 'content-type', value: 'application/x-sh; charset=utf-8' },
          { key: 'cache-control', value: 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400' },
        ],
      },
      {
        source: '/install.ps1',
        headers: [
          { key: 'content-type', value: 'text/plain; charset=utf-8' },
          { key: 'cache-control', value: 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400' },
        ],
      },
    ]
  },
}

export default withBundleAnalyzer(nextConfig);
