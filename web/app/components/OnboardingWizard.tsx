"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { readLocaleCookie } from "@/lib/use-locale";
import { useFocusTrap } from "./AccessibilityProvider";

/* ── i18n inline ──────────────────────────────────────────────────── */

type Lang = "it" | "en" | "es" | "de" | "fr" | "pt" | "hu";

const SUPPORTED_LANGS: Lang[] = ["it", "en", "es", "de", "fr", "pt", "hu"];

// Fonte unica: cookie NEXT_LOCALE (vedi lib/use-locale). Copre tutte e 7 le
// lingue (it/en/es/de/fr/pt/hu); qualsiasi locale sconosciuta ricade su en.
function getLang(): Lang {
  const l = readLocaleCookie();
  return (SUPPORTED_LANGS as string[]).includes(l) ? (l as Lang) : "en";
}

// Gate locale "primo accesso": una volta chiuso il tour su questo browser
// non riappare piu', anche se la persistenza DB fallisce (migration 016
// non applicata, service role key assente, o FS ephemeral su Vercel).
// localStorage e' sincrono e per-browser: e' la fonte di verita' immediata.
// Il DB (/api/preferences) resta come sync cross-device best-effort.
const TOUR_DONE_KEY = "jht-tour-done";

function localTourDone(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(TOUR_DONE_KEY) === "1";
  } catch {
    return false;
  }
}

function markLocalTourDone(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TOUR_DONE_KEY, "1");
  } catch {
    /* storage non disponibile (private mode / quota) — ignora */
  }
}

const T = {
  skip: {
    it: "Salta",
    en: "Skip",
    es: "Saltar",
    de: "Überspringen",
    fr: "Passer",
    pt: "Pular",
    hu: "Kihagyás",
  },
  next: {
    it: "Avanti",
    en: "Next",
    es: "Siguiente",
    de: "Weiter",
    fr: "Suivant",
    pt: "Avançar",
    hu: "Tovább",
  },
  back: {
    it: "Indietro",
    en: "Back",
    es: "Atrás",
    de: "Zurück",
    fr: "Retour",
    pt: "Voltar",
    hu: "Vissza",
  },
  finish: {
    it: "Ho capito",
    en: "Got it",
    es: "Entendido",
    de: "Verstanden",
    fr: "Compris",
    pt: "Entendi",
    hu: "Értem",
  },
} as const;

type LangText = Record<Lang, string>;

type StepDef = {
  selector: string | null;
  title: LangText;
  body: LangText;
};

const STEPS: StepDef[] = [
  {
    selector: null,
    title: {
      it: "Benvenuto nella dashboard",
      en: "Welcome to the dashboard",
      es: "Bienvenido al panel",
      de: "Willkommen im Dashboard",
      fr: "Bienvenue dans le tableau de bord",
      pt: "Bem-vindo ao painel",
      hu: "Üdvözlünk az irányítópulton",
    },
    body: {
      it: "Il profilo è pronto. Da qui in poi pilotano gli agenti AI: facciamo un giro veloce delle pagine principali.",
      en: "Your profile is ready. From here the AI agents take over — let's do a quick tour of the main pages.",
      es: "Tu perfil está listo. A partir de aquí toman el control los agentes de IA: hagamos un recorrido rápido por las páginas principales.",
      de: "Dein Profil ist fertig. Ab hier übernehmen die KI-Agenten — machen wir eine kurze Tour durch die wichtigsten Seiten.",
      fr: "Votre profil est prêt. À partir d'ici, les agents IA prennent le relais — faisons un tour rapide des pages principales.",
      pt: "O seu perfil está pronto. A partir daqui os agentes de IA assumem o controlo — vamos fazer um tour rápido pelas páginas principais.",
      hu: "A profilod készen áll. Innentől az MI-ügynökök veszik át az irányítást — nézzük meg gyorsan a fő oldalakat.",
    },
  },
  {
    selector: '[data-tour="positions"]',
    title: {
      it: "Positions",
      en: "Positions",
      es: "Positions",
      de: "Positions",
      fr: "Positions",
      pt: "Positions",
      hu: "Positions",
    },
    body: {
      it: "Tutte le offerte trovate dagli agenti. Le puoi filtrare, scartare o passare allo stato successivo.",
      en: "Every listing the agents found. Filter, dismiss, or move them to the next stage.",
      es: "Todas las ofertas que han encontrado los agentes. Puedes filtrarlas, descartarlas o pasarlas a la siguiente fase.",
      de: "Alle Stellen, die die Agenten gefunden haben. Filtere, verwerfe oder verschiebe sie in die nächste Phase.",
      fr: "Toutes les offres trouvées par les agents. Filtrez-les, écartez-les ou faites-les passer à l'étape suivante.",
      pt: "Todas as ofertas encontradas pelos agentes. Pode filtrá-las, descartá-las ou passá-las à fase seguinte.",
      hu: "Az ügynökök által talált összes állás. Szűrheted, elvetheted vagy a következő szakaszba léptetheted őket.",
    },
  },
  {
    selector: '[data-tour="team"]',
    title: {
      it: "Team",
      en: "Team",
      es: "Team",
      de: "Team",
      fr: "Team",
      pt: "Team",
      hu: "Team",
    },
    body: {
      it: "Qui avvii, fermi e controlli gli agenti: Scout, Analista, Scorer, Scrittore. Il resto è automatico.",
      en: "Start, stop, and monitor the agents here: Scout, Analyst, Scorer, Writer. The rest is automatic.",
      es: "Aquí inicias, detienes y supervisas a los agentes: Scout, Analista, Scorer, Redactor. El resto es automático.",
      de: "Hier startest, stoppst und überwachst du die Agenten: Scout, Analyst, Scorer, Writer. Der Rest läuft automatisch.",
      fr: "Ici, vous démarrez, arrêtez et surveillez les agents : Scout, Analyste, Scorer, Rédacteur. Le reste est automatique.",
      pt: "Aqui inicia, para e monitoriza os agentes: Scout, Analista, Scorer, Redator. O resto é automático.",
      hu: "Itt indíthatod, állíthatod le és felügyelheted az ügynököket: Scout, Elemző, Scorer, Író. A többi automatikus.",
    },
  },
];

/* ── Component ────────────────────────────────────────────────────── */

type Rect = { top: number; left: number; width: number; height: number };

export default function OnboardingWizard() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [lang, setLang] = useState<Lang>("it");
  const [rect, setRect] = useState<Rect | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Il tour si dichiara aria-modal: il Tab deve restare fra Indietro e
  // Avanti, non scorrere la pagina oscurata sotto lo spotlight.
  useFocusTrap(dialogRef, visible);

  const t = useCallback((k: keyof typeof T) => T[k][lang], [lang]);

  useEffect(() => {
    setLang(getLang());
    // Gate locale: se gia' chiuso su questo browser, non mostrare nulla
    // (ne' fare il fetch). Questo e' il fix definitivo al "riappare a ogni
    // accesso" quando la persistenza DB non e' attiva.
    if (localTourDone()) return;
    let cancelled = false;
    fetch("/api/preferences")
      .then((r) => (r.ok ? r.json() : null))
      .then((prefs) => {
        if (cancelled) return;
        if (prefs?.ui_state?.tour_done) {
          // Gia' completato lato server (altro device): allinea il gate
          // locale cosi' i prossimi mount sono istantanei e offline-safe.
          markLocalTourDone();
          return;
        }
        setVisible(true);
      })
      .catch(() => {
        /* API down → don't pester user with the tour */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    // Persisti subito il gate locale: garantisce "solo primo accesso" su
    // questo browser anche se il PATCH DB sotto fallisce.
    markLocalTourDone();
    fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ui_state: { tour_done: true } }),
    }).catch(() => {});
  }, []);

  // Measure current step target
  useEffect(() => {
    if (!visible) return;
    const s = STEPS[step];
    if (!s.selector) {
      setRect(null);
      return;
    }

    const measure = () => {
      const el = document.querySelector(s.selector!) as HTMLElement | null;
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      // Chromium 128+ scala il BCR con il CSS zoom del body: senza compensazione
      // lo spotlight (anch'esso figlio body zoomato) viene ri-scalato → zoom².
      // `currentCSSZoom` è la property standard che restituisce il fattore
      // compound ereditato; dividendo otteniamo coordinate pre-zoom che il
      // body ri-scala esattamente una volta, e l'allineamento è corretto a
      // qualsiasi valore di --zoom. Fallback 1 per browser che non la supportano.
      const z =
        (el as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom ?? 1;
      setRect({
        top: r.top / z,
        left: r.left / z,
        width: r.width / z,
        height: r.height / z,
      });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [visible, step]);

  // Keyboard
  useEffect(() => {
    if (!visible) return;
    const h = (e: KeyboardEvent) => {
      // Con il focus dentro il tooltip, Invio su un bottone fa gia' scattare
      // il suo onClick: senza questa guardia l'handler globale avanzerebbe
      // di un secondo passo sullo stesso tasto.
      if (
        e.key === "Enter" &&
        (e.target as HTMLElement | null)?.closest?.("button")
      )
        return;
      if (e.key === "Escape") dismiss();
      else if (e.key === "ArrowRight" || e.key === "Enter") next();
      else if (e.key === "ArrowLeft") back();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  });

  const next = () => {
    if (step < STEPS.length - 1) setStep((s) => s + 1);
    else dismiss();
  };
  const back = () => {
    if (step > 0) setStep((s) => s - 1);
  };

  if (!visible) return null;
  if (typeof document === "undefined") return null;

  const s = STEPS[step];
  const title = s.title[lang];
  const body = s.body[lang];

  // Tooltip position: centered if no target, else below (or above if no room) the target
  const PAD = 8;
  const TIP_W = 320;
  const tipStyle: React.CSSProperties = (() => {
    if (!rect) {
      return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
    }
    const below = rect.top + rect.height + PAD;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const roomBelow = vh - below;
    const top = roomBelow > 180 ? below : Math.max(PAD, rect.top - 180 - PAD);
    const centerX = rect.left + rect.width / 2;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    const left = Math.min(Math.max(PAD, centerX - TIP_W / 2), vw - TIP_W - PAD);
    return { top, left };
  })();

  return createPortal(
    <div
      aria-hidden={false}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        pointerEvents: "auto",
      }}
    >
      {/* Backdrop with spotlight (or full dim if no target) */}
      {rect ? (
        <div
          style={{
            position: "fixed",
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            borderRadius: 8,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.72)",
            border: "1px solid var(--color-green)",
            pointerEvents: "none",
            transition:
              "top 0.25s ease, left 0.25s ease, width 0.25s ease, height 0.25s ease",
          }}
        />
      ) : (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.72)",
            backdropFilter: "blur(2px)",
          }}
        />
      )}

      {/* Click-catcher so clicks outside tooltip don't hit the page */}
      <div
        onClick={dismiss}
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: rect ? "none" : "auto",
        }}
      />

      {/* Tooltip */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          position: "fixed",
          width: TIP_W,
          padding: "16px 18px",
          borderRadius: 12,
          background: "var(--color-card, #0d0d11)",
          border: "1px solid var(--color-green)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
          color: "var(--color-bright)",
          fontFamily: "inherit",
          ...tipStyle,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--color-green)",
            }}
          >
            {step + 1} / {STEPS.length}
          </span>
          <button
            onClick={dismiss}
            style={{
              fontSize: 10,
              color: "var(--color-dim)",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {t("skip")}
          </button>
        </div>

        <h2
          style={{
            fontSize: 14,
            fontWeight: 700,
            margin: "0 0 6px",
            color: "var(--color-white)",
          }}
        >
          {title}
        </h2>
        <p
          style={{
            fontSize: 11,
            lineHeight: 1.55,
            margin: "0 0 14px",
            color: "var(--color-muted)",
          }}
        >
          {body}
        </p>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
          }}
        >
          <button
            onClick={back}
            disabled={step === 0}
            style={{
              fontSize: 10,
              padding: "6px 12px",
              borderRadius: 6,
              background: "transparent",
              border: "1px solid var(--color-border)",
              color: step === 0 ? "var(--color-dim)" : "var(--color-muted)",
              cursor: step === 0 ? "not-allowed" : "pointer",
              fontFamily: "inherit",
            }}
          >
            {t("back")}
          </button>
          <button
            onClick={next}
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "6px 14px",
              borderRadius: 6,
              background: "var(--color-green)",
              border: "none",
              color: "#000",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {step === STEPS.length - 1 ? t("finish") : t("next")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
