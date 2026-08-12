"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import {
  THEME_STORAGE_KEY,
  initializeThemeSync,
  persistThemeChange,
  readLocalTheme,
  type Theme,
  type ThemeCloudBackend,
} from "@/lib/theme-cloud-sync";
import {
  createSupabaseThemeBackend,
  type ThemeSupabaseClient,
} from "@/lib/theme-cloud-supabase";

export type { Theme } from "@/lib/theme-cloud-sync";

type ThemeCtx = {
  theme: Theme;
  resolvedTheme: "dark" | "light";
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
};
const ThemeContext = createContext<ThemeCtx>({
  theme: "dark",
  resolvedTheme: "dark",
  toggleTheme: () => {},
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

/** Inietta transizione temporanea — evita flash al caricamento ma anima il toggle */
function enableTransition() {
  const style = document.createElement("style");
  style.id = "__theme-transition";
  style.textContent =
    "*, *::before, *::after { transition: background-color 0.25s ease, border-color 0.25s ease, color 0.15s ease !important; }";
  document.head.appendChild(style);
  window.setTimeout(() => style.remove(), 300);
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

/** Rileva preferenza di sistema */
function getSystemTheme(): "dark" | "light" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** Risolve tema iniziale: stored → 'system' se niente salvato */
function resolveInitialTheme(): Theme {
  return readLocalTheme(localStorage);
}

function resolveActual(t: Theme): "dark" | "light" {
  if (t === "system") return getSystemTheme();
  return t;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [resolvedTheme, setResolved] = useState<"dark" | "light">("dark");
  const backendRef = useRef<ThemeCloudBackend | null>(null);
  const explicitVersionRef = useRef(0);
  const latestExplicitThemeRef = useRef<Theme | null>(null);

  const adoptTheme = useCallback((next: Theme) => {
    const actual = resolveActual(next);
    setThemeState(next);
    setResolved(actual);
    applyTheme(actual);
  }, []);

  // La cache locale evita flash. La riconciliazione cloud parte dopo il mount:
  // anonimo = nessuna query tabella; autenticato = contratto sync v1.
  useEffect(() => {
    adoptTheme(resolveInitialTheme());

    const supabase = createClient();
    const backend = createSupabaseThemeBackend(
      supabase as unknown as ThemeSupabaseClient,
    );
    backendRef.current = backend;
    let cancelled = false;

    const reconcile = () => {
      const versionAtStart = explicitVersionRef.current;
      void initializeThemeSync(window.localStorage, backend).then((result) => {
        if (cancelled) return;
        if (versionAtStart !== explicitVersionRef.current) {
          // Una scelta utente iniziata dopo questa lettura e' piu' recente.
          // Il motore protegge il pending; qui proteggiamo anche UI e cache da
          // una risposta cloud partita prima del click.
          const latest = latestExplicitThemeRef.current;
          if (latest) {
            try {
              localStorage.setItem(THEME_STORAGE_KEY, latest);
            } catch {
              // Il tema resta comunque applicato in memoria.
            }
            adoptTheme(latest);
          }
          return;
        }
        adoptTheme(result.theme);
      });
    };
    reconcile();

    const onOnline = () => reconcile();
    window.addEventListener("online", onOnline);
    const { data } = supabase.auth.onAuthStateChange(() => {
      // Fuori dal callback Supabase: evita di nidificare una nuova query auth
      // mentre il client sta ancora completando il cambio sessione.
      window.setTimeout(reconcile, 0);
    });

    return () => {
      cancelled = true;
      backendRef.current = null;
      window.removeEventListener("online", onOnline);
      data.subscription.unsubscribe();
    };
  }, [adoptTheme]);

  // Ascolta cambi di system preference
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      const current = readLocalTheme(localStorage);
      if (current !== "system") return;
      const sys: "dark" | "light" = e.matches ? "dark" : "light";
      setResolved(sys);
      applyTheme(sys);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    enableTransition();
    const version = ++explicitVersionRef.current;
    latestExplicitThemeRef.current = t;
    adoptTheme(t);
    const backend = backendRef.current;
    if (!backend) {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, t);
      } catch {
        // Il tema resta applicato per la visita corrente.
      }
      return;
    }
    void persistThemeChange(t, window.localStorage, backend).then((result) => {
      if (version === explicitVersionRef.current) adoptTheme(result.theme);
    });
  }, [adoptTheme]);

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setTheme]);

  return (
    <ThemeContext.Provider
      value={{ theme, resolvedTheme, toggleTheme, setTheme }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

/** DarkModeToggle esteso — mostra testo + icona, usabile in settings */
export function DarkModeToggle() {
  const { theme, setTheme } = useTheme();
  const OPTIONS: { value: Theme; label: string }[] = [
    { value: "dark", label: "☀ dark" },
    { value: "light", label: "◐ light" },
    { value: "system", label: "⊙ system" },
  ];
  return (
    <div
      className="flex items-center gap-2"
      role="radiogroup"
      aria-label="Tema"
    >
      {OPTIONS.map(({ value, label }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          role="radio"
          aria-checked={theme === value}
          className="px-3 py-1.5 rounded text-[10px] font-semibold cursor-pointer transition-all"
          style={{
            border: `1px solid ${theme === value ? "var(--color-green)" : "var(--color-border)"}`,
            color: theme === value ? "var(--color-green)" : "var(--color-dim)",
            background:
              theme === value ? "rgba(0,232,122,0.08)" : "transparent",
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
