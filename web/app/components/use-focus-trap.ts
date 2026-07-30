"use client";

import { useEffect } from "react";

/**
 * Focus trap for genuinely modal dialogs.
 *
 * While `active`, Tab and Shift+Tab cycle inside `ref` instead of walking
 * the page underneath, and closing the dialog gives focus back to whatever
 * opened it. Use it only where leaving with Tab would be wrong — a dialog
 * that dims the page and expects an answer. On a popover, where the user
 * expects Tab to move on, this is a regression.
 */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function useFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
) {
  useEffect(() => {
    if (!active || !ref.current) return;
    const el = ref.current;
    // Re-query on every Tab: a dialog's focusable set changes while it is
    // open (search results appear, a conversation replaces the list), and a
    // list captured at mount would wrap on nodes no longer in the document.
    const focusables = () =>
      Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
    const initial = focusables();
    if (!initial.length) return;
    const prev = document.activeElement as HTMLElement | null;
    initial[0].focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const nodes = focusables();
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    el.addEventListener("keydown", trap);
    return () => {
      el.removeEventListener("keydown", trap);
      prev?.focus();
    };
  }, [active, ref]);
}
