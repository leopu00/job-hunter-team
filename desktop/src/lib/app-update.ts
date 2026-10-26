import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Locale } from "@/i18n/config";

/**
 * «A new version is out» (src-tauri/src/app_update.rs). The native side reads the project's latest public
 * release once and answers the version if it is above the running one; the banner links to the download page
 * (`open_public_page("download")`, an address the native side owns). Nothing is downloaded or installed.
 * Any doubt (no network, an odd answer, not in the desktop) is no banner.
 */
const VERSION = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;
const DISMISSED_KEY = "jht-update-dismissed";

let asked: Promise<string | null> | null = null;

async function ask(): Promise<string | null> {
  try {
    const reply = await invoke<{ newer?: unknown }>("latest_app_version");
    return typeof reply?.newer === "string" && VERSION.test(reply.newer) ? reply.newer : null;
  } catch {
    return null;
  }
}

/** Asked ONCE per run of the app, however many times the shell mounts the banner (the answer is kept). */
export function newerVersion(): Promise<string | null> {
  if (!isTauri()) return Promise.resolve(null);
  asked ??= ask();
  return asked;
}

/** For tests: forget the answer. */
export function forgetAskedVersion(): void {
  asked = null;
}

/** The version the person closed the banner for: that one stays closed, the next one shows again. */
export function dismissedVersion(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

export function dismissVersion(version: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    /* no storage: the banner comes back at the next start */
  }
}

export const UPDATE_TEXT: Record<Locale, { message: string; download: string; dismiss: string; failed: string }> = {
  it: { message: "È disponibile la versione {version} di Job Hunter Team.", download: "Scarica", dismiss: "Non ora", failed: "Non riesco ad aprire il browser. Apri jobhunterteam.ai da solo." },
  en: { message: "Job Hunter Team {version} is available.", download: "Download", dismiss: "Not now", failed: "The browser could not be opened. Open jobhunterteam.ai yourself." },
  de: { message: "Job Hunter Team {version} ist verfügbar.", download: "Herunterladen", dismiss: "Nicht jetzt", failed: "Der Browser konnte nicht geöffnet werden. Öffne jobhunterteam.ai selbst." },
  es: { message: "Ya está disponible Job Hunter Team {version}.", download: "Descargar", dismiss: "Ahora no", failed: "No se pudo abrir el navegador. Abre jobhunterteam.ai tú mismo." },
  fr: { message: "Job Hunter Team {version} est disponible.", download: "Télécharger", dismiss: "Pas maintenant", failed: "Le navigateur n’a pas pu s’ouvrir. Ouvre jobhunterteam.ai toi-même." },
  hu: { message: "Elérhető a Job Hunter Team {version} verziója.", download: "Letöltés", dismiss: "Most nem", failed: "A böngészőt nem sikerült megnyitni. Nyisd meg te a jobhunterteam.ai oldalt." },
  pt: { message: "Já está disponível o Job Hunter Team {version}.", download: "Transferir", dismiss: "Agora não", failed: "Não foi possível abrir o navegador. Abre tu o jobhunterteam.ai." },
};
