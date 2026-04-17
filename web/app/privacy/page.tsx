'use client'

import Link from 'next/link'
import { LandingI18nProvider, useLandingI18n } from '../components/landing/LandingI18n'
import LandingNav from '../components/landing/LandingNav'
import { LandingFooter } from '../components/landing/LandingCTA'
import ScrollToTop from '../components/landing/ScrollToTop'

const T = {
  it: {
    title: 'Privacy Policy',
    updated: 'Ultimo aggiornamento: Aprile 2026',
    intro: 'Job Hunter Team (JHT) rispetta la tua privacy. Questa pagina spiega come vengono trattati i tuoi dati.',
    s1_title: 'Dati raccolti',
    s1_body: 'JHT gira dentro un container Docker sul tuo computer. Non raccogliamo, trasmettiamo o memorizziamo dati personali sui nostri server. Profilo, CV, candidature e preferenze restano nella cartella di lavoro locale creata al primo avvio.',
    s2_title: 'Provider AI',
    s2_body: 'Gli agenti girano su una delle tre CLI supportate (Claude Code, Codex, Kimi) che richiedono un tuo abbonamento attivo col rispettivo provider. Quando un agente lavora, la CLI invia la richiesta al provider scelto e il testo passa dai loro server: vale la privacy policy del provider. JHT non intermedia quelle chiamate.',
    s3_title: 'Autenticazione provider',
    s3_body: 'La sessione del provider la apri tu direttamente dentro il container con il login del tuo CLI (claude login / codex login / kimi login). JHT non chiede ne memorizza chiavi API; i token di sessione restano gestiti dalla CLI stessa, sempre in locale.',
    s4_title: 'Modalita locale e cloud',
    s4_body: 'JHT puo girare solo in locale (nessun account, nessun cookie) oppure in una modalita cloud che usa Supabase per autenticazione e backup dei dati. Le due modalita sono alternative: se attivi il cloud, usa solo cookie tecnici necessari al login.',
    s5_title: 'Open source',
    s5_body: 'JHT e completamente open source. Puoi verificare in qualsiasi momento cosa fa il codice esaminando il repository su GitHub.',
    s6_title: 'Contatti',
    s6_body: 'Per domande sulla privacy, scrivi a info@jobhunterteam.ai.',
  },
  en: {
    title: 'Privacy Policy',
    updated: 'Last updated: April 2026',
    intro: 'Job Hunter Team (JHT) respects your privacy. This page explains how your data is handled.',
    s1_title: 'Data collected',
    s1_body: 'JHT runs inside a Docker container on your computer. We do not collect, transmit, or store personal data on our servers. Profile, CV, applications, and preferences stay in the local workspace folder created at first launch.',
    s2_title: 'AI providers',
    s2_body: 'Agents run on one of three supported CLIs (Claude Code, Codex, Kimi), each requiring your own active subscription with the respective provider. When an agent works, the CLI sends the request to the chosen provider and the text passes through their servers: their privacy policy applies. JHT does not intermediate those calls.',
    s3_title: 'Provider authentication',
    s3_body: 'You open the provider session yourself inside the container via the CLI login (claude login / codex login / kimi login). JHT never asks for or stores API keys; session tokens remain managed by the CLI itself, always locally.',
    s4_title: 'Local and cloud mode',
    s4_body: 'JHT can run purely locally (no account, no cookies) or in a cloud mode that uses Supabase for authentication and data backup. The two modes are alternatives: if you enable cloud, it only uses technical cookies strictly needed for login.',
    s5_title: 'Open source',
    s5_body: 'JHT is fully open source. You can verify what the code does at any time by examining the repository on GitHub.',
    s6_title: 'Contact',
    s6_body: 'For privacy questions, write to info@jobhunterteam.ai.',
  },
  hu: {
    title: 'Adatvédelmi irányelvek',
    updated: 'Utolsó frissítés: 2026 április',
    intro: 'A Job Hunter Team (JHT) tiszteletben tartja a magánéletedet. Ez az oldal elmagyarázza, hogyan kezeljük az adataidat.',
    s1_title: 'Gyűjtött adatok',
    s1_body: 'A JHT a számítógépeden futó Docker konténeren belül működik. Nem gyűjtünk, nem továbbítunk és nem tárolunk személyes adatokat a szervereinken. A profil, önéletrajz, jelentkezések és beállítások az első indításkor létrehozott helyi munkamappában maradnak.',
    s2_title: 'AI szolgáltatók',
    s2_body: 'Az ügynökök három támogatott CLI valamelyikén futnak (Claude Code, Codex, Kimi), amelyekhez saját aktív előfizetés kell az adott szolgáltatónál. Amikor egy ügynök dolgozik, a CLI a kiválasztott szolgáltatóhoz küldi a kérést, és a szöveg áthalad a szervereiken: az ő adatvédelmi szabályzatuk érvényes. A JHT nem közvetíti ezeket a hívásokat.',
    s3_title: 'Szolgáltatói hitelesítés',
    s3_body: 'A szolgáltatói munkamenetet te magad nyitod meg a konténeren belül a CLI bejelentkezéssel (claude login / codex login / kimi login). A JHT soha nem kér és nem tárol API kulcsot; a munkamenet tokenek a CLI kezelésében maradnak, mindig helyben.',
    s4_title: 'Helyi és felhő mód',
    s4_body: 'A JHT futhat tisztán helyben (fiók és süti nélkül) vagy felhő módban, amely Supabase-t használ hitelesítésre és adatok biztonsági mentésére. A két mód alternatív: ha a felhő módot választod, csak a bejelentkezéshez feltétlenül szükséges technikai sütiket használja.',
    s5_title: 'Nyílt forráskód',
    s5_body: 'A JHT teljesen nyílt forráskódú. Bármikor ellenőrizheted, hogy mit csinál a kód, a GitHub-on található repository átvizsgálásával.',
    s6_title: 'Kapcsolat',
    s6_body: 'Adatvédelmi kérdések esetén írj az info@jobhunterteam.ai címre.',
  },
}

type TKey = keyof typeof T.it

function Section({ title, body }: { title: string; body: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-[14px] font-bold text-[var(--color-white)] mb-2">{title}</h2>
      <p className="text-[12px] text-[var(--color-muted)] leading-relaxed">{body}</p>
    </div>
  )
}

function PrivacyContent() {
  const { lang } = useLandingI18n()
  const tx = T[lang] ?? T.en
  const t = (k: TKey) => tx[k] ?? k

  const sections: [TKey, TKey][] = [
    ['s1_title', 's1_body'], ['s2_title', 's2_body'], ['s3_title', 's3_body'],
    ['s4_title', 's4_body'], ['s5_title', 's5_body'], ['s6_title', 's6_body'],
  ]

  return (
    <main style={{ position: 'relative', zIndex: 1, animation: 'fade-in 0.35s ease both' }}>
      <LandingNav />
      <div className="max-w-3xl mx-auto px-5 pt-32 pb-20">
        <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2 mb-3">
            <Link href="/" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Home</Link>
            <span className="text-[var(--color-border)]">/</span>
            <span className="text-[10px] text-[var(--color-muted)]">Privacy</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">{t('title')}</h1>
          <p className="text-[var(--color-dim)] text-[10px] mt-2">{t('updated')}</p>
          <p className="text-[var(--color-muted)] text-[12px] mt-3 leading-relaxed">{t('intro')}</p>
        </div>

        {sections.map(([titleKey, bodyKey]) => (
          <Section key={titleKey} title={t(titleKey)} body={t(bodyKey)} />
        ))}

        <div className="mt-12 pt-6 border-t border-[var(--color-border)] flex items-center justify-between">
          <Link href="/" className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors no-underline">
            &larr; Home
          </Link>
          <Link href="/terms" className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors no-underline">
            Terms &rarr;
          </Link>
        </div>
      </div>
      <LandingFooter />
      <ScrollToTop />
    </main>
  )
}

export default function PrivacyPage() {
  return (
    <LandingI18nProvider>
      <PrivacyContent />
    </LandingI18nProvider>
  )
}
