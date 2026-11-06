import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { categoryPalette } from "@/lib/theme-palette";
import DashboardScreen from "../pages/dashboard/DashboardScreen";
import { createPortal } from "react-dom";
import { appLocale } from "../lib/app-locale";
import { describeError } from "../lib/error-catalog";
import { canSaveTextFile, saveTextFile } from "../lib/save-text-file";
import { fill } from "../lib/text-slots";
import { PRESETS } from "./theme-presets";
import {
  SEED_KEYS,
  checkSeeds,
  deriveTokens,
  fixAll,
  isHexColour,
  seedFamily,
  suggestFix,
  type Failure,
  type SeedKey,
  type Seeds,
  type TokenName,
} from "./theme-custom";
import {
  LIBRARY_MAX,
  READY_THEMES,
  TEMPLATE_THEMES,
  THEME_NAME_MAX,
  CUSTOM_THEME,
  activeSavedIndex,
  deleteCustomTheme,
  deleteSavedTheme,
  isStrictTheme,
  isTemplateTheme,
  readStoredCustom,
  readStoredPreference,
  readThemeLibrary,
  saveNamedTheme,
  type Theme,
} from "./theme";
import { THEME_EDITOR_TEXT } from "./theme-editor.i18n";
import { THEME_FILE_MAX_BYTES, readThemeFile, writeThemeFile } from "./theme-file";
import { PaletteIcon } from "./icons";
import { THEME_PREVIEW_DATA } from "./theme-preview-data";
import { THEME_TEXT } from "./theme.i18n";

type Props = {
  /** Called when the editor is left, saved or not. */
  onClose: () => void;
  /** Called after the palette was saved or deleted, so the menu can show it. */
  onChanged: () => void;
  /** The palette the editor starts from when nothing personal is saved: the one in force. */
  initialStart?: Theme;
};

const FOCUSABLE = 'button:not([disabled]), select, input:not([hidden]), textarea, summary, [tabindex]:not([tabindex="-1"])';

/** The colour the preview blinks with, where the colour under the pointer is used: no theme has it. */
const SIGNAL = "#ff2bd6";

/** The token a failure is about, and the seed the person changes to cure it (as the engine's own fix looks for it). */
const SEED_OF_TOKEN: Partial<Record<TokenName, SeedKey>> = {
  "--color-void": "background",
  "--color-deep": "panel",
  "--color-panel": "panel",
  "--color-card": "panel",
  "--color-row": "panel",
  "--color-border": "border",
  "--color-border-glow": "border",
  "--color-white": "text",
  "--color-bright": "text",
  "--color-base": "text",
  "--color-muted": "text",
  "--color-dim": "text",
  "--color-green": "accent",
  "--color-ready": "accent",
};
/** The seed row a failure is shown under: the foreground colour of the pair, else the surface. */
const rowOf = (failure: Failure): SeedKey => SEED_OF_TOKEN[failure.a] ?? SEED_OF_TOKEN[failure.b] ?? "panel";

/** The text of a file, with the reader every webview has (Blob.text is newer than some of them). */
const readAsText = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });

/** What a failed pair is told as: the two names and the numbers, never only a colour. */
function describe(failure: Failure, names: Record<string, string>, text: (typeof THEME_EDITOR_TEXT)["it"]) {
  const a = names[failure.a] ?? failure.a;
  const b = names[failure.b] ?? failure.b;
  if (failure.rule === "no-readable-text") return fill(text.noText, { a });
  const slots = { a, b, value: failure.value.toFixed(failure.kind === "wcag" ? 1 : 3), need: failure.need.toFixed(failure.kind === "wcag" ? 1 : 3) };
  return fill(failure.kind === "wcag" ? text.contrast : text.distinct, slots);
}

/**
 * What Tab reaches inside the dialog, in order: not the radio tiles off their turn (the arrows move among them), not
 * what sits in «Altro» while it is closed (its summary is reached), not the preview (inert).
 */
export function reachable(root: HTMLElement | null): HTMLElement[] {
  return [...(root?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((item) => {
    if (item.tabIndex < 0 || item.closest("[inert]")) return false;
    const details = item.closest("details");
    return !details || details.open || item.tagName === "SUMMARY";
  });
}

export default function ThemeEditor({ onClose, onChanged, initialStart = "dark" }: Props) {
  const locale = appLocale();
  const text = THEME_EDITOR_TEXT[locale];
  const themeText = THEME_TEXT[locale];
  const themeNames = themeText.names;
  const saved = useMemo(() => readStoredCustom(window.localStorage), []);
  // The personal palette counts as the starting point only while it is the theme in force: with a ready theme chosen,
  // the editor starts from that one, not from a palette saved some time ago.
  const inForce = useMemo(() => (readStoredPreference(window.localStorage) === CUSTOM_THEME ? saved : null), [saved]);
  const library = useMemo(() => readThemeLibrary(window.localStorage), []);
  // The saved theme being edited (its place in the list), or -1 for a new one: at first the one in force, then the
  // one picked among «I tuoi temi». Save replaces it, under the name in the field.
  const [editing, setEditing] = useState(() => activeSavedIndex(window.localStorage, library));
  const editingName = editing >= 0 ? library[editing]?.name : undefined;
  // How a saved theme is called in the menu: the one saved before names existed is «Personale».
  const customName = themeText.custom;
  const shownName = (entry: { name: string }) => entry.name || customName;
  const nameUsedElsewhere = (candidate: string, except = editing) =>
    library.some((entry, index) => index !== except && shownName(entry).trim().toLocaleLowerCase() === candidate.trim().toLocaleLowerCase());
  // A new theme is offered a name no other saved theme has: the template's own when it starts from one («Foresta»,
  // «Foresta 2»), «Personale» otherwise, so it never reads like one of the ready themes of the menu.
  const suggestName = (from: Theme) => {
    const base = isTemplateTheme(from) ? themeNames[from] : customName;
    for (let n = 1; ; n += 1) {
      const candidate = n === 1 ? base : `${base} ${n}`;
      if (!nameUsedElsewhere(candidate, -1)) return candidate;
    }
  };

  const [start, setStart] = useState<Theme>(inForce?.start ?? initialStart);
  const [seeds, setSeeds] = useState<Seeds>(inForce?.seeds ?? PRESETS[start].seeds);
  const [name, setName] = useState(() =>
    editingName === undefined ? suggestName(inForce?.start ?? initialStart) : editingName || customName,
  );
  const [nameTouched, setNameTouched] = useState(false);
  const [typed, setTyped] = useState<Seeds>(seeds);
  const [touched, setTouched] = useState<SeedKey | undefined>();
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  // The colour under the pointer (or the keyboard): the preview blinks it where it is used.
  const [pointed, setPointed] = useState<SeedKey | undefined>();
  const [blink, setBlink] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const issuesId = useId();
  const noteId = useId();

  const context = useMemo(() => ({ status: PRESETS[start].status, strict: isStrictTheme(start) }), [start]);
  const { tokens, failures } = useMemo(() => checkSeeds(seeds, context), [seeds, context]);
  const invalid = SEED_KEYS.filter((key) => !isHexColour(typed[key]));
  const blocked = failures.length > 0 || invalid.length > 0;

  const tokenNames: Record<string, string> = text.tokens;

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus();
  }, []);

  useEffect(() => {
    if (!pointed) return setBlink(false);
    setBlink(true);
    const timer = window.setInterval(() => setBlink((on) => !on), 650);
    return () => window.clearInterval(timer);
  }, [pointed]);

  // The preview: the theme being made, the pointed colour swapped for the signal while it blinks, and the chart
  // colours derived from its main colour as the Dashboard derives them.
  const previewTokens = useMemo(
    () => (pointed && blink ? deriveTokens({ ...seeds, [pointed]: SIGNAL }, context) : tokens),
    [pointed, blink, seeds, context, tokens],
  );
  const previewStyle = useMemo(() => {
    const cats = categoryPalette(previewTokens["--color-green"], previewTokens["--color-card"]) ?? [];
    return { ...previewTokens, ...Object.fromEntries(cats.map((colour, index) => [`--cat-${index}`, colour])) } as unknown as CSSProperties;
  }, [previewTokens]);

  // Colours to pick with one click, per seed: what the ready themes and the templates of the same base use.
  const suggestions = useMemo(() => {
    const family = seedFamily(seeds);
    const out = {} as Record<SeedKey, string[]>;
    for (const key of SEED_KEYS) {
      const seen = new Set<string>([seeds[key].toLowerCase()]);
      out[key] = [];
      for (const entry of [...READY_THEMES, ...TEMPLATE_THEMES]) {
        if (entry.family !== family) continue;
        const colour = PRESETS[entry.value].seeds[key].toLowerCase();
        if (seen.has(colour)) continue;
        seen.add(colour);
        out[key].push(colour);
        if (out[key].length === 5) break;
      }
    }
    return out;
  }, [seeds]);

  const adopt = (next: Seeds) => {
    setSeeds(next);
    setTyped(next);
  };

  const change = (key: SeedKey, value: string) => {
    // a colour being changed is shown as it is: the blink stops until the pointer comes back
    setPointed(undefined);
    setTyped((current) => ({ ...current, [key]: value }));
    setTouched(key);
    setNote("");
    if (isHexColour(value)) setSeeds((current) => ({ ...current, [key]: value.toLowerCase() }));
  };

  const chooseStart = (next: Theme) => {
    setStart(next);
    // starting again from a ready theme or a template makes a new one: the saved theme being edited is left alone
    setEditing(-1);
    if (!nameTouched) setName(suggestName(next));
    adopt(PRESETS[next].seeds);
    setTouched(undefined);
    setNote("");
  };

  const chooseSaved = (index: number) => {
    const entry = library[index];
    setEditing(index);
    setStart(entry.start);
    setName(shownName(entry));
    setNameTouched(false);
    adopt(entry.seeds);
    setTouched(undefined);
    setNote("");
  };

  const resetToStart = () => {
    adopt(editing >= 0 && library[editing] ? library[editing].seeds : PRESETS[start].seeds);
    setTouched(undefined);
    setNote("");
  };

  const told = (before: Seeds, after: Seeds) => {
    const key = SEED_KEYS.find((k) => before[k] !== after[k]);
    return key ? fill(text.fixed, { seed: text.seeds[key], before: before[key], after: after[key] }) : "";
  };

  const fixOne = (failure: Failure) => {
    const fixed = suggestFix(seeds, context, failure, touched);
    if (!fixed) return setNote(text.nothingToFix);
    setNote(told(seeds, fixed));
    adopt(fixed);
  };

  const fixEverything = () => {
    const out = fixAll(seeds, context, touched);
    if (out.seeds === seeds) return setNote(text.nothingToFix);
    setNote(SEED_KEYS.filter((k) => seeds[k] !== out.seeds[k]).map((k) => fill(text.fixed, { seed: text.seeds[k], before: seeds[k], after: out.seeds[k] })).join(" · "));
    adopt(out.seeds);
  };

  // A theme from outside is only ever a draft: it lands in the editor, where the guard lists what is wrong and
  // nothing is saved until Save passes.
  const importText = (raw: string): boolean => {
    const result = readThemeFile(raw);
    if (!result.ok) {
      setNote(
        result.reason === "too_big"
          ? text.importTooBig
          : result.reason === "not_json"
            ? text.importNotJson
            : result.reason === "newer"
              ? text.importNewer
              : fill(text.importInvalid, { field: result.field }),
      );
      return false;
    }
    // an imported theme is a new one, under the name it came with (unless the person already wrote one)
    setStart(result.file.start);
    setEditing(-1);
    if (!nameTouched) setName(nameUsedElsewhere(result.file.name, -1) ? suggestName(result.file.start) : result.file.name);
    adopt(result.file.seeds);
    setTouched(undefined);
    setNote(fill(text.imported, { name: result.file.name }));
    return true;
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    // the size of the file object is asked before its content is read
    if (file.size > THEME_FILE_MAX_BYTES) return setNote(text.importTooBig);
    let raw: string;
    try {
      raw = await readAsText(file);
    } catch {
      return setNote(text.importNotJson);
    }
    importText(raw);
  };

  const copyTheme = async () => {
    if (blocked) return setNote(text.exportBlocked);
    const out = writeThemeFile(text.title, start, seeds);
    try {
      await navigator.clipboard.writeText(out);
      setNote(text.copied);
    } catch {
      // no clipboard here: the text goes in the box, to be copied by hand
      setPasteText(out);
      setPasteOpen(true);
      setNote(text.copyFailed);
    }
  };

  const saveAsFile = async () => {
    if (blocked) return setNote(text.exportBlocked);
    const result = await saveTextFile("jht-theme.json", writeThemeFile(text.title, start, seeds));
    if (result.outcome === "saved") return setNote(text.fileSaved);
    if (result.outcome === "cancelled") return setNote("");
    const failure = describeError(result.code, { locale });
    setNote(`${failure.text} ${failure.action}`);
  };

  const save = () => {
    if (blocked) return;
    if (name.trim().length === 0) return setNote(text.nameMissing);
    if (nameUsedElsewhere(name)) return setNote(fill(text.nameTaken, { name: name.trim() }));
    const result = saveNamedTheme({ v: 1, start, family: seedFamily(seeds), seeds, vars: tokens, name }, editingName);
    if (result === "taken") return setNote(fill(text.nameTaken, { name: name.trim() }));
    if (result === "full") return setNote(fill(text.libraryFull, { max: String(LIBRARY_MAX) }));
    if (result !== "saved") return setNote(text.saveBlocked);
    onChanged();
    onClose();
  };

  const remove = () => {
    if (editing >= 0) deleteSavedTheme(editing);
    else deleteCustomTheme();
    onChanged();
    onClose();
  };

  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const items = reachable(dialogRef.current);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // The tiles to start from move with the arrows, like any group of radio buttons.
  const tileKeys = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return;
    const tiles = [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])];
    const index = tiles.indexOf(event.currentTarget);
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    event.preventDefault();
    tiles[(index + step + tiles.length) % tiles.length]?.focus();
  };

  const tile = (key: string, label: string, swatch: Seeds, checked: boolean, pick: () => void) => (
    <button
      key={key}
      type="button"
      role="radio"
      aria-checked={checked}
      tabIndex={checked ? 0 : -1}
      className="theme-editor__tile"
      onClick={pick}
      onKeyDown={tileKeys}
    >
      <span className="theme-editor__tile-swatch" style={{ background: swatch.background, borderColor: swatch.border }} aria-hidden="true">
        <i style={{ background: swatch.panel }} />
        <i style={{ background: swatch.accent }} />
      </span>
      {label}
    </button>
  );

  const failuresOf = (key: SeedKey) => failures.filter((failure) => rowOf(failure) === key);

  return createPortal(
    <div className="theme-editor__backdrop" onKeyDown={keys}>
      <div ref={dialogRef} className="theme-editor" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="theme-editor__top">
          <h2 id={titleId} className="theme-editor__title">
            <PaletteIcon size={16} />
            {text.title}
          </h2>
        </header>

        <div className="theme-editor__body">
          <div className="theme-editor__controls">
            <section aria-labelledby={`${titleId}-start`}>
              <h3 id={`${titleId}-start`} className="theme-editor__step">1 · {text.startFrom}</h3>
              <div role="radiogroup" aria-label={text.startFrom} className="theme-editor__tiles">
                <span className="theme-editor__group">{text.ready}</span>
                {READY_THEMES.map((entry) =>
                  tile(entry.value, themeNames[entry.value], PRESETS[entry.value].seeds, editing < 0 && start === entry.value, () => chooseStart(entry.value)),
                )}
                <span className="theme-editor__group">{text.templates}</span>
                {TEMPLATE_THEMES.map((entry) =>
                  tile(entry.value, themeNames[entry.value], PRESETS[entry.value].seeds, editing < 0 && start === entry.value, () => chooseStart(entry.value)),
                )}
                {library.length > 0 && <span className="theme-editor__group">{themeText.groupMine}</span>}
                {library.map((entry, index) => tile(`saved-${index}`, shownName(entry), entry.seeds, editing === index, () => chooseSaved(index)))}
              </div>
            </section>

            <section aria-labelledby={`${titleId}-colours`}>
              <h3 id={`${titleId}-colours`} className="theme-editor__step">2 · {text.colours}</h3>
              {/* what fails, for a screen reader, in one polite list; on screen each line sits under its colour */}
              <div id={issuesId} aria-live="polite" className="sr-only">
                {failures.length === 0 ? (
                  <p>{text.allReadable}</p>
                ) : (
                  <ul>
                    {failures.map((failure) => (
                      <li key={`${failure.rule}|${failure.a}|${failure.b}`}>{describe(failure, tokenNames, text)}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="theme-editor__seeds">
                {SEED_KEYS.map((key) => (
                  <div
                    className="theme-editor__seed"
                    key={key}
                    data-pointed={pointed === key || undefined}
                    onMouseEnter={() => setPointed(key)}
                    onMouseLeave={() => setPointed(undefined)}
                  >
                    <input
                      type="color"
                      aria-label={text.seeds[key]}
                      value={isHexColour(typed[key]) ? typed[key].toLowerCase() : seeds[key]}
                      onChange={(event) => change(key, event.target.value)}
                    />
                    <span className="theme-editor__seed-name">{text.seeds[key]}</span>
                    <input
                      type="text"
                      spellCheck={false}
                      maxLength={7}
                      aria-label={fill(text.colour, { name: text.seeds[key] })}
                      aria-invalid={!isHexColour(typed[key])}
                      value={typed[key]}
                      onChange={(event) => change(key, event.target.value)}
                    />
                    <span className="theme-editor__suggestions">
                      {suggestions[key].map((colour) => (
                        <button
                          key={colour}
                          type="button"
                          className="theme-editor__suggestion"
                          style={{ background: colour }}
                          aria-label={`${text.seeds[key]}: ${colour}`}
                          title={colour}
                          onClick={() => change(key, colour)}
                        />
                      ))}
                    </span>
                    {/* one line per colour, however many pairs fail: the first, how many more, one fix */}
                    {failuresOf(key).slice(0, 1).map((failure) => (
                      <p className="theme-editor__issue" key={`${failure.rule}|${failure.a}|${failure.b}`}>
                        <span aria-hidden="true">
                          {describe(failure, tokenNames, text)}
                          {failuresOf(key).length > 1 && ` (+${failuresOf(key).length - 1})`}
                        </span>
                        <button type="button" onClick={() => fixOne(failure)}>
                          {fill(text.fix, { name: tokenNames[failure.a as TokenName] ?? failure.a })}
                        </button>
                      </p>
                    ))}
                  </div>
                ))}
              </div>
              {failures.length === 0 && <p className="theme-editor__ok" aria-hidden="true">{text.allReadable}</p>}
              {failures.length > 1 && (
                <button type="button" onClick={fixEverything}>
                  {text.fixAll}
                </button>
              )}
            </section>

            <section aria-labelledby={`${titleId}-save`}>
              <h3 id={`${titleId}-save`} className="theme-editor__step">3 · {text.nameAndSave}</h3>
              <label className="theme-editor__field theme-editor__name">
                <span>{text.name}</span>
                <input
                  type="text"
                  value={name}
                  maxLength={THEME_NAME_MAX}
                  spellCheck={false}
                  onChange={(event) => {
                    setName(event.target.value);
                    setNameTouched(true);
                    setNote("");
                  }}
                />
              </label>
              <p id={noteId} aria-live="polite" className="theme-editor__note">
                {note}
              </p>
              <div className="theme-editor__actions">
                <button
                  type="button"
                  className="theme-editor__save"
                  aria-disabled={blocked}
                  aria-describedby={blocked ? issuesId : undefined}
                  onClick={save}
                >
                  {text.save}
                </button>
                <button type="button" onClick={onClose}>
                  {text.cancel}
                </button>
              </div>
            </section>

            <details className="theme-editor__more">
              <summary>{text.more}</summary>
              <div className="theme-editor__actions" role="group" aria-label={text.title}>
                <button type="button" onClick={resetToStart}>
                  {text.resetToStart}
                </button>
                <button type="button" aria-disabled={blocked} onClick={copyTheme}>
                  {text.copy}
                </button>
                {canSaveTextFile() && (
                  <button type="button" aria-disabled={blocked} onClick={saveAsFile}>
                    {text.saveFile}
                  </button>
                )}
                <button type="button" onClick={() => fileInput.current?.click()}>
                  {text.importFile}
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  hidden
                  accept=".json,application/json"
                  data-testid="theme-file-input"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    void importFile(file);
                  }}
                />
                <button type="button" aria-expanded={pasteOpen} onClick={() => setPasteOpen((open) => !open)}>
                  {text.pasteOpen}
                </button>
                {saved && !asking && (
                  <button type="button" onClick={() => setAsking(true)}>
                    {text.remove}
                  </button>
                )}
              </div>
              {pasteOpen && (
                <div className="theme-editor__paste">
                  <label>
                    <span>{text.pasteLabel}</span>
                    <textarea rows={6} spellCheck={false} value={pasteText} onChange={(event) => setPasteText(event.target.value)} />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      if (importText(pasteText)) setPasteOpen(false);
                    }}
                  >
                    {text.pasteApply}
                  </button>
                </div>
              )}
              {asking && (
                <div role="alertdialog" aria-label={text.remove} className="theme-editor__ask">
                  <p>{text.removeAsk}</p>
                  <button type="button" onClick={remove}>
                    {text.removeYes}
                  </button>
                  <button type="button" onClick={() => setAsking(false)}>
                    {text.removeNo}
                  </button>
                </div>
              )}
            </details>
          </div>

          <section className="theme-editor__preview" aria-label={text.preview} data-testid="theme-preview" style={previewStyle}>
            <p className="theme-editor__preview-hint">{text.previewHint}</p>
            {/* the real Dashboard, drawn with the theme being made; only to look at */}
            <div className="theme-editor__dashboard">
              <div aria-hidden="true" inert>
                <DashboardScreen data={THEME_PREVIEW_DATA} locale={locale} />
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
