import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Locale } from "@/i18n/config";

/**
 * The app's public web pages, opened in the person's own browser (src-tauri/src/public_pages.rs).
 * The renderer names one of three words; the addresses are the native side's constants.
 */
export type PublicPage = "privacy" | "terms" | "download";

export async function openPublicPage(page: PublicPage): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const reply = await invoke<{ ok?: unknown }>("open_public_page", { page });
    return reply?.ok === true;
  } catch {
    return false;
  }
}

export const PUBLIC_PAGE_TEXT: Record<Locale, { privacy: string; terms: string; failed: string }> = {
  it: { privacy: "Informativa sulla privacy", terms: "Termini di servizio", failed: "Non riesco ad aprire il browser. Apri jobhunterteam.ai da solo." },
  en: { privacy: "Privacy notice", terms: "Terms of service", failed: "The browser could not be opened. Open jobhunterteam.ai yourself." },
  de: { privacy: "Datenschutzerklärung", terms: "Nutzungsbedingungen", failed: "Der Browser konnte nicht geöffnet werden. Öffne jobhunterteam.ai selbst." },
  es: { privacy: "Aviso de privacidad", terms: "Términos del servicio", failed: "No se pudo abrir el navegador. Abre jobhunterteam.ai tú mismo." },
  fr: { privacy: "Politique de confidentialité", terms: "Conditions d’utilisation", failed: "Le navigateur n’a pas pu s’ouvrir. Ouvre jobhunterteam.ai toi-même." },
  hu: { privacy: "Adatvédelmi tájékoztató", terms: "Felhasználási feltételek", failed: "A böngészőt nem sikerült megnyitni. Nyisd meg te a jobhunterteam.ai oldalt." },
  pt: { privacy: "Aviso de privacidade", terms: "Termos de serviço", failed: "Não foi possível abrir o navegador. Abre tu o jobhunterteam.ai." },
};
