"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CopyButton } from "../components/CopyButton";
import {
  LandingI18nProvider,
  useLandingI18n,
  type Lang,
} from "../components/landing/LandingI18n";
import LandingNav from "../components/landing/LandingNav";
import { LandingFooter } from "../components/landing/LandingCTA";
import ScrollToTop from "../components/landing/ScrollToTop";
import { type DownloadAttribution } from "@/lib/download-funnel";

function BackLink() {
  const { t } = useLandingI18n();
  const router = useRouter();
  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1)
      router.back();
    else router.push("/");
  };
  return (
    <button
      onClick={handleBack}
      className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors cursor-pointer bg-transparent border-0"
    >
      {t("dl_back")}
    </button>
  );
}

// 0.4.0: l'app desktop non è nella versione. La pagina parte dalla CLI (il
// comando unico) e offre il prompt per un assistente; nessuna scheda né link a
// un DMG. Windows è un'anteprima della CLI, come dice il README.
type InstallMode = "terminal" | "prompt";

type DlKey = Parameters<ReturnType<typeof useLandingI18n>["t"]>[0];
const MODES: { id: InstallMode; labelKey: DlKey }[] = [
  { id: "terminal", labelKey: "dl_mode_terminal_title" },
  { id: "prompt", labelKey: "dl_mode_prompt_title" },
];

const CLI_SETUP_CMD = `curl -fsSL https://jobhunterteam.ai/install.sh | bash -s -- --runtime podman`;

// Il prompt da consegnare a un assistente AI. Esisteva fino ad `a494c6259`
// (3 lug 2026), ritirato allora perché «non ha convinto»; rimesso su richiesta
// dell'operatore il 2026-08-10.
// ⚠️ NON è il testo di allora: da luglio sono cambiati la pagina, il flusso e
// i comandi. Un prompt che manda l'assistente a fare cose che non esistono più
// è peggio del metodo assente, quindi qui si nomina la strada che esiste
// davvero nella 0.4.0 — il one-liner qui sopra (l'app desktop non è nella
// 0.4.0) — e si rimanda alla guida per il resto.
// Nessuna cifra né nome di piano commerciale: vale anche qui la regola O-12.
//
// TRADOTTO in tutte e 7 le lingue (2026-08-10): il prompt lo legge un
// assistente, ma lo copia una persona, e leggere intorno nella propria lingua
// per poi trovare un blocco in inglese è un salto che non serve a nessuno. Gli
// assistenti gestiscono bene tutte e sette, e col prompt nella sua lingua
// l'utente si vede rispondere nella sua lingua. Restano invariati, perché non
// si traducono: URL, nome del prodotto e il comando `curl`.
const ASSISTANT_PROMPT: Record<Lang, string> = {
  it: `Vorrei iniziare a usare Job Hunter Team, una squadra open source di agenti AI che cerca lavoro per me. Gira sul mio computer, dentro un container.

Repository: https://github.com/leopu00/job-hunter-team
Sito: https://jobhunterteam.ai
Guida all'installazione: https://jobhunterteam.ai/setup-guide

Leggi prima il repository e la guida, poi guidami nell'installazione e nell'avvio su questo computer, occupandoti tu dei passaggi tecnici.

C'è una strada sola, la CLI jht (l'app desktop non è nella 0.4.0): curl -fsSL https://jobhunterteam.ai/install.sh | bash -s -- --runtime podman

Due cose da verificare con me lungo la strada: che sul Mac Homebrew sia già installato (l'installer lo usa per installare Podman, il motore dei container) e la chiave API GLM (Z.ai) che userà la squadra — meglio una chiave solo sua, separata da quelle che uso ogni giorno, con un tetto di spesa. Chiedimi tutto il resto invece di indovinare.`,
  en: `I'd like to start using Job Hunter Team, an open-source team of AI agents that searches for jobs on my behalf. It runs on my own machine, in a container.

Repository: https://github.com/leopu00/job-hunter-team
Website: https://jobhunterteam.ai
Setup guide: https://jobhunterteam.ai/setup-guide

Read the repository and the setup guide first, then walk me through installing and starting it on this computer, handling the technical steps yourself.

There is one way in, the jht CLI (the desktop app is not in 0.4.0): curl -fsSL https://jobhunterteam.ai/install.sh | bash -s -- --runtime podman

Two things you will need to check with me along the way: that on a Mac Homebrew is already installed (the installer uses it to install Podman, the container engine), and the GLM (Z.ai) API key the team will use — better a key of its own, separate from the ones I use day to day, with a spending ceiling. Ask me whatever else you need instead of guessing.`,
  es: `Quiero empezar a usar Job Hunter Team, un equipo open source de agentes de IA que busca trabajo por mí. Funciona en mi propio ordenador, dentro de un contenedor.

Repositorio: https://github.com/leopu00/job-hunter-team
Sitio web: https://jobhunterteam.ai
Guía de instalación: https://jobhunterteam.ai/setup-guide

Lee primero el repositorio y la guía, y después acompáñame en la instalación y el arranque en este ordenador, ocupándote tú de los pasos técnicos.

Hay un solo camino, la CLI jht (la app de escritorio no está en la 0.4.0): curl -fsSL https://jobhunterteam.ai/install.sh | bash -s -- --runtime podman

Dos cosas que tendrás que comprobar conmigo por el camino: que en Mac Homebrew esté ya instalado (el instalador lo usa para instalar Podman, el motor de contenedores) y la clave API de GLM (Z.ai) que usará el equipo — mejor una clave solo suya, separada de las que uso a diario, con un límite de gasto. Pregúntame todo lo demás en lugar de suponerlo.`,
  fr: `J'aimerais commencer à utiliser Job Hunter Team, une équipe open source d'agents IA qui cherche du travail pour moi. Elle tourne sur mon ordinateur, dans un conteneur.

Dépôt : https://github.com/leopu00/job-hunter-team
Site : https://jobhunterteam.ai
Guide d'installation : https://jobhunterteam.ai/setup-guide

Lis d'abord le dépôt et le guide, puis accompagne-moi pour l'installer et le démarrer sur cet ordinateur, en te chargeant toi-même des étapes techniques.

Il n'y a qu'une voie, la CLI jht (l'application de bureau n'est pas dans la 0.4.0) : curl -fsSL https://jobhunterteam.ai/install.sh | bash -s -- --runtime podman

Deux choses à vérifier avec moi en chemin : que sur Mac Homebrew soit déjà installé (l'installateur s'en sert pour installer Podman, le moteur de conteneurs) et la clé API GLM (Z.ai) qu'utilisera l'équipe — mieux vaut une clé à elle, distincte de celles que j'utilise au quotidien, avec un plafond de dépenses. Demande-moi tout le reste au lieu de deviner.`,
  de: `Ich möchte anfangen, Job Hunter Team zu nutzen — ein Open-Source-Team aus KI-Agenten, das für mich nach Stellen sucht. Es läuft auf meinem eigenen Rechner, in einem Container.

Repository: https://github.com/leopu00/job-hunter-team
Website: https://jobhunterteam.ai
Einrichtungsanleitung: https://jobhunterteam.ai/setup-guide

Lies zuerst das Repository und die Anleitung, und führe mich dann durch Installation und Start auf diesem Rechner, wobei du die technischen Schritte selbst übernimmst.

Es gibt einen Weg, die jht-CLI (die Desktop-App ist nicht in 0.4.0): curl -fsSL https://jobhunterteam.ai/install.sh | bash -s -- --runtime podman

Zwei Dinge, die du unterwegs mit mir klären musst: dass auf einem Mac Homebrew bereits installiert ist (der Installer nutzt es, um Podman, die Container-Engine, zu installieren) und welchen GLM-(Z.ai)-API-Schlüssel das Team nutzt — am besten einen eigenen, getrennt von denen, die ich täglich nutze, mit einer Ausgabengrenze. Frag mich alles Weitere, statt zu raten.`,
  pt: `Gostaria de começar a usar o Job Hunter Team, uma equipa open source de agentes de IA que procura emprego por mim. Corre no meu próprio computador, dentro de um contentor.

Repositório: https://github.com/leopu00/job-hunter-team
Site: https://jobhunterteam.ai
Guia de instalação: https://jobhunterteam.ai/setup-guide

Lê primeiro o repositório e o guia, e depois acompanha-me na instalação e no arranque neste computador, tratando tu dos passos técnicos.

Há um só caminho, a CLI jht (a app de ambiente de trabalho não está na 0.4.0): curl -fsSL https://jobhunterteam.ai/install.sh | bash -s -- --runtime podman

Duas coisas que terás de verificar comigo pelo caminho: que no Mac o Homebrew esteja já instalado (o instalador usa-o para instalar o Podman, o motor de contentores) e a chave API GLM (Z.ai) que a equipa vai usar — melhor uma chave só dela, separada das que uso no dia a dia, com um teto de despesa. Pergunta-me tudo o resto em vez de adivinhar.`,
  hu: `Szeretném elkezdeni használni a Job Hunter Teamet, egy nyílt forráskódú AI-ügynökcsapatot, amely helyettem keres állást. A saját gépemen fut, konténerben.

Repository: https://github.com/leopu00/job-hunter-team
Weboldal: https://jobhunterteam.ai
Telepítési útmutató: https://jobhunterteam.ai/setup-guide

Először olvasd el a repositoryt és az útmutatót, majd vezess végig a telepítésen és az indításon ezen a gépen, a technikai lépéseket te intézve.

Egyetlen út van, a jht CLI (az asztali alkalmazás nincs a 0.4.0-ban): curl -fsSL https://jobhunterteam.ai/install.sh | bash -s -- --runtime podman

Két dolgot kell majd velem tisztáznod útközben: hogy Macen a Homebrew már telepítve van-e (a telepítő ezzel telepíti a Podmant, a konténermotort), és melyik GLM (Z.ai) API-kulcsot használja a csapat — jobb egy saját kulcs, elkülönítve azoktól, amelyeket naponta használok, költségkerettel. Minden mást kérdezz meg tőlem, ahelyett hogy találgatnál.`,
};

type ReqOs = {
  reqTitle: string;
  reqRows: [string, string][];
};

const REQ_OS: Record<Lang, ReqOs> = {
  it: {
    reqTitle: "Requisiti (Mac con Apple silicon)",
    reqRows: [
      ["Homebrew", "Già installato — l'app lo usa per installare Podman"],
      [
        "RAM",
        "Mac con almeno 16 GB consigliato · la macchina per i container usa 4 GiB",
      ],
      ["CPU", "2 per la macchina per i container"],
      [
        "Disco",
        "La macchina per i container arriva fino a 30 GiB · nessun minimo misurato",
      ],
    ],
  },
  en: {
    reqTitle: "Requirements (Mac with Apple silicon)",
    reqRows: [
      ["Homebrew", "Already installed — the app uses it to install Podman"],
      [
        "RAM",
        "A Mac with at least 16 GB is recommended · the container machine uses 4 GiB",
      ],
      ["CPU", "2 for the container machine"],
      [
        "Disk",
        "The container machine grows up to 30 GiB · no minimum has been measured",
      ],
    ],
  },
  es: {
    reqTitle: "Requisitos (Mac con Apple silicon)",
    reqRows: [
      ["Homebrew", "Ya instalado — la aplicación lo usa para instalar Podman"],
      [
        "RAM",
        "Se recomienda un Mac con al menos 16 GB · la máquina de contenedores usa 4 GiB",
      ],
      ["CPU", "2 para la máquina de contenedores"],
      [
        "Disco",
        "La máquina de contenedores crece hasta 30 GiB · no se ha medido ningún mínimo",
      ],
    ],
  },
  fr: {
    reqTitle: "Prérequis (Mac Apple silicon)",
    reqRows: [
      [
        "Homebrew",
        "Déjà installé — l'application s'en sert pour installer Podman",
      ],
      [
        "RAM",
        "Un Mac avec au moins 16 Go est recommandé · la machine de conteneurs utilise 4 GiB",
      ],
      ["CPU", "2 pour la machine de conteneurs"],
      [
        "Disque",
        "La machine de conteneurs grandit jusqu'à 30 GiB · aucun minimum n'a été mesuré",
      ],
    ],
  },
  de: {
    reqTitle: "Voraussetzungen (Mac mit Apple Silicon)",
    reqRows: [
      [
        "Homebrew",
        "Bereits installiert — die App nutzt es, um Podman zu installieren",
      ],
      [
        "RAM",
        "Empfohlen: ein Mac mit mindestens 16 GB · die Container-Maschine nutzt 4 GiB",
      ],
      ["CPU", "2 für die Container-Maschine"],
      [
        "Festplatte",
        "Die Container-Maschine wächst bis auf 30 GiB · es wurde kein Minimum gemessen",
      ],
    ],
  },
  pt: {
    reqTitle: "Requisitos (Mac com Apple silicon)",
    reqRows: [
      ["Homebrew", "Já instalado — a aplicação usa-o para instalar o Podman"],
      [
        "RAM",
        "Recomenda-se um Mac com pelo menos 16 GB · a máquina de contentores usa 4 GiB",
      ],
      ["CPU", "2 para a máquina de contentores"],
      [
        "Disco",
        "A máquina de contentores cresce até 30 GiB · não foi medido qualquer mínimo",
      ],
    ],
  },
  hu: {
    reqTitle: "Követelmények (Apple silicon Mac)",
    reqRows: [
      ["Homebrew", "Már telepítve — az alkalmazás ezzel telepíti a Podmant"],
      [
        "RAM",
        "Ajánlott egy legalább 16 GB-os Mac · a konténergép 4 GiB-ot használ",
      ],
      ["CPU", "2 a konténergépnek"],
      ["Lemez", "A konténergép legfeljebb 30 GiB-ig nő · nem mértek minimumot"],
    ],
  },
};

function DownloadContent() {
  const { t, lang } = useLandingI18n();
  const [installMode, setInstallMode] = useState<InstallMode>("terminal");

  const terminalCommand = CLI_SETUP_CMD;
  const ro = REQ_OS[(REQ_OS[lang as Lang] ? lang : "en") as Lang];
  const assistantPrompt =
    ASSISTANT_PROMPT[(ASSISTANT_PROMPT[lang as Lang] ? lang : "en") as Lang];

  return (
    <>
      <LandingNav />
      <main
        style={{ position: "relative", zIndex: 1 }}
        className="min-h-screen flex flex-col items-center px-5 py-12 pt-24"
      >
        <div className="w-full max-w-2xl">
          <div className="mb-12 text-center">
            <h1 className="text-2xl md:text-4xl font-bold tracking-tight text-[var(--color-white)] leading-none mb-3">
              {t("dl_title_1")}{" "}
              <span className="text-[var(--color-green)]">
                {t("dl_title_2")}
              </span>
            </h1>
            <p className="text-[var(--color-muted)] text-[12px] md:text-[13px] leading-relaxed max-w-4xl mx-auto mb-2">
              {t("dl_desc")}
            </p>
            <span className="text-[10px] text-[var(--color-dim)]">
              open source
            </span>
          </div>

          <div className="mb-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {MODES.map((m) => {
                const active = installMode === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setInstallMode(m.id)}
                    aria-pressed={active}
                    data-install-mode={m.id}
                    data-active={active}
                    className="px-4 py-4 text-left transition-colors"
                    style={{
                      background: active ? "var(--color-card)" : "transparent",
                      color: active
                        ? "var(--color-bright)"
                        : "var(--color-muted)",
                      border: `1px solid ${active ? "var(--color-green)" : "var(--color-border)"}`,
                      cursor: "pointer",
                    }}
                  >
                    <div className="text-[12px] font-semibold tracking-wide">
                      {t(m.labelKey)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {installMode === "terminal" && (
            <div className="mb-8">
              <div
                className="border overflow-hidden"
                style={{
                  borderColor: "var(--color-border)",
                  background: "var(--color-card)",
                }}
              >
                <div
                  className="flex items-center justify-end px-3 py-2"
                  style={{ borderBottom: "1px solid var(--color-border)" }}
                >
                  <CopyButton
                    text={terminalCommand}
                    size="sm"
                    className="rounded-none"
                  >
                    {t("dl_copy_cmd")}
                  </CopyButton>
                </div>
                <pre className="px-4 py-4 overflow-x-auto text-[11px] leading-relaxed font-mono text-[var(--color-bright)]">
                  {terminalCommand}
                </pre>
              </div>
              <p className="text-[10px] text-[var(--color-dim)] mt-3 text-center">
                macOS · Linux
              </p>
              <p
                data-windows-cli-preview
                className="text-[11px] text-[var(--color-muted)] leading-relaxed mt-3 text-center"
              >
                {t("dl_windows_cli_preview")}
              </p>

            </div>
          )}

          {installMode === "prompt" && (
            <div className="mb-8">
              <p className="text-[12px] text-[var(--color-muted)] leading-relaxed mb-4">
                {t("dl_prompt_intro")}
              </p>
              <div
                className="border overflow-hidden"
                style={{
                  borderColor: "var(--color-border)",
                  background: "var(--color-card)",
                }}
              >
                <div
                  className="flex items-center justify-end px-3 py-2"
                  style={{ borderBottom: "1px solid var(--color-border)" }}
                >
                  <CopyButton
                    text={assistantPrompt}
                    size="sm"
                    className="rounded-none"
                  >
                    {t("dl_copy_prompt")}
                  </CopyButton>
                </div>
                <pre className="px-4 py-4 overflow-x-auto whitespace-pre-wrap text-[11px] leading-relaxed font-mono text-[var(--color-bright)]">
                  {assistantPrompt}
                </pre>
              </div>
              <p className="text-[10px] text-[var(--color-dim)] mt-3 text-center">
                {t("dl_prompt_note")}
              </p>
            </div>
          )}

          {/* Requisiti minimi (spostati da /run) */}
          <section className="mt-4 mb-8">
            <h2 className="text-lg md:text-xl font-bold text-[var(--color-white)] tracking-tight mb-5">
              {ro.reqTitle}
            </h2>
            <div className="flex flex-col">
              {ro.reqRows.map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-baseline justify-between gap-4 py-2.5 border-b border-[var(--color-border)]"
                >
                  <span className="text-[12px] font-semibold tracking-wide text-[var(--color-white)]">
                    {k}
                  </span>
                  <span className="text-[12px] text-[var(--color-muted)] text-right">
                    {v}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <div className="mt-8 flex justify-center">
            <BackLink />
          </div>
        </div>
      </main>
      <LandingFooter />
      <ScrollToTop />
    </>
  );
}

// The attribution of the visit stays in the page's props for the download route; 0.4.0 has no file to download here.
export default function DownloadClient(_props: { attribution: DownloadAttribution }) {
  return (
    <LandingI18nProvider>
      <DownloadContent />
    </LandingI18nProvider>
  );
}
