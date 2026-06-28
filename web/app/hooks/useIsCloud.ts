"use client";

import { useEffect, useState } from "react";

// useIsCloud — true se la dashboard sta girando in CLOUD mode (Vercel/Supabase,
// nessun SQLite locale), false in locale/desktop, null finché non è noto.
//
// Serve a SPEGNERE il polling continuo sulle pagine "live" del team quando
// siamo sul web: da cloud la sincronizzazione avviene SOLO on-demand (pulsante
// "Sync now" / apertura), MAI con setInterval che scala col numero di tab.
// In locale/desktop il polling resta pieno (è il teatro live del team).
//
// Una sola fetch condivisa a livello di modulo (cache + inflight dedup): anche
// se 20 componenti chiamano l'hook, /api/local/sync/status viene colpito una
// volta sola. Fonte = lo stesso campo `remote` usato da CloudSyncStatusBanner.
//
// [JHT-DASHBOARD-SPLIT] Quando il deploy-mode è FISSATO a build via
// NEXT_PUBLIC_JHT_DEPLOY (cloud su Vercel, local nel container), quella è la
// fonte di verità deterministica → ZERO round-trip: `cached` parte già valorizzato
// e il fetch non viene mai eseguito. Se l'env è assente (oggi, finché Vercel non
// è configurato) si ricade sul vecchio comportamento via /api/local/sync/status,
// quindi nessuna regressione. Vedi web/lib/deploy-mode.ts.

const ENV_MODE = process.env.NEXT_PUBLIC_JHT_DEPLOY?.trim().toLowerCase();
const ENV_IS_CLOUD: boolean | null =
  ENV_MODE === "cloud" ? true : ENV_MODE === "local" ? false : null;

let cached: boolean | null = ENV_IS_CLOUD;
let inflight: Promise<boolean> | null = null;

function fetchIsCloud(): Promise<boolean> {
  if (cached !== null) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetch("/api/local/sync/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        cached = !!(s && s.remote);
        return cached;
      })
      .catch(() => {
        // In dubbio NON spegniamo il polling (meglio un po' di rete in più che
        // una pagina morta in locale): trattiamo l'errore come "non cloud".
        cached = false;
        return false;
      });
  }
  return inflight;
}

export function useIsCloud(): boolean | null {
  const [isCloud, setIsCloud] = useState<boolean | null>(cached);

  useEffect(() => {
    let mounted = true;
    fetchIsCloud().then((v) => {
      if (mounted) setIsCloud(v);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return isCloud;
}
