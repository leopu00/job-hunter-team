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
const CHECK_KEY = "jht-update-check";

/** On unless the person turned it off in Settings; kept on this computer. Storage that fails is «on» (the default). */
export function updateCheckEnabled(): boolean {
  try {
    return localStorage.getItem(CHECK_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setUpdateCheckEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(CHECK_KEY);
    else localStorage.setItem(CHECK_KEY, "off");
  } catch {
    /* no storage: the choice lasts until the app is closed only if the page keeps it; nothing to do here */
  }
  if (!enabled) asked = null;
}

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
  if (!isTauri() || !updateCheckEnabled()) return Promise.resolve(null);
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
  pt: { message: "Já está disponível o Job Hunter Team {version}.", download: "Descarregar", dismiss: "Agora não", failed: "Não foi possível abrir o navegador. Abre tu o jobhunterteam.ai." },
};

export const UPDATE_CHECK_TEXT: Record<Locale, { title: string; text: string; on: string; off: string }> = {
  it: { title: "Nuove versioni", text: "All’avvio l’app chiede a GitHub qual è l’ultima versione pubblica. Nessun account né dato tuo; GitHub vede l’indirizzo IP e la versione dell’app. Non scarica né installa niente.", on: "Controlla all’avvio", off: "Non controllare" },
  en: { title: "New versions", text: "At startup the app asks GitHub which is the latest public version. No account or data of yours; GitHub sees the IP address and the app's version. It downloads and installs nothing.", on: "Check at startup", off: "Do not check" },
  de: { title: "Neue Versionen", text: "Beim Start fragt die App GitHub nach der neuesten öffentlichen Version. Kein Konto und keine Daten von dir; GitHub sieht die IP-Adresse und die Version der App. Es wird nichts heruntergeladen oder installiert.", on: "Beim Start prüfen", off: "Nicht prüfen" },
  es: { title: "Versiones nuevas", text: "Al iniciar, la app pregunta a GitHub cuál es la última versión pública. Ninguna cuenta ni dato tuyo; GitHub ve la dirección IP y la versión de la app. No descarga ni instala nada.", on: "Comprobar al iniciar", off: "No comprobar" },
  fr: { title: "Nouvelles versions", text: "Au démarrage, l’app demande à GitHub quelle est la dernière version publique. Aucun compte ni donnée de ta part ; GitHub voit l’adresse IP et la version de l’app. Rien n’est téléchargé ni installé.", on: "Vérifier au démarrage", off: "Ne pas vérifier" },
  hu: { title: "Új verziók", text: "Indításkor az app megkérdezi a GitHubtól, mi a legfrissebb nyilvános verzió. Nincs fiók vagy saját adatod; a GitHub látja az IP-címet és az app verzióját. Semmit nem tölt le és nem telepít.", on: "Ellenőrzés indításkor", off: "Ne ellenőrizzen" },
  pt: { title: "Versões novas", text: "No arranque, a app pergunta ao GitHub qual é a última versão pública. Nenhuma conta nem dado teu; o GitHub vê o endereço IP e a versão da app. Não descarrega nem instala nada.", on: "Verificar no arranque", off: "Não verificar" },
};
