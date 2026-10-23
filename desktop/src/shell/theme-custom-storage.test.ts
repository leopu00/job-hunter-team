import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { STATUS_TOKENS, TOKEN_NAMES, checkSeeds, type Seeds, type StatusColors } from "./theme-custom";
import {
  CUSTOM_STORAGE_KEY,
  THEMES,
  THEME_STORAGE_KEY,
  applyTheme,
  initializeTheme,
  parseCustomTheme,
  persistTheme,
  readStoredCustom,
  readStoredPreference,
  saveCustomTheme,
  type CustomTheme,
} from "./theme";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n?/g, "\n");
const css = read("../dashboard/dashboard.css");
const html = read("../../dashboard.html");
const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)![1];

const darkBlock = css.match(/:root\[data-jht-theme="dark"\]\s*\{([\s\S]*?)\}/)![1];
const darkStatus = Object.fromEntries(
  STATUS_TOKENS.map((name) => [name, darkBlock.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))![1]]),
) as StatusColors;

const SEEDS: Seeds = { background: "#060608", panel: "#0c0c10", text: "#a8a8b8", border: "#2a2a3a", accent: "#22c55e" };
function make(seeds: Seeds = SEEDS): CustomTheme {
  const { tokens, failures } = checkSeeds(seeds, { status: darkStatus, strict: false });
  expect(failures).toEqual([]);
  return { v: 1, start: "dark", family: "dark", seeds, vars: tokens };
}
const GOOD = make();
const text = (custom: unknown) => JSON.stringify(custom);
const mutate = (change: (copy: any) => void) => {
  const copy = JSON.parse(JSON.stringify(GOOD));
  change(copy);
  return JSON.stringify(copy);
};

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  delete document.documentElement.dataset.jhtTheme;
  delete document.documentElement.dataset.theme;
});

describe("the person's own palette is read back only when every part is exactly right", () => {
  it("reads what was saved, and nothing is added to the palette table", () => {
    expect(parseCustomTheme(text(GOOD))).toEqual(GOOD);
    expect(THEMES.map((t) => t.value as string)).not.toContain("custom");
  });

  const HOSTILE: [string, string | null][] = [
    ["not JSON", "{"],
    ["nothing", null],
    ["a list", "[]"],
    ["an extra key", mutate((c) => (c.extra = 1))],
    ["a missing key", mutate((c) => delete c.family)],
    ["a __proto__ key", text(GOOD).replace(/^\{/, '{"__proto__":{"x":1},')],
    ["version 2", mutate((c) => (c.v = 2))],
    ["an unknown start palette", mutate((c) => (c.start = "ultraviolet"))],
    ["a base that is not the panel's", mutate((c) => (c.family = "light"))],
    ["a base that is not a base", mutate((c) => (c.family = "constructor"))],
    ["a colour name", mutate((c) => (c.vars["--color-green"] = "red"))],
    ["a url()", mutate((c) => (c.vars["--color-green"] = "url(https://x.test/a)"))],
    ["a short colour", mutate((c) => (c.vars["--color-panel"] = "#fff"))],
    ["a style closer", mutate((c) => (c.vars["--color-panel"] = "#000000;} </style>"))],
    ["a variable the list does not have", mutate((c) => (c.vars["--color-evil"] = "#000000"))],
    ["a missing variable", mutate((c) => delete c.vars["--color-card"])],
    ["a number as a colour", mutate((c) => (c.vars["--color-card"] = 5))],
    ["a grid veil with a channel over 255", mutate((c) => (c.vars["--color-grid"] = "rgba(999, 1, 1, 0.04)"))],
    ["a grid veil that is a colour name", mutate((c) => (c.vars["--color-grid"] = "red"))],
    ["a seed that is not #rrggbb", mutate((c) => (c.seeds.accent = "blue"))],
    ["a missing seed", mutate((c) => delete c.seeds.border)],
    ["text the guard refuses (muted too dim on the card)", mutate((c) => (c.vars["--color-muted"] = "#303040"))],
  ];
  it.each(HOSTILE)("ignores %s", (_name, raw) => {
    expect(parseCustomTheme(raw)).toBeNull();
    localStorage.setItem(THEME_STORAGE_KEY, "custom");
    if (raw !== null) localStorage.setItem(CUSTOM_STORAGE_KEY, raw);
    expect(readStoredCustom(localStorage)).toBeNull();
    expect(readStoredPreference(localStorage)).toBe("system");
  });
});

describe("saving and dressing the page with the person's palette", () => {
  it("keeps it, chooses it, and puts the 21 variables, the base and the choice on the page", () => {
    expect(saveCustomTheme(GOOD)).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("custom");
    expect(readStoredCustom(localStorage)).toEqual(GOOD);
    const root = document.documentElement;
    expect(root.dataset.jhtTheme).toBe("custom");
    expect(root.dataset.theme).toBe("dark");
    for (const name of TOKEN_NAMES) expect(root.style.getPropertyValue(name), name).toBe(GOOD.vars[name]);
  });

  it("refuses a palette the guard would refuse: nothing written, nothing changed", () => {
    const broken = make();
    broken.vars["--color-muted"] = "#303040";
    expect(saveCustomTheme(broken)).toBe(false);
    expect(localStorage.getItem(CUSTOM_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.dataset.jhtTheme).toBeUndefined();
  });

  it("comes back after a restart, with the base the panel gives", () => {
    saveCustomTheme(GOOD);
    document.documentElement.removeAttribute("style");
    document.documentElement.removeAttribute("data-jht-theme");
    expect(initializeTheme(localStorage)).toBe("custom");
    expect(document.documentElement.dataset.jhtTheme).toBe("custom");
    expect(document.documentElement.style.getPropertyValue("--color-panel")).toBe(GOOD.vars["--color-panel"]);
  });

  it("lives with «follow the system» and the ready palettes: choosing another one removes every own variable", () => {
    saveCustomTheme(GOOD);
    persistTheme("paper");
    expect(document.documentElement.dataset.jhtTheme).toBe("paper");
    expect(document.documentElement.dataset.theme).toBe("light");
    for (const name of TOKEN_NAMES) expect(document.documentElement.style.getPropertyValue(name), name).toBe("");
    persistTheme("system");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    // the own palette stays kept, to be chosen again
    expect(readStoredCustom(localStorage)).toEqual(GOOD);
    expect(persistTheme("custom")).toBe("custom");
    expect(document.documentElement.dataset.jhtTheme).toBe("custom");
  });

  it("chooses the system's palette when «custom» is asked and none valid is kept", () => {
    expect(persistTheme("custom")).not.toBe("custom");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    localStorage.setItem(THEME_STORAGE_KEY, "custom");
    applyTheme("custom");
    expect(["dark", "light"]).toContain(document.documentElement.dataset.jhtTheme);
    expect(document.documentElement.style.getPropertyValue("--color-panel")).toBe("");
  });

  it("still dresses the page when the storage refuses to write", () => {
    const refusing = { getItem: () => null, setItem: () => { throw new Error("full"); } };
    expect(saveCustomTheme(GOOD, refusing)).toBe(true);
    expect(document.documentElement.dataset.jhtTheme).toBe("custom");
  });

  it("selects text in the accent colour, with the button label's colour on it, only on the own palette", () => {
    const rule = css.match(/:root\[data-jht-theme="custom"\] ::selection\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/background:\s*var\(--color-green\)/);
    expect(rule![1]).toMatch(/color:\s*var\(--color-void\)/);
  });
});

describe("the script that dresses the page before it is drawn knows the own palette", () => {
  function run(items: Record<string, string | null> | "throws") {
    const dataset: Record<string, string> = {};
    const set: Record<string, string> = {};
    const storage = {
      getItem: (key: string) => {
        if (items === "throws") throw new Error("blocked");
        return items[key] ?? null;
      },
    };
    const win = { matchMedia: () => ({ matches: false }) };
    new Function("localStorage", "window", "document", script)(storage, win, {
      documentElement: { dataset, style: { setProperty: (n: string, v: string) => (set[n] = v) } },
    });
    return { dataset, set };
  }
  const chosen = (raw: string | null) => run({ "jht-desktop-theme": "custom", "jht-desktop-theme-custom": raw });

  it("lists exactly the variables the engine makes", () => {
    const listed = [...script.match(/const names = \[([^\]]*)\]/)![1].matchAll(/"(--[\w-]+)"/g)].map((m) => m[1]);
    expect([...listed].sort()).toEqual([...TOKEN_NAMES].sort());
  });

  it("puts the saved variables and the saved base on the page, and nothing else", () => {
    const { dataset, set } = chosen(text(GOOD));
    expect(dataset).toEqual({ jhtTheme: "custom", theme: "dark" });
    expect(set).toEqual(GOOD.vars);
  });

  it("with a light base saved, dresses the light base", () => {
    const paper = make({ background: "#e8e8f0", panel: "#f4f4f8", text: "#1c1c28", border: "#b0b0c4", accent: "#1d6b3a" });
    const light = JSON.parse(JSON.stringify({ ...paper, family: "light" }));
    expect(chosen(text(light)).dataset.theme).toBe("light");
  });

  const HOSTILE: [string, string | null][] = [
    ["a corrupt text", "{"],
    ["nothing kept", null],
    ["a colour name", mutate((c) => (c.vars["--color-green"] = "red"))],
    ["a url()", mutate((c) => (c.vars["--color-green"] = "url(https://x.test/a)"))],
    ["a short colour", mutate((c) => (c.vars["--color-panel"] = "#fff"))],
    ["a style closer", mutate((c) => (c.vars["--color-panel"] = "#000000;} </style>"))],
    ["a missing variable", mutate((c) => delete c.vars["--color-card"])],
    ["an extra variable", mutate((c) => (c.vars["--color-evil"] = "#000000"))],
    ["a grid veil over 255", mutate((c) => (c.vars["--color-grid"] = "rgba(999, 1, 1, 0.04)"))],
    ["a base that is not a base", mutate((c) => (c.family = "x\"><script"))],
    ["version 2", mutate((c) => (c.v = 2))],
    ["no vars at all", mutate((c) => delete c.vars)],
    ["vars that are null", mutate((c) => (c.vars = null))],
  ];
  it.each(HOSTILE)("ignores %s: the system's palette, not one own variable", (_name, raw) => {
    const { dataset, set } = chosen(raw);
    expect(set).toEqual({});
    expect(dataset).toEqual({ jhtTheme: "dark", theme: "dark" });
  });

  it("does not read the own palette unless it is the choice, and survives a blocked storage", () => {
    const { dataset, set } = run({ "jht-desktop-theme": "paper", "jht-desktop-theme-custom": text(GOOD) });
    expect(set).toEqual({});
    expect(dataset).toEqual({ jhtTheme: "paper", theme: "light" });
    expect(run("throws").dataset).toEqual({ jhtTheme: "dark", theme: "dark" });
  });
});
