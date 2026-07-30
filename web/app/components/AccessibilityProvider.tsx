"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";

// ─── Context ───────────────────────────────────────────────────────────────
type A11yCtx = { announce: (msg: string, assertive?: boolean) => void };
const A11yContext = createContext<A11yCtx>({ announce: () => {} });

// ─── Focus trap hook ───────────────────────────────────────────────────────
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

// ─── Provider ──────────────────────────────────────────────────────────────
export function AccessibilityProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const politeRef = useRef<HTMLDivElement>(null);
  const assertRef = useRef<HTMLDivElement>(null);

  const announce = useCallback((msg: string, assertive = false) => {
    const el = assertive ? assertRef.current : politeRef.current;
    if (!el) return;
    el.textContent = "";
    requestAnimationFrame(() => {
      el.textContent = msg;
    });
  }, []);

  return (
    <A11yContext.Provider value={{ announce }}>
      {/* Aria live regions (sr-only) */}
      <div
        ref={politeRef}
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />
      <div
        ref={assertRef}
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      />

      {children}
    </A11yContext.Provider>
  );
}
