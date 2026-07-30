"use client";

// [JHT-WEB-DEMO] Wizard di benvenuto per l'utente cloud senza dati (22/07).
// Quattro step: (0) lingua della piattaforma, (1) a che punto sei col
// setup, (2) la via d'uscita giusta —
// scaricare l'app, avviare il team, o collegarlo col pairing token —,
// (3) la demo interattiva della dashboard per categoria di lavoro.
// La scelta demo scrive il cookie via POST /api/demo e ricarica su
// /dashboard; "salta" marca il wizard come visto (cookie client-side,
// letto dal redirect in dashboard/page.tsx).

import { useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";
import type { DemoPersonaKey } from "@/lib/demo/data";
import { DEMO_PERSONA_KEYS } from "@/lib/demo/data";
import {
  PERSONA_ICONS,
  PERSONA_LABELS,
  activateDemo,
} from "@/app/components/demo/personas";
import { T } from "./WelcomeClient.i18n";
import type { Strings } from "./WelcomeClient.i18n";

type StatusChoice = "browsing" | "none" | "downloaded" | "running";

// Lingue nel loro endonimo: leggibili da chiunque a prescindere dalla
// lingua corrente del wizard.
const LANGS: { code: Locale; name: string }[] = [
  { code: "it", name: "Italiano" },
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "hu", name: "Magyar" },
  { code: "pt", name: "Português" },
];

// "browsing" per primo: la maggior parte di chi atterra qui non ha (né
// magari vuole) l'app — il tour demo dev'essere la porta più a portata di
// mano, non nascosta dietro domande sul setup (feedback utente 22/07).
const STATUS_OPTIONS: Array<{
  key: StatusChoice;
  label: (t: Strings) => string;
  desc: (t: Strings) => string;
}> = [
  {
    key: "browsing",
    label: (t) => t.opt_browsing,
    desc: (t) => t.opt_browsing_d,
  },
  { key: "none", label: (t) => t.opt_none, desc: (t) => t.opt_none_d },
  {
    key: "downloaded",
    label: (t) => t.opt_downloaded,
    desc: (t) => t.opt_downloaded_d,
  },
  { key: "running", label: (t) => t.opt_running, desc: (t) => t.opt_running_d },
];

function markWelcomeSeen() {
  document.cookie =
    "jht_welcome_seen=1; path=/; max-age=31536000; samesite=lax";
}

export default function WelcomeClient({
  hasSynced,
  activePersona,
}: {
  hasSynced: boolean;
  activePersona: DemoPersonaKey | null;
}) {
  const cookieLocale = useLocale();
  // La scelta lingua è il PRIMO step (feedback utente 23/07: senza, le
  // traduzioni della demo restano invisibili): il cookie NEXT_LOCALE viene
  // scritto subito, l'override locale evita di dover ricaricare la pagina.
  const [localeChosen, setLocaleChosen] = useState<Locale | null>(null);
  const locale = localeChosen ?? cookieLocale;
  const t = T[locale];
  const labels = PERSONA_LABELS[locale];
  const [step, setStep] = useState<"lang" | "status" | "path" | "demo">("lang");
  const [choice, setChoice] = useState<StatusChoice>("none");
  const [busy, setBusy] = useState<DemoPersonaKey | null>(null);

  const pickLang = (l: Locale) => {
    document.cookie = `NEXT_LOCALE=${l};path=/;max-age=31536000;SameSite=Lax`;
    try {
      localStorage.setItem("jht-lang", l);
    } catch {
      /* localStorage non disponibile */
    }
    setLocaleChosen(l);
    setStep("status");
  };

  const startDemo = async (persona: DemoPersonaKey) => {
    if (busy) return;
    setBusy(persona);
    const ok = await activateDemo(persona);
    if (!ok) setBusy(null);
  };

  const skip = () => {
    markWelcomeSeen();
    window.location.href = "/dashboard";
  };

  // Team già collegato: il wizard non serve, solo conferma + uscita.
  if (hasSynced) {
    return (
      <Shell>
        <h1 className="text-xl font-bold uppercase tracking-[0.18em] mb-3 text-[var(--color-white)]">
          {t.synced_title}
        </h1>
        <p className="text-[12px] text-[var(--color-muted)] leading-relaxed mb-6">
          {t.synced_body}
        </p>
        <Link href="/dashboard" className={btnPrimary}>
          {t.synced_cta}
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* Header comune */}
      <h1 className="text-xl font-bold uppercase tracking-[0.18em] mb-2 text-[var(--color-white)]">
        {t.title}
      </h1>
      <p className="text-[12px] text-[var(--color-muted)] leading-relaxed mb-6">
        {t.subtitle}
      </p>

      {/* Progress dots */}
      <div className="flex items-center gap-1.5 mb-6" aria-hidden>
        {(["lang", "status", "path", "demo"] as const).map((s) => (
          <span
            key={s}
            className="h-1 rounded-full transition-all"
            style={{
              width: step === s ? 22 : 10,
              background:
                step === s ? "var(--color-green)" : "var(--color-border)",
            }}
          />
        ))}
      </div>

      {step === "lang" && (
        <>
          <div className="section-label mb-4">{t.q_lang}</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {LANGS.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => pickLang(l.code)}
                className="group text-left p-3.5 rounded-lg border bg-[var(--color-panel)] hover:border-[#00e87a55] transition-colors cursor-pointer"
                style={{
                  borderColor:
                    locale === l.code
                      ? "color-mix(in srgb, var(--color-green) 55%, transparent)"
                      : "var(--color-border)",
                }}
              >
                <span className="text-[12px] font-bold text-[var(--color-bright)] group-hover:text-[var(--color-green)] transition-colors">
                  {l.name}
                </span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={skip}
            className="mt-6 text-[11px] text-[var(--color-dim)] hover:text-[var(--color-muted)] transition-colors cursor-pointer"
          >
            {t.skip}
          </button>
        </>
      )}

      {step === "status" && (
        <>
          <div className="section-label mb-4">{t.q_status}</div>
          <div className="flex flex-col gap-3">
            {STATUS_OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => {
                  setChoice(o.key);
                  // Chi sta solo curiosando non ha un percorso di setup:
                  // dritto alla scelta della categoria demo.
                  setStep(o.key === "browsing" ? "demo" : "path");
                }}
                className="group text-left p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] hover:border-[#00e87a55] transition-colors cursor-pointer"
              >
                <div className="text-[12px] font-bold text-[var(--color-bright)] group-hover:text-[var(--color-green)] transition-colors mb-1">
                  {o.label(t)}
                </div>
                <div className="text-[11px] text-[var(--color-muted)]">
                  {o.desc(t)}
                </div>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={skip}
            className="mt-6 text-[11px] text-[var(--color-dim)] hover:text-[var(--color-muted)] transition-colors cursor-pointer"
          >
            {t.skip}
          </button>
        </>
      )}

      {step === "path" && (
        <>
          {choice === "none" && (
            <Card title={t.dl_title}>
              <p className="text-[11px] text-[var(--color-muted)] leading-relaxed mb-4">
                {t.dl_body}
              </p>
              <div className="section-label mb-2">{t.dl_modes}</div>
              <ul className="flex flex-col gap-1.5 mb-5 list-none p-0 m-0">
                {[t.dl_mode1, t.dl_mode2, t.dl_mode3].map((m, i) => (
                  <li
                    key={i}
                    className="text-[11px] text-[var(--color-muted)] flex gap-2"
                  >
                    <span
                      className="mt-[5px] w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: "var(--color-green)" }}
                    />
                    {m}
                  </li>
                ))}
              </ul>
              <Link href="/download" className={btnPrimary}>
                {t.dl_cta}
              </Link>
              <p className="text-[10px] text-[var(--color-dim)] leading-relaxed mt-4 mb-0">
                {t.dl_note}
              </p>
            </Card>
          )}

          {choice === "downloaded" && (
            <Card title={t.start_title}>
              <p className="text-[11px] text-[var(--color-muted)] leading-relaxed mb-4">
                {t.start_body}
              </p>
              <PairingSteps t={t} />
            </Card>
          )}

          {choice === "running" && (
            <Card title={t.pair_title}>
              <p className="text-[11px] text-[var(--color-muted)] leading-relaxed mb-4">
                {t.pair_body}
              </p>
              <PairingSteps t={t} />
            </Card>
          )}

          <div className="flex items-center gap-3 mt-6">
            <button
              type="button"
              onClick={() => setStep("status")}
              className={btnGhost}
            >
              {t.back}
            </button>
            <button
              type="button"
              onClick={() => setStep("demo")}
              className={btnPrimaryBtn}
            >
              {t.continue_demo}
            </button>
          </div>
        </>
      )}

      {step === "demo" && (
        <>
          <div className="section-label mb-2">{t.demo_q}</div>
          <p className="text-[11px] text-[var(--color-muted)] leading-relaxed mb-4">
            {t.demo_hint}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            {DEMO_PERSONA_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => startDemo(k)}
                disabled={busy != null}
                className="group flex items-center gap-3 p-4 rounded-lg border bg-[var(--color-panel)] transition-colors cursor-pointer disabled:opacity-60 text-left"
                style={{
                  borderColor:
                    activePersona === k
                      ? "color-mix(in srgb, var(--color-green) 55%, transparent)"
                      : "var(--color-border)",
                }}
              >
                <span
                  className="flex items-center justify-center w-9 h-9 rounded-lg border shrink-0 transition-colors"
                  style={{
                    color: "var(--color-green)",
                    borderColor:
                      "color-mix(in srgb, var(--color-green) 35%, transparent)",
                  }}
                >
                  {PERSONA_ICONS[k]}
                </span>
                <span className="text-[12px] font-bold text-[var(--color-bright)] group-hover:text-[var(--color-green)] transition-colors">
                  {labels[k]}
                </span>
                {busy === k && (
                  <span className="ml-auto w-3.5 h-3.5 rounded-full border-2 border-[var(--color-green)] border-t-transparent animate-spin shrink-0" />
                )}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-[var(--color-dim)] leading-relaxed mb-6">
            {t.demo_note}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              // "browsing" ha saltato lo step percorso: indietro = domanda
              // iniziale, non una pagina di setup mai vista.
              onClick={() => setStep(choice === "browsing" ? "status" : "path")}
              className={btnGhost}
            >
              {t.back}
            </button>
            <button
              type="button"
              onClick={skip}
              className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-muted)] transition-colors cursor-pointer"
            >
              {t.skip}
            </button>
          </div>
        </>
      )}
    </Shell>
  );
}

// Passi di pairing riusati dai percorsi "scaricata" e "già attivo".
function PairingSteps({ t }: { t: Strings }) {
  const steps = [t.pair_s1, t.pair_s2, t.pair_s3];
  return (
    <div className="flex flex-col gap-3">
      {steps.map((s, i) => (
        <div key={i} className="flex items-start gap-3">
          <span
            className="flex items-center justify-center w-6 h-6 rounded-full border text-[11px] font-bold shrink-0"
            style={{
              color: "var(--color-green)",
              borderColor: "var(--color-green)",
            }}
          >
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-[var(--color-muted)] leading-relaxed m-0">
              {s}
            </p>
            {i === 0 && (
              <Link
                href="/settings/cloud-sync"
                className="inline-block mt-2 text-[10px] font-semibold tracking-[0.08em] uppercase no-underline px-2.5 py-1 rounded border transition-colors"
                style={{
                  color: "var(--color-green)",
                  borderColor:
                    "color-mix(in srgb, var(--color-green) 45%, transparent)",
                }}
              >
                {t.pair_s1_cta}
              </Link>
            )}
            {i === 1 && (
              <code className="block mt-2 text-[10px] px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-deep)] text-[var(--color-bright)] overflow-x-auto whitespace-nowrap">
                jht cloud enable --token &lt;TOKEN&gt;
              </code>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ animation: "fade-in 0.35s ease both" }}>
      <div className="max-w-2xl mx-auto px-5 pt-10 pb-16">{children}</div>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]">
      <div className="text-[13px] font-bold text-[var(--color-bright)] mb-3">
        {title}
      </div>
      {children}
    </div>
  );
}

const btnPrimary =
  "inline-block text-[11px] font-semibold tracking-[0.08em] uppercase no-underline px-4 py-2 rounded border transition-colors text-[var(--color-green)] border-[var(--color-green)] hover:bg-[var(--color-green)]/10";
const btnPrimaryBtn =
  "text-[11px] font-semibold tracking-[0.08em] uppercase px-4 py-2 rounded border transition-colors text-[var(--color-green)] border-[var(--color-green)] hover:bg-[var(--color-green)]/10 cursor-pointer";
const btnGhost =
  "text-[11px] font-semibold tracking-[0.08em] uppercase px-4 py-2 rounded border border-[var(--color-border)] text-[var(--color-dim)] hover:text-[var(--color-bright)] hover:border-[var(--color-border-glow)] transition-colors cursor-pointer";
