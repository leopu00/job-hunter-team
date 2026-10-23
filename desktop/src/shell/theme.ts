export const THEME_STORAGE_KEY = "jht-desktop-theme";

/**
 * The desktop's palettes. Each one is a block of semantic colour variables in dashboard/dashboard.css
 * (`:root[data-jht-theme="…"]`) and a BASE, light or dark, which says how the reused web views behave
 * (`data-theme`). The base is written here once: dashboard.html reads the same table through a test that
 * runs its script, so the two cannot drift apart.
 */
export const THEMES = [
  { value: "dark", label: "Scuro", family: "dark" },
  { value: "light", label: "Chiaro", family: "light" },
  { value: "graphite", label: "Grafite", family: "dark" },
  { value: "ocean", label: "Oceano", family: "dark" },
  { value: "paper", label: "Carta", family: "light" },
  { value: "midnight", label: "Mezzanotte", family: "dark" },
  { value: "forest", label: "Foresta", family: "dark" },
  { value: "dusk", label: "Crepuscolo", family: "dark" },
  { value: "contrast", label: "Alto contrasto", family: "dark" },
  { value: "sage", label: "Salvia", family: "light" },
  { value: "lavender", label: "Lavanda", family: "light" },
] as const;

export type Theme = (typeof THEMES)[number]["value"];
export type ThemeFamily = (typeof THEMES)[number]["family"];

/** What is stored and chosen: one of the palettes, or «follow the system» (also what nobody chose yet). */
export const SYSTEM_THEME = "system";
export type ThemePreference = Theme | typeof SYSTEM_THEME;

export const DEFAULT_THEME: Theme = "dark";

/** The palette «follow the system» gives when the system asks for light, and when it does not. */
export const SYSTEM_LIGHT_THEME: Theme = "light";
export const SYSTEM_DARK_THEME: Theme = "dark";

export function themeFamily(theme: Theme): ThemeFamily {
  return THEMES.find((entry) => entry.value === theme)!.family;
}

type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

export function isTheme(value: unknown): value is Theme {
  return THEMES.some((theme) => theme.value === value);
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === SYSTEM_THEME || isTheme(value);
}

/** Does the system ask for light? A webview without `matchMedia` (or one that throws) asks for dark. */
export function systemPrefersLight(
  win: Pick<Window, "matchMedia"> | undefined = typeof window === "undefined" ? undefined : window,
): boolean {
  try {
    return win?.matchMedia?.("(prefers-color-scheme: light)")?.matches === true;
  } catch {
    return false;
  }
}

/** What was chosen: a stored palette, or «follow the system» when nothing valid is stored. */
export function readStoredPreference(storage: ThemeStorage): ThemePreference {
  try {
    const stored = storage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : SYSTEM_THEME;
  } catch {
    return SYSTEM_THEME;
  }
}

/** The palette a preference stands for right now. */
export function resolveTheme(
  preference: ThemePreference,
  prefersLight: boolean = systemPrefersLight(),
): Theme {
  if (preference !== SYSTEM_THEME) return preference;
  return prefersLight ? SYSTEM_LIGHT_THEME : SYSTEM_DARK_THEME;
}

/** The palette in force: what is stored, or the system's pair of palettes. */
export function readStoredTheme(
  storage: ThemeStorage,
  prefersLight: boolean = systemPrefersLight(),
): Theme {
  return resolveTheme(readStoredPreference(storage), prefersLight);
}

export function applyTheme(
  theme: Theme,
  root: HTMLElement = document.documentElement,
) {
  root.dataset.jhtTheme = theme;
  // Reused web views understand only light/dark. Keep that contract while
  // data-jht-theme carries the desktop's richer palette.
  root.dataset.theme = themeFamily(theme);
}

export function initializeTheme(
  storage: ThemeStorage = window.localStorage,
  root: HTMLElement = document.documentElement,
): Theme {
  const theme = readStoredTheme(storage);
  applyTheme(theme, root);
  return theme;
}

/** Chooses a palette, or «follow the system», and keeps the choice. */
export function persistTheme(
  preference: ThemePreference,
  storage: ThemeStorage = window.localStorage,
  root: HTMLElement = document.documentElement,
): Theme {
  const theme = resolveTheme(preference);
  applyTheme(theme, root);
  try {
    storage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // A denied/full localStorage must not prevent the in-memory choice.
  }
  return theme;
}

/**
 * While «follow the system» is the choice, a change of the system's light/dark applies at once. Returns the
 * function that stops listening.
 */
export function watchSystemTheme(
  onChange: (theme: Theme) => void,
  win: Pick<Window, "matchMedia"> | undefined = typeof window === "undefined" ? undefined : window,
): () => void {
  let query: MediaQueryList | undefined;
  try {
    query = win?.matchMedia?.("(prefers-color-scheme: light)");
  } catch {
    query = undefined;
  }
  if (!query?.addEventListener) return () => {};
  const listener = (event: MediaQueryListEvent) =>
    onChange(resolveTheme(SYSTEM_THEME, event.matches));
  query.addEventListener("change", listener);
  return () => query?.removeEventListener("change", listener);
}
