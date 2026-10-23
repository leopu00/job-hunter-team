import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { appLocale } from "../lib/app-locale";
import { fill } from "../lib/text-slots";
import { PRESETS } from "./theme-presets";
import {
  SEED_KEYS,
  checkSeeds,
  fixAll,
  isHexColour,
  seedFamily,
  suggestFix,
  type Failure,
  type SeedKey,
  type Seeds,
  type TokenName,
} from "./theme-custom";
import { THEMES, deleteCustomTheme, readStoredCustom, saveCustomTheme, type Theme } from "./theme";
import { THEME_EDITOR_TEXT } from "./theme-editor.i18n";
import { THEME_TEXT } from "./theme.i18n";

type Props = {
  /** Called when the editor is left, saved or not. */
  onClose: () => void;
  /** Called after the palette was saved or deleted, so the menu can show it. */
  onChanged: () => void;
  /** The palette the editor starts from when nothing personal is saved: the one in force. */
  initialStart?: Theme;
};

const FOCUSABLE = 'button:not([disabled]), select, input, [tabindex]:not([tabindex="-1"])';

/** What a failed pair is told as: the two names and the numbers, never only a colour. */
function describe(failure: Failure, names: Record<string, string>, text: (typeof THEME_EDITOR_TEXT)["it"]) {
  const a = names[failure.a] ?? failure.a;
  const b = names[failure.b] ?? failure.b;
  if (failure.rule === "no-readable-text") return fill(text.noText, { a });
  const slots = { a, b, value: failure.value.toFixed(failure.kind === "wcag" ? 1 : 3), need: failure.need.toFixed(failure.kind === "wcag" ? 1 : 3) };
  return fill(failure.kind === "wcag" ? text.contrast : text.distinct, slots);
}

export default function ThemeEditor({ onClose, onChanged, initialStart = "dark" }: Props) {
  const text = THEME_EDITOR_TEXT[appLocale()];
  const themeNames = THEME_TEXT[appLocale()].names;
  const saved = useMemo(() => readStoredCustom(window.localStorage), []);

  const [start, setStart] = useState<Theme>(saved?.start ?? initialStart);
  const [seeds, setSeeds] = useState<Seeds>(saved?.seeds ?? PRESETS[start].seeds);
  const [typed, setTyped] = useState<Seeds>(seeds);
  const [touched, setTouched] = useState<SeedKey | undefined>();
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const issuesId = useId();
  const noteId = useId();

  const context = useMemo(() => ({ status: PRESETS[start].status, strict: start === "contrast" }), [start]);
  const { tokens, failures } = useMemo(() => checkSeeds(seeds, context), [seeds, context]);
  const invalid = SEED_KEYS.filter((key) => !isHexColour(typed[key]));
  const blocked = failures.length > 0 || invalid.length > 0;

  const tokenNames: Record<string, string> = text.tokens;

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>("select")?.focus();
  }, []);

  const adopt = (next: Seeds) => {
    setSeeds(next);
    setTyped(next);
  };

  const change = (key: SeedKey, value: string) => {
    setTyped((current) => ({ ...current, [key]: value }));
    setTouched(key);
    setNote("");
    if (isHexColour(value)) setSeeds((current) => ({ ...current, [key]: value.toLowerCase() }));
  };

  const chooseStart = (next: Theme) => {
    setStart(next);
    adopt(PRESETS[next].seeds);
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

  const save = () => {
    if (blocked) return;
    const done = saveCustomTheme({ v: 1, start, family: seedFamily(seeds), seeds, vars: tokens });
    if (!done) return setNote(text.saveBlocked);
    onChanged();
    onClose();
  };

  const remove = () => {
    deleteCustomTheme();
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
    const items = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
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

  return createPortal(
    <div className="theme-editor__backdrop" onKeyDown={keys}>
      <div ref={dialogRef} className="theme-editor" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className="theme-editor__title">
          {text.title}
        </h2>

        <label className="theme-editor__field">
          <span>{text.startFrom}</span>
          <select value={start} onChange={(event) => chooseStart(event.target.value as Theme)}>
            {THEMES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {themeNames[entry.value]}
              </option>
            ))}
          </select>
        </label>

        <div className="theme-editor__seeds">
          {SEED_KEYS.map((key) => (
            <div className="theme-editor__seed" key={key}>
              <span>{text.seeds[key]}</span>
              <input
                type="color"
                aria-label={text.seeds[key]}
                value={isHexColour(typed[key]) ? typed[key].toLowerCase() : seeds[key]}
                onChange={(event) => change(key, event.target.value)}
              />
              <input
                type="text"
                spellCheck={false}
                maxLength={7}
                aria-label={fill(text.colour, { name: text.seeds[key] })}
                aria-invalid={!isHexColour(typed[key])}
                value={typed[key]}
                onChange={(event) => change(key, event.target.value)}
              />
            </div>
          ))}
        </div>

        <section aria-label={text.preview}>
          <h3 className="theme-editor__heading">{text.preview}</h3>
          <div className="theme-editor__preview" style={tokens as unknown as CSSProperties} data-testid="theme-preview">
            <p>{text.previewText}</p>
            <div className="theme-editor__preview-card">{text.previewCard}</div>
            <span className="theme-editor__preview-button">{text.previewButton}</span>
          </div>
        </section>

        <section>
          <h3 className="theme-editor__heading">{text.issues}</h3>
          <div id={issuesId} aria-live="polite">
            {failures.length === 0 ? (
              <p>{text.allReadable}</p>
            ) : (
              <ul className="theme-editor__issues">
                {failures.map((failure) => (
                  <li key={`${failure.rule}|${failure.a}|${failure.b}`}>
                    <span>{describe(failure, tokenNames, text)}</span>
                    <button type="button" onClick={() => fixOne(failure)}>
                      {fill(text.fix, { name: tokenNames[failure.a as TokenName] ?? failure.a })}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p id={noteId} aria-live="polite" className="theme-editor__note">
            {note}
          </p>
          {failures.length > 1 && (
            <button type="button" onClick={fixEverything}>
              {text.fixAll}
            </button>
          )}
        </section>

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
          <button type="button" onClick={() => chooseStart(start)}>
            {text.resetToStart}
          </button>
          {saved && !asking && (
            <button type="button" onClick={() => setAsking(true)}>
              {text.remove}
            </button>
          )}
        </div>

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
      </div>
    </div>,
    document.body,
  );
}
