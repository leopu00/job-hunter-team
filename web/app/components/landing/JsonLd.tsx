const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://jobhunterteam.ai'

export default function JsonLd() {
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

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(software) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(website) }} />
    </>
  )
}
