"use client";

import { useState } from "react";
import Link from "next/link";
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

// 2026-07-03: l'app desktop non è più offerta in download dal web (non ancora
// promossa, non testata su ambiente vergine — vedi
// docs/internal/2026-07-03-desktop-app-status-and-vision.md). Restano i due
// percorsi maturi: installazione da terminale (CLI) e prompt per l'assistente AI.
type InstallMode = "terminal" | "prompt";

type DlKey = Parameters<ReturnType<typeof useLandingI18n>["t"]>[0];
const MODES: { id: InstallMode; labelKey: DlKey }[] = [
  { id: "terminal", labelKey: "dl_mode_terminal_title" },
  { id: "prompt", labelKey: "dl_mode_prompt_title" },
];

// Prompt che l'utente incolla nel proprio assistente AI (con accesso al
// computer): è uno spunto conversazionale, NON una procedura. L'agente esplora
// repo e sito, capisce che l'utente vuole partire, sceglie con lui l'approccio
// (dashboard desktop oppure solo CLI) e svolge i passaggi tecnici al posto suo.
const ASSISTANT_PROMPT = `I'd like to start using Job Hunter Team, an AI agent team that searches for jobs for me.
Repo: https://github.com/leopu00/job-hunter-team
Website: https://jobhunterteam.ai

Take a look at the repo and its documentation, then help me set it up and get it running on this computer. Figure out the best approach with me and ask whatever you need along the way — including which AI provider subscription I'll use, and whether I'd prefer the desktop dashboard or a CLI-only setup (both are supported and compatible, so pick whatever suits me; I don't have to open the desktop app if I don't want to). Please handle the technical steps for me.`;

const CLI_SETUP_CMD = `curl -fsSL https://jobhunterteam.ai/install.sh | bash`;

type ReqOs = {
  reqTitle: string;
  reqRows: [string, string][];
};

const REQ_OS: Record<Lang, ReqOs> = {
  it: {
    reqTitle: "Requisiti minimi",
    reqRows: [
      ["Docker", "Obbligatorio — l'unica vera dipendenza"],
      ["RAM", "4 GB minimo · 8 GB consigliati"],
      ["CPU", "2 core minimo · 4 consigliati"],
      ["Disco", "~35 GB liberi"],
    ],
  },
  en: {
    reqTitle: "Minimum requirements",
    reqRows: [
      ["Docker", "Required — the only real dependency"],
      ["RAM", "4 GB minimum · 8 GB recommended"],
      ["CPU", "2 cores minimum · 4 recommended"],
      ["Disk", "~35 GB free"],
    ],
  },
  es: {
    reqTitle: "Requisitos mínimos",
    reqRows: [
      ["Docker", "Obligatorio — la única dependencia real"],
      ["RAM", "4 GB mínimo · 8 GB recomendado"],
      ["CPU", "2 núcleos mínimo · 4 recomendado"],
      ["Disco", "~35 GB libres"],
    ],
  },
  fr: {
    reqTitle: "Configuration minimale",
    reqRows: [
      ["Docker", "Obligatoire — la seule vraie dépendance"],
      ["RAM", "4 Go minimum · 8 Go recommandés"],
      ["CPU", "2 cœurs minimum · 4 recommandés"],
      ["Disque", "~35 Go libres"],
    ],
  },
  de: {
    reqTitle: "Mindestanforderungen",
    reqRows: [
      ["Docker", "Erforderlich — die einzige echte Abhängigkeit"],
      ["RAM", "4 GB minimum · 8 GB empfohlen"],
      ["CPU", "2 Kerne minimum · 4 empfohlen"],
      ["Festplatte", "~35 GB frei"],
    ],
  },
  pt: {
    reqTitle: "Requisitos mínimos",
    reqRows: [
      ["Docker", "Obrigatório — a única dependência real"],
      ["RAM", "4 GB mínimo · 8 GB recomendado"],
      ["CPU", "2 núcleos mínimo · 4 recomendado"],
      ["Disco", "~35 GB livres"],
    ],
  },
  hu: {
    reqTitle: "Minimális követelmények",
    reqRows: [
      ["Docker", "Kötelező — az egyetlen valódi függőség"],
      ["RAM", "4 GB minimum · 8 GB ajánlott"],
      ["CPU", "2 mag minimum · 4 ajánlott"],
      ["Lemez", "~35 GB szabad hely"],
    ],
  },
};

function DownloadContent() {
  const { t, lang } = useLandingI18n();
  const [installMode, setInstallMode] = useState<InstallMode>("terminal");

  const terminalCommand = CLI_SETUP_CMD;
  const ro = REQ_OS[(REQ_OS[lang as Lang] ? lang : "en") as Lang];

  return (
    <>
      <LandingNav />
      <main
        style={{ position: "relative", zIndex: 1 }}
        className="min-h-screen flex flex-col items-center px-5 py-12 pt-24"
      >
        <div
          className="w-full max-w-2xl"
          style={{ animation: "fade-in 0.5s ease both" }}
        >
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
            <div className="grid grid-cols-2 gap-3">
              {MODES.map((m) => {
                const active = installMode === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setInstallMode(m.id)}
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
                macOS · Linux · WSL
              </p>
            </div>
          )}

          {installMode === "prompt" && (
            <div className="mb-8">
              <p className="text-[12px] text-[var(--color-muted)] leading-relaxed mb-3">
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
                    text={ASSISTANT_PROMPT}
                    size="sm"
                    className="rounded-none"
                  >
                    {t("dl_copy_prompt")}
                  </CopyButton>
                </div>
                <pre className="px-4 py-4 overflow-x-auto whitespace-pre-wrap text-[11px] leading-relaxed font-mono text-[var(--color-bright)]">
                  {ASSISTANT_PROMPT}
                </pre>
              </div>
              <p className="text-[10px] text-[var(--color-dim)] mt-3 text-center leading-relaxed">
                ⚠️ {t("dl_prompt_note")}
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

          {/* Aiuto: dove/come installarlo → guida /run */}
          <div className="mt-2 border border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-3 text-center">
            <span className="text-[12px] text-[var(--color-muted)]">
              {t("dl_help_text")}{" "}
            </span>
            <Link
              href="/run"
              className="text-[12px] font-semibold text-[var(--color-green)] no-underline"
            >
              {t("dl_help_link")} →
            </Link>
          </div>

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

export default function DownloadClient() {
  return (
    <LandingI18nProvider>
      <DownloadContent />
    </LandingI18nProvider>
  );
}
