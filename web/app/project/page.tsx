"use client";

import { Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LandingI18nProvider,
  useLandingI18n,
} from "../components/landing/LandingI18n";
import LandingNav from "../components/landing/LandingNav";
import { LandingFooter } from "../components/landing/LandingCTA";
import ScrollToTop from "../components/landing/ScrollToTop";

const GITHUB = "https://github.com/leopu00/job-hunter-team";

// Indice (0-based) del capitolo dopo cui mostrare l'immagine (≈ metà pagina).
const IMAGE_AFTER = 1;

type Chapter = { h: string; p: string[]; note?: string };
type Copy = {
  title: string;
  subtitle: string;
  badge: string;
  imageAlt: string;
  imageCaption: string;
  back: string;
  chapters: Chapter[];
  ctaKicker: string;
  tryTitle: string;
  tryBody: string;
  tryCta: string;
  devTitle: string;
  devBody: string;
  devCta: string;
};

// Testi completi in IT + EN. Le altre lingue ricadono su EN finché i contenuti
// non sono approvati (poi si traducono — evita di rifare 5 lingue a ogni
// revisione della copy).
const it: Copy = {
  title: "Il progetto",
  subtitle:
    "Un team di agenti AI che cerca lavoro per te e ti aiuta a orientarti tra le offerte.",
  badge: "open source",
  imageAlt:
    "Illustrazione: un cubo di vetro che racchiude un ufficio in miniatura con il team di agenti al lavoro, osservato da fuori da due persone che prendono appunti.",
  imageCaption:
    "Dietro al vetro, il team di agenti al lavoro. Fuori, i maintainer del progetto: ne osservano il comportamento e ne affinano il codice.",
  back: "← Indietro",
  chapters: [
    {
      h: "Cosa fa",
      p: [
        "Job Hunter Team è una squadra di agenti AI che cerca lavoro per te. Anziché inviare candidature a tappeto, individua le offerte più affini al tuo profilo, le valuta una per una e ti indica dove conviene concentrarti e quali aspetti rafforzare.",
        "Poche candidature, ma mirate. La decisione finale — quando e a chi inviare — resta sempre tua.",
      ],
    },
    {
      h: "Da dove nasce",
      p: [
        "Il progetto nasce da un'esigenza concreta: cercare lavoro in un mercato in cui la maggior parte delle candidature resta senza risposta. Sviluppato inizialmente da un singolo sviluppatore per uso personale, nell'arco di due settimane ha individuato e analizzato circa 200 offerte, ne ha preparate una ventina su misura e ha portato a cinque colloqui.",
        "I risultati sono bastati a giustificarne l'apertura: da strumento privato è diventato un progetto pubblico e open source, pensato per chiunque affronti la stessa ricerca.",
      ],
    },
    {
      h: "Un mondo del lavoro che cambia",
      p: [
        "Il mondo del lavoro sta cambiando rapidamente e trovare un'occupazione è sempre più difficile. Molte persone si troveranno a ridefinire il proprio ruolo e ad adattarsi a un mercato in costante evoluzione.",
        "Una piattaforma che si adatta al mercato reale risponde proprio a questa esigenza: avvicina le persone a ciò che cercano e contribuisce a distribuire le opportunità in modo più equo, anziché favorire soltanto chi riesce a farsi notare di più.",
      ],
    },
    {
      h: "Il nodo del costo",
      p: [
        "L'ostacolo principale è il costo dell'AI. Con la tariffazione a consumo, una squadra di agenti che lavora in parallelo può arrivare a spendere centinaia di euro al giorno: una soglia inaccessibile per la maggior parte delle persone.",
        "La sfida tecnica più impegnativa è stata far funzionare il team su un abbonamento mensile a costo fisso, dove a parità di spesa si dispone di circa dieci volte i token della tariffazione a consumo. Il sistema monitora autonomamente il proprio budget e distribuisce il lavoro nell'arco della giornata, mantenendo un ritmo sostenibile anziché esaurire la quota in poche ore.",
      ],
      note: "Gli abbonamenti AI sono pensati per lo sviluppo e l'uso diretto delle persone, non per un'attività autonoma su larga scala: è l'equilibrio delicato che tiene il progetto a un costo sostenibile. Per questo è importante un uso misurato e responsabile, che resta a discrezione dell'utente.",
    },
    {
      h: "Un progetto aperto",
      p: [
        "È per questo che il progetto è open source. Agli sviluppatori chiediamo di contribuire: ogni miglioramento rende l'AI uno strumento più utile a chi cerca lavoro e concorre a un mercato più aperto e trasparente.",
        "A chi cerca lavoro chiediamo di provarlo e di condividere un riscontro: è dai casi reali che la piattaforma apprende e migliora.",
      ],
    },
  ],
  ctaKicker: "Partecipa",
  tryTitle: "Provalo e lascia un riscontro",
  tryBody:
    "Scaricalo, eseguilo in locale sul tuo computer e condividi la tua esperienza: ogni caso reale contribuisce a migliorarlo. I tuoi dati restano sempre tuoi.",
  tryCta: "Scarica →",
  devTitle: "Contribuisci",
  devBody:
    "Il progetto è aperto: architettura, agenti e dettagli tecnici sono documentati nella repository. Pull request e proposte sono benvenute.",
  devCta: "Vai alla repository →",
};

const en: Copy = {
  title: "The project",
  subtitle:
    "An AI agent team that searches for work on your behalf and helps you navigate the market.",
  badge: "open source",
  imageAlt:
    "Illustration: a glass cube holding a miniature office with the team of agents at work, watched from outside by two people taking notes.",
  imageCaption:
    "Behind the glass, the agent team at work. Outside, the project's maintainers: they observe its behavior and refine the code.",
  back: "← Back",
  chapters: [
    {
      h: "What it does",
      p: [
        "Job Hunter Team is a team of AI agents that searches for work on your behalf. Rather than submitting applications indiscriminately, it identifies the openings best suited to your profile, evaluates each one, and shows you where to focus and what to strengthen.",
        "Fewer applications, but targeted ones. The final decision — when and where to apply — always remains yours.",
      ],
    },
    {
      h: "Where it comes from",
      p: [
        "The project grew out of a concrete need: searching for work in a market where most applications go unanswered. Initially developed by a single developer for personal use, within two weeks it had identified and analyzed around 200 openings, prepared roughly twenty tailored applications, and led to five interviews.",
        "The results were enough to justify opening it up: from a private tool it became a public, open-source project, intended for anyone facing the same search.",
      ],
    },
    {
      h: "A changing world of work",
      p: [
        "The world of work is changing rapidly, and finding a job is becoming increasingly difficult. Many people will need to redefine their role and adapt to a market in constant flux.",
        "A platform that adapts to the real market addresses precisely this need: it brings people closer to what they are looking for and helps distribute opportunity more fairly, rather than favoring only those who manage to stand out the most.",
      ],
    },
    {
      h: "The cost question",
      p: [
        "The principal obstacle is the cost of AI. Under pay-per-use pricing, a team of agents working in parallel can spend hundreds of euros a day — a threshold beyond the reach of most people.",
        "The most demanding technical challenge was running the team on a fixed-price monthly subscription, where the same budget provides roughly ten times the tokens of pay-per-use. The system monitors its own budget and distributes its work across the day, keeping a sustainable pace rather than exhausting the quota within a few hours.",
      ],
      note: "AI subscriptions are designed for development and for people's direct use, not for autonomous, large-scale activity: it is the delicate balance that keeps the project affordable. This makes measured, responsible use important — and that remains up to the user.",
    },
    {
      h: "An open project",
      p: [
        "This is why the project is open source. We invite developers to contribute: every improvement makes AI a more useful tool for those seeking work and contributes to a more open, transparent market.",
        "We invite job seekers to try it and share their feedback: it is from real cases that the platform learns and improves.",
      ],
    },
  ],
  ctaKicker: "Get involved",
  tryTitle: "Try it and share feedback",
  tryBody:
    "Download it, run it locally on your own machine, and share your experience: every real case helps improve it. Your data always stays yours.",
  tryCta: "Download →",
  devTitle: "Contribute",
  devBody:
    "The project is open: its architecture, agents, and technical details are documented in the repository. Pull requests and ideas are welcome.",
  devCta: "Go to the repository →",
};

const T: Record<string, Copy> = {
  it,
  en,
  hu: en,
  es: en,
  de: en,
  fr: en,
  pt: en,
};

function BackLink({ label }: { label: string }) {
  const router = useRouter();
  const handleBack = () => {
    if (window.history.length > 1) router.back();
    else router.push("/");
  };
  return (
    <button
      onClick={handleBack}
      className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors cursor-pointer bg-transparent border-0"
    >
      {label}
    </button>
  );
}

function ProjectContent() {
  const { lang } = useLandingI18n();
  const t = T[lang] ?? en;

  return (
    <>
      <LandingNav />
      <main
        className="px-5 sm:px-6 pt-28 pb-16 max-w-5xl mx-auto"
        style={{ animation: "fade-in 0.4s ease both" }}
      >
        {/* Hero */}
        <div className="text-center mb-8">
          <h1 className="text-3xl md:text-5xl font-bold text-[var(--color-white)] tracking-tight leading-[1.05] mb-4">
            {t.title}
          </h1>
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 border border-[var(--color-border)] mb-5"
            style={{ background: "var(--color-deep)" }}
          >
            <span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[var(--color-green)]">
              {t.badge}
            </span>
          </div>
          <p className="text-[14px] md:text-[16px] text-[var(--color-muted)] max-w-2xl mx-auto leading-relaxed">
            {t.subtitle}
          </p>
        </div>

        {/* Capitoli — l'immagine compare a metà (dopo IMAGE_AFTER) così chi
            legge incontra un respiro visivo a metà strada. */}
        <div className="flex flex-col gap-10">
          {t.chapters.map((c, i) => (
            <Fragment key={i}>
              <section>
                <h2 className="text-[17px] md:text-[19px] font-bold text-[var(--color-white)] tracking-tight mb-3">
                  {c.h}
                </h2>
                <div className="flex flex-col gap-3">
                  {c.p.map((para, j) => (
                    <p
                      key={j}
                      className="text-[13px] md:text-[14px] text-[var(--color-bright)] leading-relaxed"
                    >
                      {para}
                    </p>
                  ))}
                  {c.note && (
                    <div className="mt-1 border border-[var(--color-border)] bg-[var(--color-deep)] px-4 py-3">
                      <p className="text-[12px] md:text-[13px] text-[var(--color-muted)] leading-relaxed">
                        <span className="mr-1">⚠️</span>
                        {c.note}
                      </p>
                    </div>
                  )}
                </div>
              </section>
              {i === IMAGE_AFTER && (
                <figure className="my-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/the-box.png"
                    alt={t.imageAlt}
                    width={1672}
                    height={941}
                    className="w-full h-auto"
                  />
                  <figcaption className="mt-2 text-center text-[11px] text-[var(--color-dim)] max-w-xl mx-auto leading-relaxed">
                    {t.imageCaption}
                  </figcaption>
                </figure>
              )}
            </Fragment>
          ))}
        </div>

        {/* CTA */}
        <section className="mt-14">
          <div className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[var(--color-dim)] mb-4">
            {t.ctaKicker}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Solo il TITOLO è il link (verde): il corpo è testo normale, così
                al hover non si sottolinea/colora l'intero riquadro. */}
            <div className="border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
              <Link
                href="/download"
                className="group inline-flex items-center gap-2 text-[14px] font-bold no-underline"
              >
                {t.tryTitle}
                <span className="transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </Link>
              <p className="mt-2 text-[12px] text-[var(--color-muted)] leading-relaxed">
                {t.tryBody}
              </p>
            </div>
            <div className="border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
              <a
                href={GITHUB}
                target="_blank"
                rel="noreferrer"
                className="group inline-flex items-center gap-2 text-[14px] font-bold no-underline"
              >
                {t.devTitle}
                <span className="transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </a>
              <p className="mt-2 text-[12px] text-[var(--color-muted)] leading-relaxed">
                {t.devBody}
              </p>
            </div>
          </div>
        </section>

        <div className="mt-10 flex justify-center">
          <BackLink label={t.back} />
        </div>
      </main>
      <LandingFooter />
      <ScrollToTop />
    </>
  );
}

export default function ProjectPage() {
  return (
    <LandingI18nProvider>
      <ProjectContent />
    </LandingI18nProvider>
  );
}
