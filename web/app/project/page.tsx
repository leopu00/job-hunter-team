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
    title: "Project overview",
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
  es: {
    title: "Descripción del proyecto",
    subtitle: "Un equipo de agentes de IA que busca trabajo por ti.",
    back: "← Atrás",
    open_source: "código abierto",
    repo_cta: "Repositorio",
    story_title: "Historia y objetivo",
    story_body_1:
      "Job Hunter Team nació como un proyecto de código abierto para automatizar la búsqueda de empleo mediante una cadena de agentes de IA especializados, que se ejecuta localmente dentro de un contenedor Docker y está controlada por el usuario.",
    story_body_2:
      "El objetivo es construir una herramienta accesible para todos: quienes prefieren la simplicidad descargan el lanzador de escritorio que gestiona el contenedor por ti, mientras que los usuarios técnicos pueden clonar el repositorio y trabajar directamente con la CLI/TUI.",
    story_body_3:
      "El software es gratuito y de código abierto: JHT nunca te factura. Solo pagas una suscripción de IA dedicada (Claude Code, Codex o Kimi): el equipo la consume por completo, así que mantenla separada de tu cuenta de uso diario. Las contribuciones de los desarrolladores son bienvenidas para poner la IA del lado de los trabajadores, no en su contra.",
  },
  de: {
    title: "Projektübersicht",
    subtitle: "Ein KI-Agenten-Team, das Jobs für dich findet.",
    back: "← Zurück",
    open_source: "Open Source",
    repo_cta: "Repository",
    story_title: "Geschichte und Ziel",
    story_body_1:
      "Job Hunter Team begann als Open-Source-Projekt, um die Jobsuche über eine Pipeline spezialisierter KI-Agenten zu automatisieren, die lokal in einem Docker-Container läuft und vom Nutzer gesteuert wird.",
    story_body_2:
      "Das Ziel ist es, ein für alle zugängliches Werkzeug zu schaffen: Wer Einfachheit bevorzugt, lädt den Desktop-Launcher herunter, der den Container für dich verwaltet, während technische Nutzer das Repository klonen und direkt mit der CLI/TUI arbeiten können.",
    story_body_3:
      "Die Software ist kostenlos und Open Source: JHT stellt dir niemals etwas in Rechnung. Du zahlst nur für ein dediziertes KI-Abonnement (Claude Code, Codex oder Kimi): Das Team verbraucht es vollständig, halte es daher von deinem Alltagskonto getrennt. Beiträge von Entwicklern sind willkommen, damit die KI auf der Seite der Arbeitnehmer steht und nicht gegen sie.",
  },
  fr: {
    title: "Présentation du projet",
    subtitle: "Une équipe d'agents IA qui trouve des emplois pour vous.",
    back: "← Retour",
    open_source: "open source",
    repo_cta: "Dépôt",
    story_title: "Histoire et objectif",
    story_body_1:
      "Job Hunter Team a débuté comme un projet open source visant à automatiser la recherche d'emploi grâce à un pipeline d'agents IA spécialisés, exécuté localement dans un conteneur Docker et contrôlé par l'utilisateur.",
    story_body_2:
      "L'objectif est de construire un outil accessible à tous : ceux qui préfèrent la simplicité téléchargent le lanceur de bureau qui gère le conteneur pour vous, tandis que les utilisateurs techniques peuvent cloner le dépôt et travailler directement avec la CLI/TUI.",
    story_body_3:
      "Le logiciel est gratuit et open source : JHT ne vous facture jamais rien. Vous ne payez qu'un abonnement IA dédié (Claude Code, Codex ou Kimi) : l'équipe le consomme entièrement, alors gardez-le séparé de votre compte quotidien. Les contributions des développeurs sont les bienvenues pour mettre l'IA du côté des travailleurs, et non contre eux.",
  },
  pt: {
    title: "Visão geral do projeto",
    subtitle: "Uma equipa de agentes de IA que procura emprego por si.",
    back: "← Voltar",
    open_source: "código aberto",
    repo_cta: "Repositório",
    story_title: "História e objetivo",
    story_body_1:
      "O Job Hunter Team nasceu como um projeto de código aberto para automatizar a procura de emprego através de uma pipeline de agentes de IA especializados, executada localmente dentro de um contentor Docker e controlada pelo utilizador.",
    story_body_2:
      "O objetivo é construir uma ferramenta acessível a todos: quem prefere a simplicidade descarrega o lançador de ambiente de trabalho que gere o contentor por si, enquanto os utilizadores técnicos podem clonar o repositório e trabalhar diretamente com a CLI/TUI.",
    story_body_3:
      "O software é gratuito e de código aberto: o JHT nunca lhe cobra nada. Paga apenas uma subscrição de IA dedicada (Claude Code, Codex ou Kimi): a equipa consome-a totalmente, por isso mantenha-a separada da sua conta do dia a dia. As contribuições dos programadores são bem-vindas para colocar a IA do lado dos trabalhadores, e não contra eles.",
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

function ProjectContent() {
  const { lang } = useLandingI18n();
  const t = T[lang as keyof typeof T] ?? T.en;

  // The WebPage JSON-LD that used to live here was a duplicate of the one
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

export default function ProjectPage() {
  return (
    <LandingI18nProvider>
      <ProjectContent />
    </LandingI18nProvider>
  );
}
