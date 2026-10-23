// @vitest-environment node
import { describe, expect, it } from "vitest";
import { THEMES } from "./theme";
import { SEED_KEYS, type Seeds } from "./theme-custom";
import { THEME_FILE_MAX_BYTES, readThemeFile, writeThemeFile } from "./theme-file";

const SEEDS: Seeds = { background: "#0b1020", panel: "#11172b", text: "#c8d0ea", border: "#2a3558", accent: "#7cc4ff" };
const GOOD = { jhtTheme: 1, name: "Il mio tema", start: "ocean", seeds: SEEDS };
const text = (value: unknown) => JSON.stringify(value);
const change = (edit: (copy: any) => void) => {
  const copy = JSON.parse(JSON.stringify(GOOD));
  edit(copy);
  return JSON.stringify(copy);
};

describe("the file a personal theme travels in", () => {
  it("reads what it writes, byte for byte, for every palette it can start from", () => {
    for (const { value } of THEMES) {
      const written = writeThemeFile("Il mio tema", value, SEEDS);
      expect(written.length).toBeLessThan(THEME_FILE_MAX_BYTES);
      const read = readThemeFile(written);
      expect(read).toEqual({ ok: true, file: { jhtTheme: 1, name: "Il mio tema", start: value, seeds: SEEDS } });
      expect(writeThemeFile("Il mio tema", value, SEEDS)).toBe(written);
    }
  });

  it("writes the colours in lower case and reads them in either case", () => {
    expect(writeThemeFile("x", "dark", { ...SEEDS, accent: "#7CC4FF" })).toContain('"accent": "#7cc4ff"');
    const read = readThemeFile(change((c) => (c.seeds.accent = "#7CC4FF")));
    expect(read.ok && read.file.seeds.accent).toBe("#7cc4ff");
  });

  const REFUSED: [string, string, string][] = [
    ["not JSON", "{", "not_json"],
    ["nothing", "", "not_json"],
    ["a list", "[]", "invalid"],
    ["a number", "7", "invalid"],
    ["a null", "null", "invalid"],
    ["a version from the future", change((c) => (c.jhtTheme = 2)), "newer"],
    ["a version that is not a number", change((c) => (c.jhtTheme = "1")), "invalid"],
    ["version 0", change((c) => (c.jhtTheme = 0)), "invalid"],
    ["an extra key", change((c) => (c.extra = 1)), "invalid"],
    ["a look the file does not have yet", change((c) => (c.look = { zoom: 1.15 })), "invalid"],
    ["a missing key", change((c) => delete c.name), "invalid"],
    ["a __proto__ key", text(GOOD).replace(/^\{/, '{"__proto__":{"jhtTheme":1},'), "invalid"],
    ["a constructor key", text(GOOD).replace(/^\{/, '{"constructor":{},'), "invalid"],
    ["an empty name", change((c) => (c.name = "")), "invalid"],
    ["a name of 41 characters", change((c) => (c.name = "a".repeat(41))), "invalid"],
    ["a name with markup", change((c) => (c.name = "<b>x</b>")), "invalid"],
    ["a name with a style closer", change((c) => (c.name = "x;} </style>")), "invalid"],
    ["a name with a control character", change((c) => (c.name = "a\u0007b")), "invalid"],
    ["a name with a bidi override", change((c) => (c.name = "a‮b")), "invalid"],
    ["a name with a zero-width joiner", change((c) => (c.name = "a‍b")), "invalid"],
    ["a name that is not a string", change((c) => (c.name = 5)), "invalid"],
    ["an unknown palette", change((c) => (c.start = "ultraviolet")), "invalid"],
    ["a palette called constructor", change((c) => (c.start = "constructor")), "invalid"],
    ["a seed list with an extra seed", change((c) => (c.seeds.glow = "#000000")), "invalid"],
    ["a missing seed", change((c) => delete c.seeds.accent), "invalid"],
    ["a colour name", change((c) => (c.seeds.accent = "red")), "invalid"],
    ["a three-digit colour", change((c) => (c.seeds.accent = "#fff")), "invalid"],
    ["an eight-digit colour", change((c) => (c.seeds.accent = "#7cc4ff80")), "invalid"],
    ["a var()", change((c) => (c.seeds.accent = "var(--color-red)")), "invalid"],
    ["a url()", change((c) => (c.seeds.accent = "url(https://x.test/a)")), "invalid"],
    ["a colour with a closer", change((c) => (c.seeds.accent = "#7cc4ff;}")), "invalid"],
    ["a colour with a space", change((c) => (c.seeds.accent = " #7cc4ff")), "invalid"],
    ["a number as a colour", change((c) => (c.seeds.accent = 1e999)), "invalid"],
    ["seeds that are a list", change((c) => (c.seeds = [])), "invalid"],
  ];
  it.each(REFUSED)("refuses %s", (_name, raw, reason) => {
    const read = readThemeFile(raw);
    expect(read.ok).toBe(false);
    expect(read.ok === false && read.reason).toBe(reason);
  });

  it("names the field to blame, from its own list and never from the file's text", () => {
    const read = readThemeFile(change((c) => (c.seeds.accent = "<script>alert(1)</script>")));
    expect(read).toEqual({ ok: false, reason: "invalid", field: "seeds.accent" });
  });

  it("refuses a text over 4 KiB by its size in bytes, even when it is a good theme padded with spaces", () => {
    expect(THEME_FILE_MAX_BYTES).toBe(4096);
    expect(readThemeFile(text(GOOD) + " ".repeat(4096))).toEqual({ ok: false, reason: "too_big" });
    // 4096 bytes exactly is allowed; one more is not (multi-byte characters count by bytes)
    const padded = text(GOOD) + " ".repeat(4096 - text(GOOD).length);
    expect(readThemeFile(padded).ok).toBe(true);
    expect(readThemeFile(padded + " ")).toEqual({ ok: false, reason: "too_big" });
    expect(readThemeFile(change((c) => (c.name = "é".repeat(40))) + " ".repeat(4096 - 150)).ok).toBe(false);
  });

  it("builds a new object: nothing of the file's own prototype or extra properties comes through", () => {
    const read = readThemeFile(text(GOOD));
    expect(read.ok && Object.keys(read.file).sort()).toEqual(["jhtTheme", "name", "seeds", "start"]);
    expect(read.ok && Object.keys(read.file.seeds).sort()).toEqual([...SEED_KEYS].sort());
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("normalises a name to NFC and accepts the letters of the app's seven languages", () => {
    const decomposed = "Café".normalize("NFD");
    const read = readThemeFile(change((c) => (c.name = decomposed)));
    expect(read.ok && read.file.name).toBe("Café");
    for (const name of ["Eigenes Design", "Thème personnel", "Saját téma", "Tema pessoal", "Mi tema (v2)", "O'Brien-style_1.0"]) {
      expect(readThemeFile(change((c) => (c.name = name))).ok, name).toBe(true);
    }
  });

  it("answers anything at all with a result and never throws: 300 random texts", () => {
    let seed = 11;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const alphabet = ['{', '}', '"', ':', ',', '#', 'a', 'f', '0', '9', ' ', '\n', 'jhtTheme', 'seeds', 'accent', 'name', 'start', '1', '[', ']', 'null', '‮', '\\'];
    for (let i = 0; i < 300; i += 1) {
      let raw = "";
      for (let n = rnd() * 60; n > 0; n -= 1) raw += alphabet[Math.floor(rnd() * alphabet.length)];
      const read = readThemeFile(raw);
      if (read.ok) {
        for (const key of SEED_KEYS) expect(read.file.seeds[key]).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
    // every field of a random but well-shaped file comes out as #rrggbb or is refused
    for (let i = 0; i < 200; i += 1) {
      const junk = ["red", "#fff", "#GGGGGG", "url(x)", "#abcdef", "#ABCDEF", "", " #abcdef", "#abcdef\n"];
      const file = { ...GOOD, seeds: Object.fromEntries(SEED_KEYS.map((k) => [k, junk[Math.floor(rnd() * junk.length)]])) };
      const read = readThemeFile(JSON.stringify(file));
      if (read.ok) for (const key of SEED_KEYS) expect(read.file.seeds[key]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
