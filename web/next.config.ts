import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin';
import path from 'node:path'

// Locale: build parte da web/ (cwd termina con /web). Vercel: build parte dalla repo root.
const CWD = process.cwd()
const MONOREPO_ROOT =
  CWD.endsWith(`${path.sep}web`) || CWD.endsWith('/web') ? path.dirname(CWD) : CWD

const isDevelopment = process.env.NODE_ENV === 'development'

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
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ''}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://lh3.googleusercontent.com https://avatars.githubusercontent.com",
      "font-src 'self'",
      "connect-src 'self' https://*.supabase.co",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
]

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: MONOREPO_ROOT,
  outputFileTracingExcludes: {
    '*': [
      '../cli/**',
      '../desktop/**',
      '../tui/**',
      '../agents/**',
      '../e2e/**',
      '../telegram-bridge/**',
      '../tests/**',
      '../docs/**',
      '../scripts/**',
      '../launcher/**',
      '../data/**',
      '../sentinella/**',
      '../assets/**',
      '../.githooks/**',
      '../node_modules/.cache/**',
      '**/*.map',
    ],
  },
  // Turbopack root: lasciamo sempre cwd (web/). Usare MONOREPO_ROOT scatena
  // un loop nel resolver di @tailwindcss/postcss che spawna worker che non
  // muoiono (leak RAM lineare → freeze Mac, vedi crash 25/04). Per il
  // file-tracing del build resta outputFileTracingRoot sopra; quello vale
  // per `next build --output=standalone` e non tocca il dev server.
  turbopack: {},
  poweredByHeader: false,
  serverExternalPackages: ['better-sqlite3'],
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
    ]
  },
}

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

export default withNextIntl(nextConfig);
