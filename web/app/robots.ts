import type { MetadataRoute } from 'next'

const SITE_URL = 'https://jobhunterteam.ai'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/setup',
          '/auth',
          '/dashboard',
          '/profile',
          '/team',
          '/applications',
          '/positions',
          '/ready',
          '/risposte',
          '/crescita',
          '/assistente',
          '/capitano',
          '/scout',
          '/analista',
          '/scorer',
          '/scrittore',
          '/critico',
          '/sentinella',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
