import { getNonce } from '@/lib/csp'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jobhunterteam.ai'

export default async function JsonLd() {
  const nonce = await getNonce()
  const software = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Job Hunter Team',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'macOS, Linux, Windows',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    description:
      'Un team di agenti AI che automatizza la ricerca di lavoro: scansione offerte, analisi, scoring e candidature personalizzate. Open source, locale, privato.',
    url: SITE_URL,
    license: 'https://opensource.org/licenses/MIT',
    isAccessibleForFree: true,
    author: {
      '@type': 'Organization',
      name: 'Job Hunter Team',
      url: SITE_URL,
    },
  }

  const website = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Job Hunter Team',
    url: SITE_URL,
    inLanguage: 'it',
    potentialAction: {
      '@type': 'SearchAction',
      target: `${SITE_URL}/docs?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  }

  // React rimuove l'attributo `nonce` dal DOM dopo l'hydration come
  // misura anti-XSS (così non può essere riusato da script iniettati).
  // Questo causa un hydration mismatch: server invia nonce="X", client
  // dopo hydration vede nonce="". `suppressHydrationWarning` è l'escape
  // hatch ufficiale React per questo scenario legittimo.
  // Vedi BUG-CSP-JSONLD-LANDING-V2 in BACKLOG.md.
  return (
    <>
      <script nonce={nonce} type="application/ld+json" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: JSON.stringify(software) }} />
      <script nonce={nonce} type="application/ld+json" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: JSON.stringify(website) }} />
    </>
  )
}
