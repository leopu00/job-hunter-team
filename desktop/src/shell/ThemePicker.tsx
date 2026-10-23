import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { appLocale } from "../lib/app-locale";
import { fill } from "../lib/text-slots";
import {
  applyTheme,
  CUSTOM_THEME,
  persistTheme,
  readStoredCustom,
  readStoredPreference,
  resolveTheme,
  SYSTEM_THEME,
  THEMES,
  watchSystemTheme,
  type AppliedTheme,
  type Theme,
  type ThemePreference,
} from "./theme";
import { THEME_TEXT } from "./theme.i18n";
import { THEME_EDITOR_TEXT } from "./theme-editor.i18n";
import ThemeEditor from "./ThemeEditor";

const MENU_ID = "desktop-theme-menu";

/** The menu's palettes in the order they are shown: «follow the system», [the person's own], the dark ones, the light ones. */
const DARK_THEMES = THEMES.filter((entry) => entry.family === "dark");
const LIGHT_THEMES = THEMES.filter((entry) => entry.family === "light");

/** The swatch of the person's palette, from its five colours. */
const swatchOf = (seeds: { panel: string; border: string; accent: string }) =>
  ({ "--preview-bg": seeds.panel, "--preview-border": seeds.border, "--preview-accent": seeds.accent }) as CSSProperties;

function GearIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15">
      <path
        d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <circle
        cx="12"
        cy="12"
        r="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export default function ThemePicker() {
  // What was chosen (a palette, or «follow the system», which is also what nobody chose yet) and the
  // palette in force now. The second only differs from the first while the system decides.
  const [preference, setPreference] = useState<ThemePreference>(() =>
    readStoredPreference(window.localStorage),
  );
  const [theme, setTheme] = useState<AppliedTheme>(() => resolveTheme(preference));
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [custom, setCustom] = useState(() => readStoredCustom(window.localStorage));
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const text = THEME_TEXT[appLocale()];
  const editorText = THEME_EDITOR_TEXT[appLocale()];
  const label =
    preference === SYSTEM_THEME
      ? `${text.names[theme as Theme]} (${text.systemShort})`
      : theme === CUSTOM_THEME
        ? text.custom
        : text.names[theme];

  useEffect(() => applyTheme(theme), [theme]);

  // While the system decides, a change of its light/dark applies at once.
  useEffect(() => {
    if (preference !== SYSTEM_THEME) return;
    setTheme(resolveTheme(SYSTEM_THEME));
    return watchSystemTheme(setTheme);
  }, [preference]);

  useEffect(() => {
    if (!open) return;

    pickerRef.current
      ?.querySelector<HTMLButtonElement>(
        '[role="menuitemradio"][aria-checked="true"]',
      )
      ?.focus();

    const closeFromOutside = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeFromKeyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [open]);

  const choose = (next: ThemePreference) => {
    setPreference(next);
    setTheme(persistTheme(next));
    setOpen(false);
    triggerRef.current?.focus();
  };

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>) => {
    const items = [...(pickerRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? [])];
    const index = items.indexOf(event.currentTarget);
    let next: number | undefined;
    if (event.key === "ArrowDown") next = (index + 1) % items.length;
    if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = items.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    items[next].focus();
  };

  const option = (value: ThemePreference, name: string) => (
    <button
      key={value}
      type="button"
      role="menuitemradio"
      aria-checked={preference === value}
      className="theme-picker__option"
      onClick={() => choose(value)}
      onKeyDown={moveFocus}
    >
      <span
        className="theme-picker__swatch"
        data-theme-preview={value}
        style={value === CUSTOM_THEME && custom ? swatchOf(custom.seeds) : undefined}
        aria-hidden="true"
      >
        <i />
      </span>
      <span>{name}</span>
      <span className="theme-picker__check" aria-hidden="true">
        {preference === value ? "✓" : ""}
      </span>
    </button>
  );

  return (
    <div className="theme-picker" ref={pickerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="theme-picker__trigger"
        aria-label={fill(text.trigger, { name: label })}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? MENU_ID : undefined}
        onClick={() => setOpen((visible) => !visible)}
      >
        <GearIcon />
      </button>
      {open && (
        <div
          id={MENU_ID}
          className="theme-picker__menu"
          role="menu"
          aria-label={text.menu}
        >
          <span className="theme-picker__heading">{text.heading}</span>
          {option(SYSTEM_THEME, text.system)}
          {custom && option(CUSTOM_THEME, text.custom)}
          <span className="theme-picker__heading">{text.groupDark}</span>
          {DARK_THEMES.map((entry) => option(entry.value, text.names[entry.value]))}
          <span className="theme-picker__heading">{text.groupLight}</span>
          {LIGHT_THEMES.map((entry) => option(entry.value, text.names[entry.value]))}
          <button
            type="button"
            role="menuitem"
            className="theme-picker__option theme-picker__edit"
            onClick={() => {
              setOpen(false);
              setEditing(true);
            }}
            onKeyDown={moveFocus}
          >
            <span>{editorText.open}</span>
          </button>
        </div>
      )}
      {editing && (
        <ThemeEditor
          initialStart={theme === CUSTOM_THEME ? undefined : theme}
          onClose={() => {
            setEditing(false);
            triggerRef.current?.focus();
          }}
          onChanged={() => {
            const next = readStoredPreference(window.localStorage);
            setCustom(readStoredCustom(window.localStorage));
            setPreference(next);
            setTheme(resolveTheme(next));
          }}
        />
      )}
    </div>
  );
}
