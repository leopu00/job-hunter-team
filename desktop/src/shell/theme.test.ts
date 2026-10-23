import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  initializeTheme,
  persistTheme,
  readStoredPreference,
  readStoredTheme,
  resolveTheme,
  systemPrefersLight,
  THEME_STORAGE_KEY,
  THEMES,
  themeFamily,
  watchSystemTheme,
} from "./theme";

beforeEach(() => {
  localStorage.removeItem(THEME_STORAGE_KEY);
  document.documentElement.removeAttribute("data-jht-theme");
  document.documentElement.removeAttribute("data-theme");
});

describe("desktop theme persistence", () => {
  it("falls back safely when the stored value is invalid", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "ultraviolet");

    expect(readStoredTheme(localStorage)).toBe(DEFAULT_THEME);
    expect(initializeTheme()).toBe("dark");
    expect(document.documentElement).toHaveAttribute("data-jht-theme", "dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("maps the two light palettes onto the reused web light mode", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "paper");

    expect(initializeTheme()).toBe("paper");
    expect(document.documentElement).toHaveAttribute("data-jht-theme", "paper");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });
});

describe("follow the system, the default of who never chose", () => {
  it("nothing stored (or something unknown) means the system decides, and a choice is kept against the system", () => {
    expect(readStoredPreference(localStorage)).toBe("system");
    localStorage.setItem(THEME_STORAGE_KEY, "ultraviolet");
    expect(readStoredPreference(localStorage)).toBe("system");
    localStorage.setItem(THEME_STORAGE_KEY, "system");
    expect(readStoredPreference(localStorage)).toBe("system");
    expect(readStoredTheme(localStorage, true)).toBe("light");
    expect(readStoredTheme(localStorage, false)).toBe("dark");
    // who already chose keeps the palette, whatever the system says
    localStorage.setItem(THEME_STORAGE_KEY, "graphite");
    expect(readStoredTheme(localStorage, true)).toBe("graphite");
    localStorage.setItem(THEME_STORAGE_KEY, "sage");
    expect(readStoredTheme(localStorage, false)).toBe("sage");
  });

  it("resolves a preference to a palette", () => {
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
    for (const { value } of THEMES) expect(resolveTheme(value, true)).toBe(value);
  });

  it("asks the system through matchMedia and falls back to dark without it", () => {
    expect(systemPrefersLight({ matchMedia: () => ({ matches: true }) as MediaQueryList })).toBe(true);
    expect(systemPrefersLight({ matchMedia: () => ({ matches: false }) as MediaQueryList })).toBe(false);
    expect(systemPrefersLight({} as Window)).toBe(false);
    expect(systemPrefersLight({ matchMedia: () => { throw new Error("x"); } } as unknown as Window)).toBe(false);
  });

  it("persists the choice, «system» included, and dresses the page with the palette it stands for", () => {
    expect(persistTheme("midnight")).toBe("midnight");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("midnight");
    expect(document.documentElement).toHaveAttribute("data-jht-theme", "midnight");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    persistTheme("lavender");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    persistTheme("system");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
  });

  it("gives every palette the base that dresses the reused web views", () => {
    for (const { value, family } of THEMES) {
      localStorage.setItem(THEME_STORAGE_KEY, value);
      initializeTheme();
      expect(document.documentElement).toHaveAttribute("data-theme", family);
      expect(themeFamily(value)).toBe(family);
    }
  });

  it("applies a change of the system's light/dark while it decides, and stops when told", () => {
    let listener: ((event: MediaQueryListEvent) => void) | undefined;
    let removed = false;
    const query = {
      addEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => { listener = fn; },
      removeEventListener: () => { removed = true; },
    } as unknown as MediaQueryList;
    const seen: string[] = [];
    const stop = watchSystemTheme((theme) => seen.push(theme), { matchMedia: () => query });
    listener!({ matches: true } as MediaQueryListEvent);
    listener!({ matches: false } as MediaQueryListEvent);
    expect(seen).toEqual(["light", "dark"]);
    stop();
    expect(removed).toBe(true);
    // without matchMedia it listens to nothing and stopping is harmless
    expect(() => watchSystemTheme(() => {}, {} as Window)()).not.toThrow();
  });
});
