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

// 2026-07-29: l'app desktop diventa scaricabile, marcata BETA. Gli asset sono
// quelli della release più recente su GitHub, via `releases/latest/download/`:
// il link non va aggiornato a ogni versione, ci pensa GitHub a risolverlo.
// macOS è firmato Developer ID e notarizzato (dalla 0.3.1), quindi si apre con
// un doppio clic; Windows e Linux non sono firmati e l'avviso di SmartScreen
// va detto prima, non lasciato scoprire. Sostituisce il "in arrivo" del
// 2026-07-03 (docs/internal/2026-07-03-desktop-app-status-and-vision.md).
type InstallMode = "terminal" | "desktop";

const RELEASE_BASE =
  "https://github.com/leopu00/job-hunter-team/releases/latest/download";
const WINDOWS_PORTABLE_ASSET = "job-hunter-team-windows-x64-portable.exe";

const DESKTOP_ASSET: Record<PlatformId, string> = {
  mac: "job-hunter-team.zip",
  windows: "job-hunter-team-windows-x64-setup.exe",
  linux: "job-hunter-team-linux-x64.tar.gz",
};

type DlKey = Parameters<ReturnType<typeof useLandingI18n>["t"]>[0];
const MODES: { id: InstallMode; labelKey: DlKey }[] = [
  { id: "desktop", labelKey: "dl_mode_desktop_title" },
  { id: "terminal", labelKey: "dl_mode_terminal_title" },
];

type PlatformId = "mac" | "windows" | "linux";

const PLATFORMS: { id: PlatformId; label: string }[] = [
  { id: "mac", label: "macOS" },
  { id: "windows", label: "Windows" },
  { id: "linux", label: "Linux" },
];

function PlatformIcon({ id }: { id: PlatformId }) {
  if (id === "mac") return <AppleIcon />;
  if (id === "linux") return <LinuxIcon />;
  if (id === "windows") return <WindowsIcon />;
  return null;
}

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
  const [installMode, setInstallMode] = useState<InstallMode>("desktop");

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
                macOS · Linux · WSL
              </p>
            </div>
          )}

          {installMode === "desktop" && (
            <div className="mb-8">
              <p className="text-[12px] text-[var(--color-muted)] leading-relaxed mb-4">
                {t("dl_desktop_beta_desc")}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {PLATFORMS.map((os) => (
                  <a
                    key={os.id}
                    href={`${RELEASE_BASE}/${DESKTOP_ASSET[os.id]}`}
                    className="border px-4 py-4 flex flex-col items-center gap-3 text-center transition-colors hover:border-[var(--color-green)]"
                    style={{
                      borderColor: "var(--color-border)",
                      background: "var(--color-panel)",
                    }}
                  >
                    <div
                      className="w-10 h-10 flex items-center justify-center"
                      style={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                      }}
                    >
                      <PlatformIcon id={os.id} />
                    </div>
                    <div className="text-[12px] font-bold text-[var(--color-white)]">
                      {os.label}
                    </div>
                    <span className="text-[9px] font-semibold tracking-[0.15em] uppercase text-[var(--color-green)] border border-[var(--color-green)] px-2 py-0.5">
                      {t("dl_desktop_beta_badge")}
                    </span>
                  </a>
                ))}
              </div>
              <p className="text-[11px] text-[var(--color-muted)] leading-relaxed mt-4 text-center">
                {t("dl_windows_portable_label")}{" "}
                <a
                  href={`${RELEASE_BASE}/${WINDOWS_PORTABLE_ASSET}`}
                  className="font-semibold text-[var(--color-green)] underline underline-offset-2"
                >
                  {t("dl_windows_portable_link")}
                </a>
              </p>
              {/* Windows e Linux non sono firmati: l'avviso del sistema va
                  detto prima, così non sembra che il file sia guasto. */}
              <p className="text-[11px] text-[var(--color-muted)] leading-relaxed mt-4">
                {t("dl_desktop_unsigned_note")}
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

/* ── OS Icons (SVG inline) ── */

function AppleIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      style={{ color: "var(--color-muted)" }}
    >
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

function LinuxIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 15 15"
      fill="none"
      aria-hidden="true"
      style={{ color: "var(--color-muted)" }}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4.53918 2.40715C4.82145 1.0075 6.06066 0 7.49996 0C8.93926 0 10.1785 1.0075 10.4607 2.40715L10.798 4.07944C10.9743 4.9539 11.3217 5.78562 11.8205 6.52763L12.4009 7.39103C12.7631 7.92978 12.9999 8.5385 13.0979 9.17323C13.6747 9.22167 14.1803 9.58851 14.398 10.1283L14.8897 11.3474C15.1376 11.962 14.9583 12.665 14.4455 13.0887L12.5614 14.6458C12.0128 15.0992 11.2219 15.1193 10.6506 14.6944L9.89192 14.1301C9.88189 14.1227 9.87197 14.1151 9.86216 14.1074C9.48973 14.2075 9.09793 14.261 8.69355 14.261H6.30637C5.90201 14.261 5.51023 14.2076 5.13782 14.1074C5.12802 14.1151 5.11811 14.1227 5.10808 14.1301L4.34942 14.6944C3.77811 15.1193 2.98725 15.0992 2.43863 14.6458L0.55446 13.0887C0.0417175 12.665 -0.1376 11.962 0.110281 11.3474L0.602025 10.1283C0.819715 9.58854 1.32527 9.2217 1.90198 9.17324C2 8.5385 2.2368 7.92978 2.59897 7.39103L3.17938 6.52763C3.67818 5.78562 4.02557 4.9539 4.20193 4.07944L4.53918 2.40715ZM10.8445 9.47585C10.6345 9.63293 10.4642 9.84382 10.3561 10.0938L9.58799 11.8713C9.20026 12.0979 8.75209 12.2237 8.28465 12.2237H6.7153C6.24789 12.2237 5.79975 12.0979 5.41203 11.8714L4.64386 10.0938C4.53581 9.8438 4.36552 9.6329 4.15546 9.47582C4.18121 9.15355 4.2689 8.83503 4.41853 8.53826L5.67678 6.04259L5.68433 6.05007C6.68715 7.04458 8.31304 7.04458 9.31585 6.05007L9.32324 6.04274L10.5814 8.53825C10.7311 8.83504 10.8187 9.15357 10.8445 9.47585ZM9.04068 4.26906V3.05592H8.01353V3.85713C8.23151 3.90123 8.44506 3.97371 8.64848 4.07458L9.04068 4.26906ZM6.98638 3.85718V3.05592H5.95923V4.26919L6.3517 4.07458C6.55504 3.97375 6.7685 3.90129 6.98638 3.85718ZM2.03255 10.1864C1.82255 10.1864 1.6337 10.3132 1.55571 10.5066L1.06397 11.7257C0.981339 11.9306 1.04111 12.1649 1.21203 12.3062L3.0962 13.8633C3.27907 14.0144 3.54269 14.0211 3.73313 13.8795L4.49179 13.3152C4.6813 13.1743 4.74901 12.923 4.6557 12.7071L3.69976 10.4951C3.61884 10.3078 3.43316 10.1864 3.22771 10.1864H2.03255ZM13.4443 10.5066C13.3663 10.3132 13.1775 10.1864 12.9674 10.1864H11.7723C11.5668 10.1864 11.3812 10.3078 11.3002 10.4951L10.3443 12.7071C10.251 12.923 10.3187 13.1743 10.5082 13.3152L11.2669 13.8795C11.4573 14.0211 11.7209 14.0144 11.9038 13.8633L13.788 12.3062C13.9589 12.1649 14.0187 11.9306 13.936 11.7257L13.4443 10.5066ZM6.81106 4.98568C7.24481 4.7706 7.75537 4.7706 8.18912 4.98568L8.68739 5.23275L8.58955 5.32978C7.98786 5.92649 7.01232 5.92649 6.41063 5.32978L6.31279 5.23275L6.81106 4.98568Z"
        fill="currentColor"
      />
    </svg>
  );
}

function WindowsIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      style={{ color: "var(--color-muted)" }}
    >
      <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
    </svg>
  );
}
