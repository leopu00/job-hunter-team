export default function JsonLd() {
  const data = {
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
    url: 'https://jobhunterteam.ai',
    license: 'https://opensource.org/licenses/MIT',
    isAccessibleForFree: true,
    author: {
      '@type': 'Organization',
      name: 'Job Hunter Team',
      url: 'https://jobhunterteam.ai',
    },
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}
