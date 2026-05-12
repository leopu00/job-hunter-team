import type { MetadataRoute } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jobhunterteam.ai'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/auth',
          // Onboarding / setup
          '/setup',
          '/onboarding',
          // Top nav
          '/dashboard',
          '/profile',
          '/positions',
          '/applications',
          '/ready',
          '/risposte',
          '/crescita',
          '/reports',
          '/team',
          '/team/capitano',
          '/team/scout',
          '/team/analista',
          '/team/scorer',
          '/team/scrittore',
          '/team/critico',
          '/team/sentinella',
          '/team/assistente',
          // Config (SettingsMenu)
          '/settings',
          '/providers',
          '/credentials',
          '/rate-limiter',
          '/secrets',
          '/notifications',
          '/channels',
          '/integrations',
          '/cron',
          '/cli-link',
          // Account (UserMenu)
          '/export',
          '/backup',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
