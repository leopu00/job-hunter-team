import type { MetadataRoute } from 'next'

const SITE_URL = 'https://jobhunterteam.ai'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/setup', '/auth'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
