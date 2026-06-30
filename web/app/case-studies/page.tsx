// Pagina principale /case-studies — landing della sezione.
//
// Spiega cos'è (dati reali e anonimi di team in esecuzione su profili veri),
// elenca i case study disponibili come card (→ /case-studies/[id]) e incentiva
// gli utenti a contribuire i propri dati, referenziando i doc GitHub.
// È pensata per crescere: col tempo accoglierà il monitoraggio di più team.

import Link from "next/link";
import { LandingI18nProvider } from "../components/landing/LandingI18n";
import LandingNav from "../components/landing/LandingNav";
import {
  CASE_STUDIES,
  CONTRIBUTE_LINKS,
  localizeCaseStudy,
} from "@/lib/case-studies";
import CaseStudiesShell, { type CaseStudyTeaser } from "./CaseStudiesShell";
import { getRequestLocale } from "@/lib/request-locale";
import type { Locale } from "@/i18n/config";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Case studies · Job Hunter Team",
  description:
    "Dati reali e anonimi di team di agenti Job Hunter Team in esecuzione su profili veri. Guarda i risultati, e contribuisci con i tuoi dati.",
};

const LOCALE_TAG: Record<Locale, string> = {
  it: "it-IT",
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  hu: "hu-HU",
  pt: "pt-PT",
};

const T: Record<
  Locale,
  {
    metaTitle: string;
    metaDescription: string;
    heroKicker: string;
    heroTitlePre: string;
    heroTitleEmph: string;
    heroTitlePost: string;
    heroLeadPre: string;
    heroLeadStrong: string;
    heroLeadPost: string;
    heroSub: string;
    positions: string;
    avgMatch: string;
    strongMatch: string;
    moreComingTitle: string;
    moreComingSub: string;
    contributeTitle: string;
    contributeLead: string;
    betaTitle: string;
    betaBody: string;
    selfHostTitle: string;
    selfHostBody: string;
    repository: string;
    footer: string;
  }
> = {
  it: {
    metaTitle: "Case studies · Job Hunter Team",
    metaDescription:
      "Dati reali e anonimi di team di agenti Job Hunter Team in esecuzione su profili veri. Guarda i risultati, e contribuisci con i tuoi dati.",
    heroKicker: "Case studies · dati di campo reali e anonimi",
    heroTitlePre: "Cosa fa ",
    heroTitleEmph: "davvero",
    heroTitlePost: " un team Job Hunter",
    heroLeadPre:
      "Job Hunter Team è una squadra di agenti AI autonomi che cerca lavoro per te: trova posizioni, le analizza, le valuta sul tuo profilo e prepara le candidature. Qui mostriamo cosa ha prodotto su ",
    heroLeadStrong: "profili candidato reali",
    heroLeadPost:
      " — dati aggregati e anonimi, nessuna informazione personale.",
    heroSub:
      "È una pagina viva: cresce a ogni nuovo team monitorato. Scegli un case study qui sotto per vedere tutti i risultati.",
    positions: "posizioni",
    avgMatch: "match medio",
    strongMatch: "match forti",
    moreComingTitle: "Altri case study in arrivo",
    moreComingSub: "il tuo potrebbe essere il prossimo",
    contributeTitle: "📥 Contribuisci con i tuoi dati",
    contributeLead:
      "Più profili reali raccogliamo, più questa pagina diventa utile a chi cerca lavoro. Fai girare Job Hunter sulla tua ricerca e condividi i risultati (aggregati e anonimi): bastano pochi passi.",
    betaTitle: "🧪 Diventa beta tester",
    betaBody:
      "Fai girare il team per qualche settimana sulla tua ricerca e condividi i risultati: ti aiutiamo col setup. Guida e modello dati su GitHub.",
    selfHostTitle: "🛠️ Self-host & contribuisci",
    selfHostBody:
      "Installa Job Hunter in locale o sul tuo VPS, usalo sulla tua ricerca e apri una PR con i tuoi dati. Tutto open source.",
    repository: "Repository:",
    footer:
      "Dati anonimi da run reali del team · snapshot committati, nessuna informazione personale del candidato.",
  },
  en: {
    metaTitle: "Case studies · Job Hunter Team",
    metaDescription:
      "Real, anonymous data from Job Hunter Team agent teams running on real profiles. See the results, and contribute your own data.",
    heroKicker: "Case studies · real, anonymous field data",
    heroTitlePre: "What a Job Hunter team ",
    heroTitleEmph: "really",
    heroTitlePost: " does",
    heroLeadPre:
      "Job Hunter Team is a team of autonomous AI agents that looks for work on your behalf: it finds positions, analyzes them, scores them against your profile and prepares the applications. Here we show what it produced on ",
    heroLeadStrong: "real candidate profiles",
    heroLeadPost: " — aggregated, anonymous data, no personal information.",
    heroSub:
      "It's a living page: it grows with every new team we monitor. Pick a case study below to see all the results.",
    positions: "positions",
    avgMatch: "average match",
    strongMatch: "strong matches",
    moreComingTitle: "More case studies coming",
    moreComingSub: "yours could be next",
    contributeTitle: "📥 Contribute your data",
    contributeLead:
      "The more real profiles we collect, the more useful this page becomes for job seekers. Run Job Hunter on your search and share the results (aggregated and anonymous): it only takes a few steps.",
    betaTitle: "🧪 Become a beta tester",
    betaBody:
      "Run the team for a few weeks on your search and share the results: we'll help you with the setup. Guide and data model on GitHub.",
    selfHostTitle: "🛠️ Self-host & contribute",
    selfHostBody:
      "Install Job Hunter locally or on your VPS, use it on your search and open a PR with your data. Fully open source.",
    repository: "Repository:",
    footer:
      "Anonymous data from real team runs · committed snapshots, no personal information about the candidate.",
  },
  es: {
    metaTitle: "Casos de estudio · Job Hunter Team",
    metaDescription:
      "Datos reales y anónimos de equipos de agentes Job Hunter Team ejecutándose sobre perfiles reales. Mira los resultados y contribuye con tus datos.",
    heroKicker: "Casos de estudio · datos de campo reales y anónimos",
    heroTitlePre: "Lo que ",
    heroTitleEmph: "realmente",
    heroTitlePost: " hace un equipo Job Hunter",
    heroLeadPre:
      "Job Hunter es un equipo de agentes de IA que busca trabajo por ti: encuentra puestos, los analiza, los evalúa según tu perfil y prepara las candidaturas. Aquí mostramos lo que produjo sobre ",
    heroLeadStrong: "perfiles de candidato reales",
    heroLeadPost: " — datos agregados y anónimos, sin información personal.",
    heroSub:
      "Es una página viva: crece con cada nuevo equipo monitorizado. Elige un caso de estudio abajo para ver todos los resultados.",
    positions: "puestos",
    avgMatch: "coincidencia media",
    strongMatch: "coincidencias fuertes",
    moreComingTitle: "Más casos de estudio en camino",
    moreComingSub: "el tuyo podría ser el próximo",
    contributeTitle: "📥 Contribuye con tus datos",
    contributeLead:
      "Cuantos más perfiles reales recopilemos, más útil será esta página para quien busca trabajo. Ejecuta Job Hunter en tu búsqueda y comparte los resultados (agregados y anónimos): bastan unos pocos pasos.",
    betaTitle: "🧪 Conviértete en beta tester",
    betaBody:
      "Ejecuta el equipo durante unas semanas en tu búsqueda y comparte los resultados: te ayudamos con la configuración. Guía y modelo de datos en GitHub.",
    selfHostTitle: "🛠️ Auto-aloja y contribuye",
    selfHostBody:
      "Instala Job Hunter en local o en tu VPS, úsalo en tu búsqueda y abre una PR con tus datos. Todo open source.",
    repository: "Repositorio:",
    footer:
      "Datos anónimos de ejecuciones reales del equipo · snapshots versionados, sin información personal del candidato.",
  },
  fr: {
    metaTitle: "Études de cas · Job Hunter Team",
    metaDescription:
      "Données réelles et anonymes d'équipes d'agents Job Hunter Team exécutées sur de vrais profils. Voyez les résultats et contribuez avec vos données.",
    heroKicker: "Études de cas · données de terrain réelles et anonymes",
    heroTitlePre: "Ce qu'une équipe Job Hunter fait ",
    heroTitleEmph: "vraiment",
    heroTitlePost: "",
    heroLeadPre:
      "Job Hunter est une équipe d'agents IA qui cherche du travail à ta place : elle trouve des postes, les analyse, les évalue selon ton profil et prépare les candidatures. Nous montrons ici ce qu'elle a produit sur ",
    heroLeadStrong: "de vrais profils de candidat",
    heroLeadPost:
      " — données agrégées et anonymes, aucune information personnelle.",
    heroSub:
      "C'est une page vivante : elle grandit à chaque nouvelle équipe suivie. Choisis une étude de cas ci-dessous pour voir tous les résultats.",
    positions: "postes",
    avgMatch: "correspondance moyenne",
    strongMatch: "correspondances fortes",
    moreComingTitle: "D'autres études de cas à venir",
    moreComingSub: "la tienne pourrait être la prochaine",
    contributeTitle: "📥 Contribue avec tes données",
    contributeLead:
      "Plus nous recueillons de profils réels, plus cette page devient utile pour qui cherche du travail. Lance Job Hunter sur ta recherche et partage les résultats (agrégés et anonymes) : il suffit de quelques étapes.",
    betaTitle: "🧪 Deviens testeur beta",
    betaBody:
      "Lance l'équipe pendant quelques semaines sur ta recherche et partage les résultats : on t'aide pour la configuration. Guide et modèle de données sur GitHub.",
    selfHostTitle: "🛠️ Auto-héberge & contribue",
    selfHostBody:
      "Installe Job Hunter en local ou sur ton VPS, utilise-le sur ta recherche et ouvre une PR avec tes données. Tout en open source.",
    repository: "Dépôt :",
    footer:
      "Données anonymes issues de runs réels de l'équipe · snapshots versionnés, aucune information personnelle du candidat.",
  },
  de: {
    metaTitle: "Fallstudien · Job Hunter Team",
    metaDescription:
      "Echte, anonyme Daten von Job-Hunter-Team-Agententeams, die auf echten Profilen laufen. Sieh dir die Ergebnisse an und steuere deine eigenen Daten bei.",
    heroKicker: "Fallstudien · echte, anonyme Felddaten",
    heroTitlePre: "Was ein Job Hunter-Team ",
    heroTitleEmph: "wirklich",
    heroTitlePost: " leistet",
    heroLeadPre:
      "Job Hunter ist ein Team von KI-Agenten, das für dich Arbeit sucht: Es findet Stellen, analysiert sie, bewertet sie anhand deines Profils und bereitet die Bewerbungen vor. Hier zeigen wir, was es auf ",
    heroLeadStrong: "echten Kandidatenprofilen",
    heroLeadPost:
      " produziert hat — aggregierte, anonyme Daten, keine persönlichen Informationen.",
    heroSub:
      "Es ist eine lebendige Seite: Sie wächst mit jedem neu beobachteten Team. Wähle unten eine Fallstudie, um alle Ergebnisse zu sehen.",
    positions: "Stellen",
    avgMatch: "durchschnittlicher Match",
    strongMatch: "starke Matches",
    moreComingTitle: "Weitere Fallstudien folgen",
    moreComingSub: "deine könnte die nächste sein",
    contributeTitle: "📥 Steuere deine Daten bei",
    contributeLead:
      "Je mehr echte Profile wir sammeln, desto nützlicher wird diese Seite für Jobsuchende. Lass Job Hunter auf deiner Suche laufen und teile die Ergebnisse (aggregiert und anonym): Es sind nur wenige Schritte.",
    betaTitle: "🧪 Werde Beta-Tester",
    betaBody:
      "Lass das Team ein paar Wochen auf deiner Suche laufen und teile die Ergebnisse: Wir helfen dir beim Setup. Anleitung und Datenmodell auf GitHub.",
    selfHostTitle: "🛠️ Selbst hosten & beitragen",
    selfHostBody:
      "Installiere Job Hunter lokal oder auf deinem VPS, nutze es für deine Suche und öffne einen PR mit deinen Daten. Komplett Open Source.",
    repository: "Repository:",
    footer:
      "Anonyme Daten aus echten Team-Runs · versionierte Snapshots, keine persönlichen Informationen des Kandidaten.",
  },
  hu: {
    metaTitle: "Esettanulmányok · Job Hunter Team",
    metaDescription:
      "Valós, anonim adatok valódi profilokon futó Job Hunter Team ügynökcsapatoktól. Nézd meg az eredményeket, és járulj hozzá a saját adataiddal.",
    heroKicker: "Esettanulmányok · valós, anonim terepadatok",
    heroTitlePre: "Mit csinál ",
    heroTitleEmph: "valójában",
    heroTitlePost: " egy Job Hunter csapat",
    heroLeadPre:
      "A Job Hunter AI-ügynökök csapata, amely helyetted keres munkát: pozíciókat talál, elemzi azokat, a profilodhoz méri őket, és előkészíti a jelentkezéseket. Itt megmutatjuk, mit produkált ",
    heroLeadStrong: "valódi jelölti profilokon",
    heroLeadPost:
      " — összesített, anonim adatok, semmilyen személyes információ.",
    heroSub:
      "Ez egy élő oldal: minden új megfigyelt csapattal bővül. Válassz egy esettanulmányt alább az összes eredmény megtekintéséhez.",
    positions: "pozíció",
    avgMatch: "átlagos egyezés",
    strongMatch: "erős egyezések",
    moreComingTitle: "További esettanulmányok érkeznek",
    moreComingSub: "a tiéd lehet a következő",
    contributeTitle: "📥 Járulj hozzá az adataiddal",
    contributeLead:
      "Minél több valódi profilt gyűjtünk, annál hasznosabb lesz ez az oldal az álláskeresőknek. Futtasd a Job Huntert a saját keresésedre, és oszd meg az eredményeket (összesítve és anonim módon): csak néhány lépés.",
    betaTitle: "🧪 Legyél béta tesztelő",
    betaBody:
      "Futtasd a csapatot néhány hétig a saját keresésedre, és oszd meg az eredményeket: segítünk a beállításban. Útmutató és adatmodell a GitHubon.",
    selfHostTitle: "🛠️ Önkiszolgáló üzemeltetés & hozzájárulás",
    selfHostBody:
      "Telepítsd a Job Huntert helyben vagy a saját VPS-eden, használd a keresésedre, és nyiss egy PR-t az adataiddal. Teljesen nyílt forráskódú.",
    repository: "Repository:",
    footer:
      "Anonim adatok valódi csapatfutásokból · verziózott pillanatképek, semmilyen személyes információ a jelöltről.",
  },
  pt: {
    metaTitle: "Estudos de caso · Job Hunter Team",
    metaDescription:
      "Dados reais e anónimos de equipas de agentes Job Hunter Team a correr sobre perfis reais. Veja os resultados e contribua com os seus dados.",
    heroKicker: "Estudos de caso · dados de campo reais e anónimos",
    heroTitlePre: "O que uma equipa Job Hunter ",
    heroTitleEmph: "realmente",
    heroTitlePost: " faz",
    heroLeadPre:
      "O Job Hunter é uma equipa de agentes de IA que procura trabalho por ti: encontra posições, analisa-as, avalia-as face ao teu perfil e prepara as candidaturas. Aqui mostramos o que produziu sobre ",
    heroLeadStrong: "perfis de candidato reais",
    heroLeadPost: " — dados agregados e anónimos, sem informação pessoal.",
    heroSub:
      "É uma página viva: cresce a cada nova equipa monitorizada. Escolhe um estudo de caso abaixo para ver todos os resultados.",
    positions: "posições",
    avgMatch: "correspondência média",
    strongMatch: "correspondências fortes",
    moreComingTitle: "Mais estudos de caso a caminho",
    moreComingSub: "o teu pode ser o próximo",
    contributeTitle: "📥 Contribui com os teus dados",
    contributeLead:
      "Quantos mais perfis reais recolhermos, mais útil esta página se torna para quem procura trabalho. Põe o Job Hunter a correr na tua pesquisa e partilha os resultados (agregados e anónimos): bastam poucos passos.",
    betaTitle: "🧪 Torna-te beta tester",
    betaBody:
      "Põe a equipa a correr durante algumas semanas na tua pesquisa e partilha os resultados: ajudamos-te com a configuração. Guia e modelo de dados no GitHub.",
    selfHostTitle: "🛠️ Auto-aloja & contribui",
    selfHostBody:
      "Instala o Job Hunter localmente ou no teu VPS, usa-o na tua pesquisa e abre um PR com os teus dados. Tudo open source.",
    repository: "Repositório:",
    footer:
      "Dados anónimos de execuções reais da equipa · snapshots versionados, sem informação pessoal do candidato.",
  },
};

export default async function CaseStudiesIndexPage() {
  const locale = await getRequestLocale();
  const t = T[locale];
  const nf = (n: number): string => n.toLocaleString(LOCALE_TAG[locale]);
  const localized = CASE_STUDIES.map((cs) => localizeCaseStudy(cs, locale));
  const testers: CaseStudyTeaser[] = localized.map((cs) => ({
    id: cs.id,
    label: cs.label,
    badge: cs.profile.badge,
    category: cs.category,
    seniority: cs.seniority,
    geos: cs.geos,
    model: cs.model,
  }));

  return (
    <main className="min-h-screen bg-[var(--color-panel)] text-[var(--color-white)]">
      <LandingI18nProvider>
        <LandingNav />
      </LandingI18nProvider>
      <div aria-hidden="true" className="h-14" />

      <CaseStudiesShell testers={testers}>
        {/* ── Hero / cos'è ──────────────────────────────────────── */}
        <header className="mb-12">
          <span className="text-[10px] font-semibold tracking-[0.18em] uppercase text-[var(--color-dim)]">
            {t.heroKicker}
          </span>
          <h1 className="mt-3 text-3xl sm:text-5xl font-bold tracking-tight leading-[1.05]">
            {t.heroTitlePre}
            <span style={{ color: "#00e676" }}>{t.heroTitleEmph}</span>
            {t.heroTitlePost}
          </h1>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-[var(--color-muted)]">
            {t.heroLeadPre}
            <strong className="text-[var(--color-white)]">
              {t.heroLeadStrong}
            </strong>
            {t.heroLeadPost}
          </p>
          <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-[var(--color-dim)]">
            {t.heroSub}
          </p>
        </header>

        {/* ── Card dei case study ───────────────────────────────── */}
        <section className="mb-14">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {localized.map((cs) => (
              <Link
                key={cs.id}
                href={`/case-studies/${cs.id}`}
                className="group block rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 transition-colors hover:border-[var(--color-blue)] no-underline"
              >
                <div className="flex items-center gap-3 mb-4">
                  <span
                    className="inline-flex items-center justify-center w-11 h-11 rounded-xl text-[14px] font-extrabold shrink-0"
                    style={{
                      background:
                        "color-mix(in srgb, var(--color-blue) 18%, transparent)",
                      color: "var(--color-blue)",
                    }}
                  >
                    {cs.profile.badge}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[14px] font-bold text-[var(--color-white)]">
                      {cs.label}
                    </div>
                    <div className="text-[11px] text-[var(--color-dim)] truncate">
                      {cs.tagline}
                    </div>
                  </div>
                  <span className="ml-auto text-[var(--color-dim)] group-hover:text-[var(--color-blue)] transition-colors">
                    →
                  </span>
                </div>
                <p className="text-[12px] text-[var(--color-muted)] leading-relaxed line-clamp-2 mb-4">
                  {cs.profile.headline} · {cs.profile.summary}
                </p>
                <div className="grid grid-cols-3 gap-2 border-t border-[var(--color-border)] pt-3">
                  <div>
                    <div
                      className="text-[18px] font-extrabold tabular-nums"
                      style={{ color: "var(--color-blue)" }}
                    >
                      {nf(cs.run.totals.positions)}
                    </div>
                    <div className="text-[9px] uppercase tracking-wide text-[var(--color-dim)]">
                      {t.positions}
                    </div>
                  </div>
                  <div>
                    <div
                      className="text-[18px] font-extrabold tabular-nums"
                      style={{ color: "#00e676" }}
                    >
                      {Math.round(cs.run.match.avg)}
                    </div>
                    <div className="text-[9px] uppercase tracking-wide text-[var(--color-dim)]">
                      {t.avgMatch}
                    </div>
                  </div>
                  <div>
                    <div
                      className="text-[18px] font-extrabold tabular-nums"
                      style={{ color: "#00e676" }}
                    >
                      {nf(cs.run.match.strong70)}
                    </div>
                    <div className="text-[9px] uppercase tracking-wide text-[var(--color-dim)]">
                      {t.strongMatch}
                    </div>
                  </div>
                </div>
              </Link>
            ))}

            {/* placeholder: altri in arrivo */}
            <div className="rounded-2xl border border-dashed border-[var(--color-border)] p-5 flex items-center justify-center text-center opacity-70">
              <div>
                <div className="text-2xl mb-1">➕</div>
                <div className="text-[12px] text-[var(--color-muted)] font-semibold">
                  {t.moreComingTitle}
                </div>
                <div className="text-[11px] text-[var(--color-dim)] mt-1">
                  {t.moreComingSub}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Contribuisci ──────────────────────────────────────── */}
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-6 sm:p-8">
          <h2 className="text-xl font-bold tracking-tight">
            {t.contributeTitle}
          </h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[var(--color-muted)]">
            {t.contributeLead}
          </p>
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <a
              href={CONTRIBUTE_LINKS.results}
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-xl border border-[#00e676]/40 bg-[var(--color-bg)] p-5 transition-colors hover:border-[#00e676] no-underline"
            >
              <div className="text-[13px] font-bold text-[var(--color-white)]">
                {t.betaTitle}{" "}
                <span
                  className="inline-block transition-transform group-hover:translate-x-0.5"
                  style={{ color: "#00e676" }}
                >
                  →
                </span>
              </div>
              <p className="mt-1.5 text-[12px] text-[var(--color-muted)] leading-relaxed">
                {t.betaBody}
              </p>
            </a>
            <a
              href={CONTRIBUTE_LINKS.contributing}
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-5 transition-colors hover:border-[var(--color-blue)] no-underline"
            >
              <div className="text-[13px] font-bold text-[var(--color-white)]">
                {t.selfHostTitle}{" "}
                <span className="inline-block transition-transform group-hover:translate-x-0.5 text-[var(--color-blue)]">
                  →
                </span>
              </div>
              <p className="mt-1.5 text-[12px] text-[var(--color-muted)] leading-relaxed">
                {t.selfHostBody}
              </p>
            </a>
          </div>
          <div className="mt-5 text-[11px] text-[var(--color-dim)]">
            {t.repository}{" "}
            <a
              href={CONTRIBUTE_LINKS.repo}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-muted)] underline hover:text-[var(--color-white)]"
            >
              github.com/leopu00/job-hunter-team
            </a>
          </div>
        </section>
      </CaseStudiesShell>

      <footer className="border-t border-[var(--color-border)] py-6 text-center text-[11px] text-[var(--color-muted)]">
        {t.footer}
      </footer>
    </main>
  );
}
