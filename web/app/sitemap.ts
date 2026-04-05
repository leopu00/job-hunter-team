import type { MetadataRoute } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jobhunterteam.ai'

/** Pagine pubbliche indicizzabili — landing, documentazione, info */
const PUBLIC_PAGES = [
  { path: '/',          priority: 1.0,  changeFrequency: 'weekly'  as const },
  { path: '/download',  priority: 0.9,  changeFrequency: 'weekly'  as const },
  { path: '/guide',     priority: 0.8,  changeFrequency: 'monthly' as const },
  { path: '/faq',       priority: 0.8,  changeFrequency: 'monthly' as const },
  { path: '/changelog', priority: 0.6,  changeFrequency: 'weekly'  as const },
  { path: '/pricing',   priority: 0.9,  changeFrequency: 'monthly' as const },
  { path: '/about',     priority: 0.5,  changeFrequency: 'monthly' as const },
  { path: '/privacy',   priority: 0.3,  changeFrequency: 'yearly'  as const },
  { path: '/terms',     priority: 0.3,  changeFrequency: 'yearly'  as const },
  { path: '/docs',      priority: 0.7,  changeFrequency: 'monthly' as const },
  { path: '/demo',      priority: 0.7,  changeFrequency: 'monthly' as const },
  { path: '/stats',     priority: 0.6,  changeFrequency: 'weekly'  as const },
  { path: '/reports',   priority: 0.6,  changeFrequency: 'weekly'  as const },
]

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((page) => ({
    url: `${SITE_URL}${page.path}`,
    lastModified: new Date(),
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }))
}
