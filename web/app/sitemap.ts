import type { MetadataRoute } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jobhunterteam.ai'

/** Pagine pubbliche indicizzabili — landing, documentazione, info */
const PUBLIC_PAGES = [
  { path: '/',          priority: 1.0,  changeFrequency: 'weekly'  as const },
  { path: '/download',  priority: 0.9,  changeFrequency: 'weekly'  as const },
  { path: '/project',   priority: 0.7,  changeFrequency: 'weekly'  as const },
  { path: '/privacy',   priority: 0.3,  changeFrequency: 'yearly'  as const },
  { path: '/terms',     priority: 0.3,  changeFrequency: 'yearly'  as const },
]

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((page) => ({
    url: `${SITE_URL}${page.path}`,
    lastModified: new Date(),
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }))
}
