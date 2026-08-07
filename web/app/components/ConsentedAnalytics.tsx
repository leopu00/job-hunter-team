"use client";

// Analytics e Speed Insights, montati SOLO dopo un consenso esplicito.
//
// Prima erano nel layout radice senza condizioni: partivano al primo
// render, cioè prima ancora che l'utente vedesse il banner. Il banner però
// offre «Solo necessari», e quella scelta non aveva alcun effetto — la
// pagina prometteva una scelta che non rispettava. Questo componente lega
// le due cose.
//
// La scelta vive in `localStorage` sotto la stessa chiave che scrive
// `CookieConsent`: `"accepted"` accende, `"necessary"` no, assente no.
// Chi non ha ancora risposto NON viene misurato, che è il verso giusto:
// il consenso si raccoglie prima, non si presume.
//
// L'evento `jht:cookie-consent` permette di accendere gli script nello
// stesso istante in cui l'utente accetta, senza ricaricare la pagina.
// Senza, il primo consenso non avrebbe effetto fino alla navigazione
// successiva — e chi accetta si aspetta che valga subito.

import { useEffect, useState } from "react";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

export const CONSENT_STORAGE_KEY = "jht:cookie-consent";
export const CONSENT_EVENT = "jht:cookie-consent";

/** Vero solo se l'utente ha accettato esplicitamente. */
function hasAccepted(): boolean {
  try {
    return localStorage.getItem(CONSENT_STORAGE_KEY) === "accepted";
  } catch {
    // Storage negato (navigazione privata, cookie bloccati): senza prova di
    // un consenso, non si misura.
    return false;
  }
}

export default function ConsentedAnalytics() {
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    setAccepted(hasAccepted());
    const onChange = () => setAccepted(hasAccepted());
    // `storage` copre le altre schede, l'evento custom copre questa.
    window.addEventListener(CONSENT_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(CONSENT_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  if (!accepted) return null;

  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
}
