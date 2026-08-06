"use client";

// Quale sistema operativo sta guardando l'utente.
//
// Ordine di risoluzione: `?os=` nell'URL (così un link a una fase resta
// valido se lo si passa a qualcuno) → scelta salvata → rilevamento dal
// browser → macOS come ultima spiaggia. La scelta esplicita vince sempre e
// viene salvata: chi torna sulla guida ritrova il suo sistema.
//
// Il primo render è deliberatamente uguale sul server e sul client
// (`READY_FALSE`): il rilevamento avviene dentro `useEffect`, altrimenti
// l'HTML generato in build fisserebbe un OS a caso per tutti.

import { useCallback, useEffect, useState } from "react";

import { OS_IDS, type OsId } from "./guide-types";

const STORAGE_KEY = "jht-setup-guide-os";
const QUERY_KEY = "os";
const FALLBACK: OsId = "macos";

function isOsId(value: string | null): value is OsId {
  return value !== null && (OS_IDS as string[]).includes(value);
}

/** Il sistema suggerito dal browser. Solo un suggerimento: l'utente può
 *  scaricare per una macchina diversa da quella da cui legge. */
function detectFromBrowser(): OsId | undefined {
  if (typeof navigator === "undefined") return undefined;
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac")) return "macos";
  if (ua.includes("win")) return "windows";
  if (ua.includes("linux") || ua.includes("x11")) return "linux";
  return undefined;
}

export function useGuideOs(): {
  os: OsId;
  setOs: (next: OsId) => void;
  detected: boolean;
} {
  const [os, setOsState] = useState<OsId>(FALLBACK);
  const [detected, setDetected] = useState(false);

  useEffect(() => {
    const fromQuery = new URLSearchParams(window.location.search).get(
      QUERY_KEY,
    );
    if (isOsId(fromQuery)) {
      setOsState(fromQuery);
      setDetected(true);
      return;
    }
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch {
      // Storage negato (navigazione privata, cookie bloccati): si prosegue
      // col rilevamento, la guida non dipende dalla persistenza.
    }
    if (isOsId(saved)) {
      setOsState(saved);
      setDetected(true);
      return;
    }
    setOsState(detectFromBrowser() ?? FALLBACK);
    setDetected(true);
  }, []);

  const setOs = useCallback((next: OsId) => {
    setOsState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Vedi sopra: la scelta vale comunque per questa visita.
    }
    try {
      const url = new URL(window.location.href);
      url.searchParams.set(QUERY_KEY, next);
      window.history.replaceState(null, "", url);
    } catch {
      // Se l'URL non è riscrivibile la guida funziona lo stesso.
    }
  }, []);

  return { os, setOs, detected };
}
