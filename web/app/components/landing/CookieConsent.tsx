"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useLandingI18n } from "./LandingI18n";
import { isLocalDeploy } from "@/lib/deploy-mode";
import { CONSENT_EVENT, CONSENT_STORAGE_KEY } from "../ConsentedAnalytics";

// La chiave è quella di `ConsentedAnalytics`, importata e non
// ricopiata: due costanti uguali scritte in due file si slegano al primo
// rename, e il consenso smetterebbe di essere letto senza che nulla si
// rompa in modo visibile.
const STORAGE_KEY = CONSENT_STORAGE_KEY;

const T = {
  it: {
    text: "Questo sito utilizza cookie tecnici per il funzionamento e cookie analitici per migliorare la tua esperienza.",
    accept: "Accetta",
    decline: "Solo necessari",
    privacy: "Privacy Policy",
  },
  en: {
    text: "This site uses technical cookies for functionality and analytics cookies to improve your experience.",
    accept: "Accept",
    decline: "Necessary only",
    privacy: "Privacy Policy",
  },
  hu: {
    text: "Ez az oldal technikai cookie-kat használ a működéshez és analitikai cookie-kat a felhasználói élmény javításához.",
    accept: "Elfogadás",
    decline: "Csak szükséges",
    privacy: "Adatvédelmi Irányelvek",
  },
  es: {
    text: "Este sitio utiliza cookies técnicas para el funcionamiento y cookies analíticas para mejorar tu experiencia.",
    accept: "Aceptar",
    decline: "Solo necesarias",
    privacy: "Política de Privacidad",
  },
  de: {
    text: "Diese Website verwendet technische Cookies für die Funktionalität und Analyse-Cookies, um deine Erfahrung zu verbessern.",
    accept: "Akzeptieren",
    decline: "Nur notwendige",
    privacy: "Datenschutzerklärung",
  },
  fr: {
    text: "Ce site utilise des cookies techniques pour le fonctionnement et des cookies analytiques pour améliorer votre expérience.",
    accept: "Accepter",
    decline: "Nécessaires uniquement",
    privacy: "Politique de Confidentialité",
  },
  pt: {
    text: "Este site utiliza cookies técnicos para o funcionamento e cookies analíticos para melhorar a sua experiência.",
    accept: "Aceitar",
    decline: "Apenas necessários",
    privacy: "Política de Privacidade",
  },
};

export default function CookieConsent() {
  const { lang, t: tr } = useLandingI18n();
  const t = T[lang as keyof typeof T] || T.en;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // [JHT-DASHBOARD-SPLIT] Sul container LOCAL (dashboard embedded nell'app
    // desktop) il banner cookie non ha senso: nessun analytics/tracking web,
    // ed è uno degli "orpelli web" che danno la sensazione pagina-in-pagina.
    // Su cloud (browser) resta.
    if (isLocalDeploy()) return;
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      /* SSR / privacy mode */
    }
  }, []);

  const respond = (choice: "accepted" | "necessary") => {
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      /* ignore */
    }
    // Avvisa `ConsentedAnalytics` nello stesso istante: senza l'evento, un
    // «Accetta» varrebbe solo dal caricamento successivo, e chi accetta si
    // aspetta che valga subito. Nell'altro verso conta ancora di più: chi
    // sceglie «Solo necessari» non deve essere misurato per il resto della
    // visita.
    try {
      window.dispatchEvent(new Event(CONSENT_EVENT));
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 left-4 right-4 z-[9980] flex justify-end"
      style={{
        animation: "fade-in 0.3s ease both",
        animationDelay: "1s",
        animationFillMode: "both",
      }}
    >
      <div
        role="dialog"
        aria-label={tr("cookie_consent")}
        className="pointer-events-auto w-full max-w-sm px-5 py-4 flex flex-col gap-3"
        style={{
          background: "var(--color-panel)",
          border: "1px solid var(--color-border)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div className="flex-1 min-w-0">
          <p
            className="text-[11px] leading-relaxed"
            style={{ color: "var(--color-muted)" }}
          >
            {t.text}{" "}
            <Link
              href="/privacy"
              className="no-underline transition-colors hover:opacity-80"
              style={{ color: "var(--color-green)" }}
            >
              {t.privacy}
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => respond("necessary")}
            className="px-3 py-1.5 rounded text-[10px] font-semibold tracking-wide transition-all hover:opacity-80"
            style={{
              background: "transparent",
              color: "var(--color-dim)",
              border: "1px solid var(--color-border)",
              cursor: "pointer",
            }}
          >
            {t.decline}
          </button>
          <button
            onClick={() => respond("accepted")}
            className="px-3 py-1.5 rounded text-[10px] font-semibold tracking-wide transition-all hover:opacity-90"
            style={{
              background: "var(--color-green)",
              color: "#000",
              border: "1px solid var(--color-green)",
              cursor: "pointer",
            }}
          >
            {t.accept}
          </button>
        </div>
      </div>
    </div>
  );
}
