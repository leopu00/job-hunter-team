import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  applyTheme,
  persistTheme,
  readStoredTheme,
  THEMES,
  type Theme,
} from "./theme";

const MENU_ID = "desktop-theme-menu";

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
  const [theme, setTheme] = useState<Theme>(() =>
    readStoredTheme(window.localStorage),
  );
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const label =
    THEMES.find((option) => option.value === theme)?.label ?? "Scuro";

  useEffect(() => applyTheme(theme), [theme]);

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

  const choose = (next: Theme) => {
    setTheme(next);
    persistTheme(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | undefined;
    if (event.key === "ArrowDown") next = (index + 1) % THEMES.length;
    if (event.key === "ArrowUp") {
      next = (index - 1 + THEMES.length) % THEMES.length;
    }
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = THEMES.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    pickerRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
      .item(next)
      .focus();
  };

  return (
    <div className="theme-picker" ref={pickerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="theme-picker__trigger"
        aria-label={`Tema: ${label}. Cambia tema`}
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
          aria-label="Tema dell'app"
        >
          <span className="theme-picker__heading">Tema</span>
          {THEMES.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={theme === option.value}
              className="theme-picker__option"
              onClick={() => choose(option.value)}
              onKeyDown={(event) => moveFocus(event, index)}
            >
              <span
                className="theme-picker__swatch"
                data-theme-preview={option.value}
                aria-hidden="true"
              >
                <i />
              </span>
              <span>{option.label}</span>
              <span className="theme-picker__check" aria-hidden="true">
                {theme === option.value ? "✓" : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
