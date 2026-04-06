export const MARKETING_ROUTE_PREFIXES = [
  '/',
  '/about',
  '/changelog',
  '/demo',
  '/docs',
  '/download',
  '/faq',
  '/guide',
  '/pricing',
  '/privacy',
  '/reports',
  '/stats',
  '/terms',
] as const

export function isMarketingRoute(pathname: string | null | undefined) {
  if (!pathname) return false
  return MARKETING_ROUTE_PREFIXES.some((route) => (
    route === '/'
      ? pathname === '/'
      : pathname === route || pathname.startsWith(`${route}/`)
  ))
}
