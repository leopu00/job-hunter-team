import { THEMES, type Theme } from "./theme";
import { SEED_KEYS, isHexColour, type Seeds } from "./theme-custom";

/**
 * The file a personal theme is exchanged in: five colours, the palette it started from and a name. It carries
 * no CSS, no variable names and no value that is not a #rrggbb: everything the page wears is made by the app's
 * own code from these (theme-custom.ts), so a file cannot put anything on the page that the app would not make.
 */
export const THEME_FILE_VERSION = 1;
/** The largest file, in bytes, read or written. */
export const THEME_FILE_MAX_BYTES = 4096;

export type ThemeFile = { jhtTheme: 1; name: string; start: Theme; seeds: Seeds };

/** Why a text is not a theme: a stable word per cause, and the field when one is to blame (never text of the file). */
export type ThemeFileProblem =
  | { reason: "too_big" }
  | { reason: "not_json" }
  | { reason: "newer" }
  | { reason: "invalid"; field: string };

export type ThemeFileResult = { ok: true; file: ThemeFile } | ({ ok: false } & ThemeFileProblem);

const NAME = /^[\p{L}\p{N} \-_.'()]{1,40}$/u;
const KNOWN_KEYS = ["jhtTheme", "name", "start", "seeds"] as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasExactlyKeys = (value: object, keys: readonly string[]) => {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
};

/** The text of a theme to hand over: a fixed shape, two spaces, nothing taken from anywhere else. */
export function writeThemeFile(name: string, start: Theme, seeds: Seeds): string {
  const file: ThemeFile = {
    jhtTheme: THEME_FILE_VERSION,
    name,
    start,
    seeds: Object.fromEntries(SEED_KEYS.map((key) => [key, seeds[key].toLowerCase()])) as Seeds,
  };
  return JSON.stringify(file, null, 2);
}

/**
 * A text read as a theme file, strictly: the size twice (the caller's, from the file object, before reading; and
 * here, on the text), JSON, an object with exactly the known keys, the version, a name of letters, digits and
 * a few signs, a palette of the table, five #rrggbb colours. A NEW object is built from what was checked. Nothing
 * is repaired and nothing is ignored: the first thing wrong is the answer. Whether the colours are READABLE is not
 * asked here: the editor shows that with the same list as for any palette, and nothing is saved before it passes.
 */
export function readThemeFile(text: string): ThemeFileResult {
  if (new TextEncoder().encode(text).length > THEME_FILE_MAX_BYTES) return { ok: false, reason: "too_big" };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not_json" };
  }
  if (!isPlainObject(value)) return { ok: false, reason: "invalid", field: "file" };
  const version = value.jhtTheme;
  if (typeof version === "number" && Number.isFinite(version) && version > THEME_FILE_VERSION) return { ok: false, reason: "newer" };
  if (version !== THEME_FILE_VERSION) return { ok: false, reason: "invalid", field: "jhtTheme" };
  if (!hasExactlyKeys(value, KNOWN_KEYS)) return { ok: false, reason: "invalid", field: "keys" };
  const { name, start, seeds } = value;
  const normalised = typeof name === "string" ? name.normalize("NFC") : "";
  if (!NAME.test(normalised)) return { ok: false, reason: "invalid", field: "name" };
  const known = THEMES.find((theme) => theme.value === start);
  if (!known) return { ok: false, reason: "invalid", field: "start" };
  if (!isPlainObject(seeds) || !hasExactlyKeys(seeds, SEED_KEYS)) return { ok: false, reason: "invalid", field: "seeds" };
  const colours = {} as Seeds;
  for (const key of SEED_KEYS) {
    const colour = seeds[key];
    if (!isHexColour(colour)) return { ok: false, reason: "invalid", field: `seeds.${key}` };
    colours[key] = colour.toLowerCase();
  }
  return { ok: true, file: { jhtTheme: THEME_FILE_VERSION, name: normalised, start: known.value, seeds: colours } };
}
