export const THEME_STORAGE_KEY = "jht-desktop-theme";

export const THEMES = [
  { value: "dark", label: "Scuro" },
  { value: "light", label: "Chiaro" },
  { value: "graphite", label: "Grafite" },
  { value: "ocean", label: "Oceano" },
  { value: "paper", label: "Carta" },
] as const;

export type Theme = (typeof THEMES)[number]["value"];

export const DEFAULT_THEME: Theme = "dark";

type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

export function isTheme(value: unknown): value is Theme {
  return THEMES.some((theme) => theme.value === value);
}

export function readStoredTheme(storage: ThemeStorage): Theme {
  try {
    const stored = storage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(
  theme: Theme,
  root: HTMLElement = document.documentElement,
) {
  root.dataset.jhtTheme = theme;
  // Reused web views understand only light/dark. Keep that contract while
  // data-jht-theme carries the desktop's richer palette.
  root.dataset.theme = theme === "light" || theme === "paper" ? "light" : "dark";
}

export function initializeTheme(
  storage: ThemeStorage = window.localStorage,
  root: HTMLElement = document.documentElement,
): Theme {
  const theme = readStoredTheme(storage);
  applyTheme(theme, root);
  return theme;
}

export function persistTheme(
  theme: Theme,
  storage: ThemeStorage = window.localStorage,
  root: HTMLElement = document.documentElement,
) {
  applyTheme(theme, root);
  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // A denied/full localStorage must not prevent the in-memory choice.
  }
}
