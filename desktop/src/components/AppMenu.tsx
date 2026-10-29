import { useCallback, useEffect, useRef, useState } from "react";
import { appLocale } from "../lib/app-locale";
import { EXIT_OPEN_EVENT } from "../lib/app-exit";
import { toggleFullscreen } from "../lib/window-fullscreen";
import { APP_EXIT_TEXT } from "./AppExitDialog.i18n";
import { APP_MENU_TEXT } from "./AppMenu.i18n";

/** Something already open that answers ESC itself: a dialog, a menu, a popup button, or a panel that marks `data-esc-owner`. */
const ESC_OWNERS = '[role="dialog"], [aria-modal="true"], [role="menu"], [role="listbox"], [aria-haspopup][aria-expanded="true"], [data-esc-owner]';
const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/** ESC opens the menu only when nothing else wanted it: not while typing, not over a dialog or a menu that closes with it. */
export function escapeOpensMenu(event: KeyboardEvent, root: ParentNode = document): boolean {
  if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return false;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  if (event.target instanceof Element && event.target.closest(EDITABLE)) return false;
  return !root.querySelector(ESC_OWNERS);
}

/**
 * The app's keys: F11 puts the window in full screen and back, ESC opens a small menu (resume, full screen, leave the
 * app). ⌘Q needs nothing here: the native side sends it to the exit dialog (app_exit.rs, AppExitDialog).
 */
export default function AppMenu() {
  const [open, setOpen] = useState(false);
  const before = useRef<Element | null>(null);
  const firstRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    if (before.current instanceof HTMLElement) before.current.focus();
    before.current = null;
  }, []);

  useEffect(() => {
    // capture phase: this runs before the page's own handlers, so a dialog that ESC closes is still in the page when it is looked at
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "F11" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        void toggleFullscreen();
        return;
      }
      if (open && event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (!open && escapeOpensMenu(event)) {
        event.preventDefault();
        before.current = document.activeElement;
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  useEffect(() => {
    if (open) firstRef.current?.focus();
  }, [open]);

  if (!open) return null;
  const t = APP_MENU_TEXT[appLocale()];
  const leave = APP_EXIT_TEXT[appLocale()].menu;
  const item = "text-left rounded border border-[var(--color-border)] px-3 py-2 text-[12px] font-semibold text-[var(--color-bright)] hover:bg-[var(--color-panel)]";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 px-4" data-testid="app-menu" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-menu-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-5 flex flex-col gap-2"
      >
        <h2 id="app-menu-title" className="text-[14px] font-semibold text-[var(--color-bright)]">{t.title}</h2>
        <button ref={firstRef} type="button" data-testid="app-menu-resume" className={item} onClick={close}>{t.resume}</button>
        <button type="button" data-testid="app-menu-fullscreen" className={item} onClick={() => { close(); void toggleFullscreen(); }}>
          {t.fullscreen} <span className="font-normal text-[var(--color-muted)]">(F11)</span>
        </button>
        <button type="button" data-testid="app-menu-leave" className={item} onClick={() => { close(); window.dispatchEvent(new Event(EXIT_OPEN_EVENT)); }}>{leave}</button>
      </div>
    </div>
  );
}
