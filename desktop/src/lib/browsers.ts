import { invoke, isTauri } from "@tauri-apps/api/core";

/** Un browser installato, come lo rileva il backend (src-tauri/src/browsers.rs). */
export interface InstalledBrowser {
  id: string;
  name: string;
}

/** `default` = il browser predefinito, `manual` = nessuno, copio il link. */
export type BrowserChoice = "default" | "manual" | (string & {});

export async function listBrowsers(): Promise<InstalledBrowser[]> {
  if (!isTauri()) return [];
  return invoke<InstalledBrowser[]>("auth_browsers");
}

// Una preferenza, non un segreto: localStorage basta.
const CHOICE_KEY = "jht.login.browser";

/** L'ultima scelta, se ha ancora senso: un browser disinstallato torna al predefinito. */
export function readBrowserChoice(installed: InstalledBrowser[]): BrowserChoice {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(CHOICE_KEY);
  } catch {
    return "default";
  }
  if (saved === "default" || saved === "manual") return saved;
  if (saved && installed.some((browser) => browser.id === saved)) return saved;
  return "default";
}

export function saveBrowserChoice(choice: BrowserChoice): void {
  try {
    localStorage.setItem(CHOICE_KEY, choice);
  } catch {
    // Senza storage si sceglie di nuovo la prossima volta.
  }
}
