import { SEED_KEYS, TOKEN_NAMES, checkTokens, isHexColour, seedFamily, type Seeds, type Tokens } from "./theme-custom";

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

/** What is stored and chosen: one of the palettes, the person's own palette, or «follow the system» (also what nobody chose yet). */
export const SYSTEM_THEME = "system";
export const CUSTOM_THEME = "custom";
export type ThemePreference = Theme | typeof SYSTEM_THEME | typeof CUSTOM_THEME;
/** What can be on the page: a palette of the table, or the person's own. The own one is NOT in THEMES. */
export type AppliedTheme = Theme | typeof CUSTOM_THEME;

/**
 * The person's palette, kept whole: the five colours they chose, the 21 tokens computed from them at the moment
 * of saving (the page's first drawing uses these and does no maths), the palette they started from (it decides
 * the 7:1 bar) and the base, light or dark, that the panel's lightness gave.
 */
export const CUSTOM_STORAGE_KEY = "jht-desktop-theme-custom";
export type CustomTheme = { v: 1; start: Theme; family: ThemeFamily; seeds: Seeds; vars: Tokens };

export const DEFAULT_THEME: Theme = "dark";

/** The palette «follow the system» gives when the system asks for light, and when it does not. */
export const SYSTEM_LIGHT_THEME: Theme = "light";
export const SYSTEM_DARK_THEME: Theme = "dark";

export function themeFamily(theme: Theme): ThemeFamily {
  return THEMES.find((entry) => entry.value === theme)!.family;
}

type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

const GRID = /^rgba\((\d{1,3}), (\d{1,3}), (\d{1,3}), 0\.\d{1,3}\)$/;
const isTokenValue = (name: string, value: unknown) => {
  if (typeof value !== "string") return false;
  if (name !== "--color-grid") return isHexColour(value);
  const channels = GRID.exec(value);
  return channels !== null && channels.slice(1).every((c) => Number(c) <= 255);
};
const hasExactlyKeys = (value: object, keys: readonly string[]) => {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
};
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The stored text read as a custom palette, or null at the first thing that is not exactly right: any extra
 * or missing key, a colour that is not #rrggbb, a base that is not the one the panel gives, a palette the
 * contrast guard would refuse. Nothing is repaired: a doubtful palette is not used.
 */
export function parseCustomTheme(raw: unknown): CustomTheme | null {
  let value: unknown;
  try {
    value = typeof raw === "string" ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
  if (!isPlainObject(value) || !hasExactlyKeys(value, ["v", "start", "family", "seeds", "vars"])) return null;
  const { v, start, family, seeds, vars } = value;
  if (v !== 1 || !isTheme(start) || (family !== "dark" && family !== "light")) return null;
  if (!isPlainObject(seeds) || !hasExactlyKeys(seeds, SEED_KEYS) || !SEED_KEYS.every((key) => isHexColour(seeds[key]))) return null;
  if (!isPlainObject(vars) || !hasExactlyKeys(vars, TOKEN_NAMES) || !TOKEN_NAMES.every((name) => isTokenValue(name, vars[name]))) return null;
  if (seedFamily(seeds as Seeds) !== family) return null;
  if (checkTokens(vars as Tokens, { strict: start === "contrast" }).length > 0) return null;
  return value as CustomTheme;
}

/** The person's palette as stored, or null when nothing valid is stored. */
export function readStoredCustom(storage: ThemeStorage): CustomTheme | null {
  try {
    return parseCustomTheme(storage.getItem(CUSTOM_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function isTheme(value: unknown): value is Theme {
  return THEMES.some((theme) => theme.value === value);
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === SYSTEM_THEME || value === CUSTOM_THEME || isTheme(value);
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

/**
 * What was chosen: a stored palette, or «follow the system» when nothing valid is stored. The person's own palette
 * counts only while a valid one is stored with it.
 */
export function readStoredPreference(storage: ThemeStorage): ThemePreference {
  try {
    const stored = storage.getItem(THEME_STORAGE_KEY);
    if (stored === CUSTOM_THEME) return readStoredCustom(storage) ? CUSTOM_THEME : SYSTEM_THEME;
    return isThemePreference(stored) ? stored : SYSTEM_THEME;
  } catch {
    return SYSTEM_THEME;
  }
}

/** The palette a preference stands for right now. */
export function resolveTheme(
  preference: ThemePreference,
  prefersLight: boolean = systemPrefersLight(),
): AppliedTheme {
  if (preference !== SYSTEM_THEME) return preference;
  return prefersLight ? SYSTEM_LIGHT_THEME : SYSTEM_DARK_THEME;
}

/** The palette in force: what is stored, or the system's pair of palettes. */
export function readStoredTheme(
  storage: ThemeStorage,
  prefersLight: boolean = systemPrefersLight(),
): AppliedTheme {
  return resolveTheme(readStoredPreference(storage), prefersLight);
}

/** Puts the palette on the page; for the person's own it reads it from `storage` and, if it is not valid, dresses the system's. */
export function applyTheme(
  theme: AppliedTheme,
  root: HTMLElement = document.documentElement,
  storage: ThemeStorage = window.localStorage,
) {
  // the own palette is inline variables: any other theme must not inherit them
  for (const name of TOKEN_NAMES) root.style?.removeProperty(name);
  const custom = theme === CUSTOM_THEME ? readStoredCustom(storage) : null;
  if (custom) {
    for (const name of TOKEN_NAMES) root.style.setProperty(name, custom.vars[name]);
    root.dataset.jhtTheme = CUSTOM_THEME;
    root.dataset.theme = custom.family;
    return;
  }
  const palette = theme === CUSTOM_THEME ? resolveTheme(SYSTEM_THEME) : theme;
  root.dataset.jhtTheme = palette;
  // Reused web views understand only light/dark. Keep that contract while
  // data-jht-theme carries the desktop's richer palette.
  root.dataset.theme = themeFamily(palette as Theme);
}

export function initializeTheme(
  storage: ThemeStorage = window.localStorage,
  root: HTMLElement = document.documentElement,
): AppliedTheme {
  const theme = readStoredTheme(storage);
  applyTheme(theme, root, storage);
  return theme;
}

/** Chooses a palette, or «follow the system», and keeps the choice. */
export function persistTheme(
  preference: ThemePreference,
  storage: ThemeStorage = window.localStorage,
  root: HTMLElement = document.documentElement,
): AppliedTheme {
  // «custom» is chosen only while a valid own palette is stored: otherwise it is the system's
  const chosen = preference === CUSTOM_THEME && !readStoredCustom(storage) ? SYSTEM_THEME : preference;
  const theme = resolveTheme(chosen);
  applyTheme(theme, root, storage);
  try {
    storage.setItem(THEME_STORAGE_KEY, chosen);
  } catch {
    // A denied/full localStorage must not prevent the in-memory choice.
  }
  return theme;
}

/**
 * Keeps the person's palette and chooses it. Refuses (false, nothing written) what `parseCustomTheme` would
 * not read back, so the contrast guard is the same here and at every start.
 */
export function saveCustomTheme(
  custom: CustomTheme,
  storage: ThemeStorage = window.localStorage,
  root: HTMLElement = document.documentElement,
): boolean {
  const text = JSON.stringify(custom);
  if (!parseCustomTheme(text)) return false;
  try {
    storage.setItem(CUSTOM_STORAGE_KEY, text);
    storage.setItem(THEME_STORAGE_KEY, CUSTOM_THEME);
  } catch {
    // A denied/full localStorage must not prevent the in-memory choice.
  }
  applyTheme(CUSTOM_THEME, root, { getItem: (key) => (key === CUSTOM_STORAGE_KEY ? text : null), setItem: () => {} });
  return true;
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
    onChange(event.matches ? SYSTEM_LIGHT_THEME : SYSTEM_DARK_THEME);
  query.addEventListener("change", listener);
  return () => query?.removeEventListener("change", listener);
}
