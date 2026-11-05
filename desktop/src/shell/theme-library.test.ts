import { beforeEach, describe, expect, it } from "vitest";
import { PRESETS } from "./theme-presets";
import { checkSeeds, type Seeds } from "./theme-custom";
import {
  CUSTOM_STORAGE_KEY,
  LIBRARY_MAX,
  LIBRARY_STORAGE_KEY,
  THEME_STORAGE_KEY,
  activeSavedIndex,
  chooseSavedTheme,
  deleteSavedTheme,
  persistTheme,
  readStoredCustom,
  readStoredPreference,
  readThemeLibrary,
  saveCustomTheme,
  saveNamedTheme,
  type SavedTheme,
} from "./theme";

/** A valid theme from a ready palette with another main colour, under a name. */
function named(name: string, accent = "#e0a030", from: "dark" | "forest" = "dark"): SavedTheme {
  const seeds: Seeds = { ...PRESETS[from].seeds, accent };
  const { tokens, failures } = checkSeeds(seeds, { status: PRESETS[from].status, strict: false });
  expect(failures).toEqual([]);
  return { v: 1, start: from, family: "dark", seeds, vars: tokens, name };
}
const palette = ({ name: _name, ...rest }: SavedTheme) => rest;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  delete document.documentElement.dataset.jhtTheme;
  delete document.documentElement.dataset.theme;
});

describe("the person's themes, each with a name", () => {
  it("is empty when nothing was ever saved", () => {
    expect(readThemeLibrary(localStorage)).toEqual([]);
    expect(activeSavedIndex(localStorage)).toBe(-1);
  });

  it("shows the single theme saved before names existed as the first entry, with no name, chosen if it is in force", () => {
    saveCustomTheme(palette(named("x")));
    const library = readThemeLibrary(localStorage);
    expect(library).toEqual([{ ...palette(named("x")), name: "" }]);
    expect(activeSavedIndex(localStorage)).toBe(0);
  });

  it("saves a theme under its name, puts it in force and keeps the pair of keys dashboard.html reads first", () => {
    expect(saveNamedTheme(named("Il mio verde"))).toBe("saved");
    expect(readThemeLibrary(localStorage).map((t) => t.name)).toEqual(["Il mio verde"]);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("custom");
    expect(readStoredCustom(localStorage)).toEqual(palette(named("Il mio verde")));
    expect(document.documentElement.dataset.jhtTheme).toBe("custom");
    expect(activeSavedIndex(localStorage)).toBe(0);
  });

  it("keeps the old unnamed theme when a second one is saved, and can name it by saving it again", () => {
    saveCustomTheme(palette(named("x", "#e0a030")));
    expect(saveNamedTheme(named("Seconda", "#7cc4ff"))).toBe("saved");
    expect(readThemeLibrary(localStorage).map((t) => t.name)).toEqual(["", "Seconda"]);
    expect(chooseSavedTheme(0)).toBe(true);
    expect(saveNamedTheme(named("Prima", "#e0a030"), "")).toBe("saved");
    expect(readThemeLibrary(localStorage).map((t) => t.name)).toEqual(["Prima", "Seconda"]);
  });

  it("refuses a name another saved theme already has (whatever the case), and renames the one being edited", () => {
    saveNamedTheme(named("Verde"));
    saveNamedTheme(named("Blu", "#7cc4ff"));
    expect(saveNamedTheme(named(" verde ", "#7cc4ff"))).toBe("taken");
    expect(saveNamedTheme(named("verde", "#7cc4ff"), "Blu")).toBe("taken");
    expect(saveNamedTheme(named("Azzurro", "#7cc4ff"), "Blu")).toBe("saved");
    expect(readThemeLibrary(localStorage).map((t) => t.name)).toEqual(["Verde", "Azzurro"]);
    // the theme being edited may keep its own name
    expect(saveNamedTheme(named("Azzurro", "#8fd0ff"), "Azzurro")).toBe("saved");
    expect(readThemeLibrary(localStorage)[1].seeds.accent).toBe("#8fd0ff");
  });

  it(`holds ${LIBRARY_MAX} themes at most`, () => {
    for (let i = 0; i < LIBRARY_MAX; i++) expect(saveNamedTheme(named(`Tema ${i}`))).toBe("saved");
    expect(saveNamedTheme(named("Uno di troppo"))).toBe("full");
    expect(readThemeLibrary(localStorage)).toHaveLength(LIBRARY_MAX);
    // replacing one is still allowed
    expect(saveNamedTheme(named("Rinominato"), "Tema 3")).toBe("saved");
  });

  it("refuses an empty or too long name, and a palette the contrast guard would refuse", () => {
    expect(saveNamedTheme(named("   "))).toBe("invalid");
    expect(saveNamedTheme(named("x".repeat(41)))).toBe("invalid");
    const unreadable = { ...named("Illeggibile"), vars: { ...named("x").vars, "--color-base": "#111116" } };
    expect(saveNamedTheme(unreadable)).toBe("invalid");
    expect(localStorage.getItem(LIBRARY_STORAGE_KEY)).toBeNull();
  });

  it("leaves out what is not exactly right in the stored list, and never repairs it", () => {
    const good = named("Buono");
    localStorage.setItem(
      LIBRARY_STORAGE_KEY,
      JSON.stringify({ v: 1, themes: [good, { ...good, name: "Doppio" }, { ...good, name: "buono" }, { ...good, name: 7 }, { ...good, extra: 1, name: "Extra" }, { ...good, name: "Rotto", vars: {} }] }),
    );
    expect(readThemeLibrary(localStorage).map((t) => t.name)).toEqual(["Buono", "Doppio"]);
    for (const bad of ["not json", "[]", JSON.stringify({ v: 2, themes: [good] }), JSON.stringify({ v: 1, themes: {} })]) {
      localStorage.setItem(LIBRARY_STORAGE_KEY, bad);
      expect(readThemeLibrary(localStorage), bad).toEqual([]);
    }
  });

  it("chooses a saved theme, and a ready palette chosen after it leaves the list as it is", () => {
    saveNamedTheme(named("Verde"));
    saveNamedTheme(named("Blu", "#7cc4ff"));
    expect(activeSavedIndex(localStorage)).toBe(1);
    expect(chooseSavedTheme(0)).toBe(true);
    expect(activeSavedIndex(localStorage)).toBe(0);
    persistTheme("graphite");
    expect(activeSavedIndex(localStorage)).toBe(-1);
    expect(readThemeLibrary(localStorage)).toHaveLength(2);
    expect(chooseSavedTheme(5)).toBe(false);
  });

  it("deletes a saved theme: the one in force gives way to the system's palette, another one leaves the choice alone", () => {
    saveNamedTheme(named("Verde"));
    saveNamedTheme(named("Blu", "#7cc4ff"));
    deleteSavedTheme(0);
    expect(readThemeLibrary(localStorage).map((t) => t.name)).toEqual(["Blu"]);
    expect(readStoredPreference(localStorage)).toBe("custom");
    deleteSavedTheme(0);
    expect(readThemeLibrary(localStorage)).toEqual([]);
    expect(readStoredPreference(localStorage)).toBe("system");
    expect(localStorage.getItem(CUSTOM_STORAGE_KEY)).toBeNull();
  });

  it("deletes the old unnamed theme too, and it does not come back", () => {
    saveCustomTheme(palette(named("x")));
    deleteSavedTheme(0);
    expect(readThemeLibrary(localStorage)).toEqual([]);
    expect(readStoredPreference(localStorage)).toBe("system");
  });
});
