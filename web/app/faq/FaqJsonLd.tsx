const FAQ_DATA = [
  {
    q: "Cos'e Job Hunter Team?",
    a: "Job Hunter Team (JHT) e un sistema open-source che automatizza la ricerca di lavoro usando un team di agenti AI. Ogni agente ha un ruolo specifico: trovare offerte, analizzarle, calcolare il match col tuo profilo, scrivere CV e cover letter personalizzate, e revisionarle. Tutto gira in locale sul tuo computer — i tuoi dati non lasciano mai la tua macchina.",
  },
  {
    q: 'Come funziona?',
    a: "Configuri il tuo profilo (competenze, esperienza, preferenze) e avvii il team. Gli agenti collaborano in pipeline: lo Scout cerca offerte online, l'Analista le analizza, lo Scorer calcola il match, lo Scrittore prepara i documenti e il Critico li revisiona. Il Capitano coordina tutto e la Sentinella monitora i costi.",
  },
  {
    q: 'Serve creare un account?',
    a: 'No. JHT gira interamente in locale. Non c\'e registrazione, non c\'e login a servizi esterni, non c\'e cloud. Avvii il server sul tuo computer e accedi dal browser su localhost:3000.',
  },
  {
    q: 'Quanto costa?',
    a: "Il software e gratuito e open-source. L'unico costo e la chiave API Anthropic per far funzionare gli agenti AI (Claude). Una ricerca completa tipica consuma circa 1-5$ di API. La Sentinella monitora i costi in tempo reale e puoi impostare un budget massimo.",
  },
  {
    q: 'Quali agenti ci sono?',
    a: 'Capitano (coordina il team), Scout (cerca offerte), Analista (analizza requisiti e fit), Scorer (calcola punteggio match), Scrittore (genera CV e cover letter), Critico (revisiona documenti), Sentinella (monitora budget e salute sistema).',
  },
  {
    q: 'Quali sono i requisiti di sistema?',
    a: 'Il launcher desktop funziona su macOS 12+, Linux (Ubuntu 22.04+, Debian 12+, Fedora 39+) e Windows 10+. Per eseguire gli agenti servono anche tmux e Claude CLI; su Windows tmux richiede ancora WSL. Serve una connessione internet per le chiamate API.',
  },
  {
    q: 'I miei dati sono al sicuro?',
    a: 'Si. Tutti i dati (database, CV, cover letter, profili) sono salvati nella cartella di lavoro locale sul tuo computer. Nessun dato viene inviato a server esterni, tranne le chiamate API ad Anthropic per far funzionare gli agenti.',
  },
  {
    q: 'Posso usare JHT senza chiave API?',
    a: 'Si, ma con funzionalita limitate. Senza chiave API gli agenti AI non possono funzionare, pero puoi usare la web app per gestire candidature manualmente, consultare il profilo e navigare la dashboard.',
  },
  {
    q: 'Come contribuisco al progetto?',
    a: 'JHT e open-source. Puoi contribuire su GitHub: segnala bug, proponi feature, o invia pull request.',
  },
]

export default function FaqJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_DATA.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: a,
      },
    })),
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}
