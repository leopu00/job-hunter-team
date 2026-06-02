"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LandingI18nProvider,
  useLandingI18n,
} from "../components/landing/LandingI18n";
import LandingNav from "../components/landing/LandingNav";
import { LandingFooter } from "../components/landing/LandingCTA";
import ScrollToTop from "../components/landing/ScrollToTop";

const T = {
  it: {
    title: "Panoramica del progetto",
    subtitle: "Un team di agenti AI che cerca lavoro per te.",
    back: "← Indietro",
    open_source: "open source",
    repo_cta: "Repository",
    story_title: "Storia e obiettivo",
    story_body_1:
      "Job Hunter Team nasce come progetto open source per automatizzare la ricerca di lavoro con una pipeline di agenti AI specializzati, eseguita in locale e controllata dall'utente.",
    story_body_2:
      "L'obiettivo è costruire uno strumento accessibile a tutti: chi preferisce semplicità può scaricare il launcher desktop e usare l'interfaccia web, mentre chi ha competenze tecniche può clonare la repository o utilizzare la TUI per un controllo avanzato.",
    story_body_3:
      "Il software è gratuito e open source: JHT non ti fattura nulla. Paghi solo un abbonamento AI dedicato (Claude Code, Codex o Kimi): il team lo consuma tutto, quindi tienilo separato da quello che usi ogni giorno. Le contribuzioni degli sviluppatori sono benvenute per mettere l'AI dalla parte dei lavoratori, non contro.",
  },
  en: {
    title: "Company overview",
    subtitle: "An AI agent team that finds jobs for you.",
    back: "← Back",
    open_source: "open source",
    repo_cta: "Repository",
    story_title: "History and goal",
    story_body_1:
      "Job Hunter Team started as an open source project to automate job hunting through a pipeline of specialized AI agents, running locally inside a Docker container and controlled by the user.",
    story_body_2:
      "The goal is to build a tool accessible to everyone: those who prefer simplicity download the desktop launcher that handles the container for you, while technical users can clone the repository and work with the CLI/TUI directly.",
    story_body_3:
      "The software is free and open source: JHT never bills you. You only pay for a dedicated AI subscription (Claude Code, Codex or Kimi): the team uses it fully, so keep it separate from your everyday account. Developer contributions are welcome to keep AI on the side of workers, not against them.",
  },
  hu: {
    title: "Projekt áttekintése",
    subtitle: "Egy AI ügynök csapat, amely állást keres neked.",
    back: "← Vissza",
    open_source: "nyílt forráskód",
    repo_cta: "Repository",
    story_title: "Történet és cél",
    story_body_1:
      "A Job Hunter Team nyílt forráskódú projektként indult, hogy specializált AI ügynökök csővezetékével automatizálja az álláskeresést. A rendszer helyben, egy Docker konténeren belül fut, és a felhasználó irányítja.",
    story_body_2:
      "A cél egy mindenki számára hozzáférhető eszköz építése: aki az egyszerűséget kedveli, letölti az asztali launchert, amely a konténert helyetted kezeli; a műszaki felhasználók klónozhatják a repository-t és közvetlenül dolgozhatnak a CLI/TUI felülettel.",
    story_body_3:
      "A szoftver ingyenes és nyílt forráskódú: a JHT soha nem számláz neked. Csak egy dedikált AI előfizetést fizetsz (Claude Code, Codex vagy Kimi): a csapat teljesen felhasználja, ezért tartsd külön a napi fiókodtól. A fejlesztői közreműködéseket szívesen fogadjuk, hogy az AI a dolgozók oldalán álljon, ne ellenük.",
  },
} as const;

function BackLink({ label }: { label: string }) {
  const router = useRouter();

  const handleBack = () => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
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

function CompanyContent() {
  const { lang } = useLandingI18n();
  const t = T[lang] ?? T.en;

  // The WebCompany JSON-LD that used to live here was a duplicate of the one
  // emitted by `project/layout.tsx` (server component) with the same
  // schema.org @type and isPartOf. The layout's nonce-tagged version is
  // the canonical one under the strict CSP; this client component cannot
  // read the nonce, so the duplicate is removed rather than leaving a
  // CSP-violating tag on the page.
  return (
    <>
      <LandingNav />
      <main
        className="px-5 sm:px-6 pt-28 pb-16 max-w-5xl mx-auto"
        style={{ animation: "fade-in 0.4s ease both" }}
      >
        <div className="text-center mb-12">
          <h1 className="text-2xl md:text-4xl font-bold text-[var(--color-white)] tracking-tight mb-3">
            {t.title}
          </h1>
          <p className="text-[13px] text-[var(--color-muted)] max-w-2xl mx-auto leading-relaxed">
            {t.subtitle}
          </p>
          <div className="mt-6 flex flex-col items-center gap-3">
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 border border-[var(--color-border)]"
              style={{ background: "var(--color-deep)" }}
            >
              <span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[var(--color-green)]">
                {t.open_source}
              </span>
            </div>
          </div>
        </div>

        <section
          className="p-6 border border-[var(--color-border)]"
          style={{ background: "var(--color-panel)" }}
        >
          <h2 className="text-[15px] font-bold text-[var(--color-white)] mb-4">
            {t.story_title}
          </h2>
          <div className="flex flex-col gap-4">
            <p className="text-[12px] md:text-[13px] text-[var(--color-bright)] leading-relaxed">
              {t.story_body_1}
            </p>
            <p className="text-[12px] md:text-[13px] text-[var(--color-bright)] leading-relaxed">
              {t.story_body_2}
            </p>
            <p className="text-[12px] md:text-[13px] text-[var(--color-bright)] leading-relaxed">
              {t.story_body_3}
            </p>
          </div>
        </section>

        <div className="mt-8 flex justify-center">
          <BackLink label={t.back} />
        </div>
      </main>
      <LandingFooter />
      <ScrollToTop />
    </>
  );
}

export default function CompanyCompany() {
  return (
    <LandingI18nProvider>
      <CompanyContent />
    </LandingI18nProvider>
  );
}
