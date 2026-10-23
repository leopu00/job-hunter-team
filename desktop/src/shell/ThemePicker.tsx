import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { appLocale } from "../lib/app-locale";
import { fill } from "../lib/text-slots";
import {
  applyTheme,
  CUSTOM_THEME,
  persistTheme,
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

const MENU_ID = "desktop-theme-menu";

/** The menu's entries in the order they are shown: «follow the system», then the dark palettes, then the light ones. */
const DARK_THEMES = THEMES.filter((entry) => entry.family === "dark");
const LIGHT_THEMES = THEMES.filter((entry) => entry.family === "light");
const CHOICES: readonly ThemePreference[] = [
  SYSTEM_THEME,
  ...DARK_THEMES.map((entry) => entry.value),
  ...LIGHT_THEMES.map((entry) => entry.value),
];

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
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const text = THEME_TEXT[appLocale()];
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

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | undefined;
    if (event.key === "ArrowDown") next = (index + 1) % CHOICES.length;
    if (event.key === "ArrowUp") {
      next = (index - 1 + CHOICES.length) % CHOICES.length;
    }
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = CHOICES.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    pickerRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
      .item(next)
      .focus();
  };

  const option = (value: ThemePreference, name: string) => (
    <button
      key={value}
      type="button"
      role="menuitemradio"
      aria-checked={preference === value}
      className="theme-picker__option"
      onClick={() => choose(value)}
      onKeyDown={(event) => moveFocus(event, CHOICES.indexOf(value))}
    >
      <span
        className="theme-picker__swatch"
        data-theme-preview={value}
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
          <span className="theme-picker__heading">{text.groupDark}</span>
          {DARK_THEMES.map((entry) => option(entry.value, text.names[entry.value]))}
          <span className="theme-picker__heading">{text.groupLight}</span>
          {LIGHT_THEMES.map((entry) => option(entry.value, text.names[entry.value]))}
        </div>
      )}
    </div>
  );
}
