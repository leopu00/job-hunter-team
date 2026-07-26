// [JHT-WEB-DEMO] Stato server-side della modalità demo (cookie-based).
// La demo si attiva quando l'utente sceglie una categoria nel wizard
// /welcome (POST /api/demo → cookie) e vale SOLO sul deploy cloud: sul
// desktop/local l'utente ha i suoi dati veri e il wizard non esiste.
// I giudizi dati alle posizioni demo vivono in un secondo cookie (overlay),
// così l'interazione feedback è dimostrabile end-to-end senza toccare il DB.
import { cookies } from "next/headers";
import { isCloudDeploy } from "@/lib/deploy-mode";
import { isDemoPersonaKey, type DemoPersonaKey } from "@/lib/demo/data";
import { verdictOf, type Verdict } from "@/lib/position-verdict";

export const DEMO_PERSONA_COOKIE = "jht_demo_persona";
export const DEMO_FEEDBACK_COOKIE = "jht_demo_feedback";
// Wizard /welcome già visto/saltato: non riproporlo a ogni visita.
export const WELCOME_SEEN_COOKIE = "jht_welcome_seen";

// Persona demo attiva per la richiesta corrente (null = niente demo).
export async function activeDemoPersona(): Promise<DemoPersonaKey | null> {
  if (!isCloudDeploy()) return null;
  // Override dev/test (stesso pattern di JHT_WEB_DASHBOARD_DEMO): forza la
  // persona senza passare dal wizard — utile per collaudare le pagine demo.
  const envPersona = process.env.JHT_WEB_DEMO_PERSONA;
  if (isDemoPersonaKey(envPersona)) return envPersona;
  try {
    const store = await cookies();
    const v = store.get(DEMO_PERSONA_COOKIE)?.value;
    return isDemoPersonaKey(v) ? v : null;
  } catch {
    // cookies() fuori dal request scope (build/prerender) → niente demo.
    return null;
  }
}

// ── Overlay feedback demo ───────────────────────────────────────────
// Cookie JSON compatto { "<legacyId>": { a: action, s: score|null } }.
// Stessa semantica event-log del feedback reale: l'ultimo prevale (qui
// c'è solo l'ultimo). Cap difensivo sulla taglia: è un cookie.
export type DemoFeedbackEntry = { a: string; s: number | null };
export type DemoFeedbackMap = Record<string, DemoFeedbackEntry>;

export function parseDemoFeedback(raw: string | undefined): DemoFeedbackMap {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object" && !Array.isArray(v))
      return v as DemoFeedbackMap;
  } catch {}
  return {};
}

export async function readDemoFeedback(): Promise<DemoFeedbackMap> {
  try {
    const store = await cookies();
    return parseDemoFeedback(store.get(DEMO_FEEDBACK_COOKIE)?.value);
  } catch {
    return {};
  }
}

export function serializeDemoFeedback(map: DemoFeedbackMap): string {
  const keys = Object.keys(map);
  // Un cookie ha ~4KB di budget: 150 giudizi compatti ci stanno larghi,
  // e le posizioni demo sono ~26 per persona — il cap non scatta mai in
  // pratica, è solo una cintura di sicurezza.
  if (keys.length > 150) {
    for (const k of keys.slice(0, keys.length - 150)) delete map[k];
  }
  return JSON.stringify(map);
}

// Adattatore sulla forma compatta del cookie demo (`a`/`s`): la regola
// è quella vera, non una sua imitazione.
export function demoVerdictOf(e: DemoFeedbackEntry): Verdict {
  return verdictOf(e.a, e.s);
}
