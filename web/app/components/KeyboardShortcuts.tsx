"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/use-locale";

/* ── i18n inline ─────────────────────────────────────────────────── */
const T: Record<string, Record<string, string>> = {
  sc_search: {
    it: "Apri ricerca globale",
    en: "Open global search",
    hu: "Globális keresés megnyitása",
    es: "Abrir búsqueda global",
    de: "Globale Suche öffnen",
    fr: "Ouvrir la recherche globale",
    pt: "Abrir pesquisa global",
  },
  sc_sidebar: {
    it: "Toggle sidebar",
    en: "Toggle sidebar",
    hu: "Oldalsáv be/ki",
    es: "Mostrar/ocultar barra lateral",
    de: "Seitenleiste umschalten",
    fr: "Afficher/masquer la barre latérale",
    pt: "Alternar barra lateral",
  },
  sc_close: {
    it: "Chiudi modale / overlay",
    en: "Close modal / overlay",
    hu: "Ablak / réteg bezárása",
    es: "Cerrar modal / superposición",
    de: "Modal / Overlay schließen",
    fr: "Fermer la fenêtre / le calque",
    pt: "Fechar modal / sobreposição",
  },
  sc_help: {
    it: "Mostra questo help",
    en: "Show this help",
    hu: "Súgó megjelenítése",
    es: "Mostrar esta ayuda",
    de: "Diese Hilfe anzeigen",
    fr: "Afficher cette aide",
    pt: "Mostrar esta ajuda",
  },
  sc_goto_dashboard: {
    it: "Vai a Dashboard",
    en: "Go to Dashboard",
    hu: "Ugrás a Vezérlőpultra",
    es: "Ir al Panel",
    de: "Zum Dashboard",
    fr: "Aller au tableau de bord",
    pt: "Ir para o Painel",
  },
  sc_goto_positions: {
    it: "Vai a Posizioni",
    en: "Go to Positions",
    hu: "Ugrás az Állásokra",
    es: "Ir a Posiciones",
    de: "Zu den Stellen",
    fr: "Aller aux postes",
    pt: "Ir para Vagas",
  },
  sc_goto_applications: {
    it: "Vai a Candidature",
    en: "Go to Applications",
    hu: "Ugrás a Jelentkezésekre",
    es: "Ir a Candidaturas",
    de: "Zu den Bewerbungen",
    fr: "Aller aux candidatures",
    pt: "Ir para Candidaturas",
  },
  sc_goto_ready: {
    it: "Vai a Pronte",
    en: "Go to Ready",
    hu: "Ugrás a Kész elemekre",
    es: "Ir a Listas",
    de: "Zu Bereit",
    fr: "Aller à Prêtes",
    pt: "Ir para Prontas",
  },
  sc_goto_team: {
    it: "Vai a Team",
    en: "Go to Team",
    hu: "Ugrás a Csapathoz",
    es: "Ir al Equipo",
    de: "Zum Team",
    fr: "Aller à l'équipe",
    pt: "Ir para a Equipe",
  },
  sc_goto_profile: {
    it: "Vai a Profilo",
    en: "Go to Profile",
    hu: "Ugrás a Profilhoz",
    es: "Ir al Perfil",
    de: "Zum Profil",
    fr: "Aller au profil",
    pt: "Ir para o Perfil",
  },
  title: {
    it: "Scorciatoie tastiera",
    en: "Keyboard shortcuts",
    hu: "Billentyűparancsok",
    es: "Atajos de teclado",
    de: "Tastenkürzel",
    fr: "Raccourcis clavier",
    pt: "Atalhos de teclado",
  },
  close: {
    it: "Chiudi",
    en: "Close",
    hu: "Bezárás",
    es: "Cerrar",
    de: "Schließen",
    fr: "Fermer",
    pt: "Fechar",
  },
  press: {
    it: "Premi",
    en: "Press",
    hu: "Nyomd meg:",
    es: "Pulsa",
    de: "Drücke",
    fr: "Appuyez sur",
    pt: "Pressione",
  },
  or: {
    it: "o",
    en: "or",
    hu: "vagy",
    es: "o",
    de: "oder",
    fr: "ou",
    pt: "ou",
  },
  to_close: {
    it: "per chiudere",
    en: "to close",
    hu: "a bezáráshoz",
    es: "para cerrar",
    de: "zum Schließen",
    fr: "pour fermer",
    pt: "para fechar",
  },
};

type ShortcutCtx = { registerEscape: (fn: () => void) => () => void };
const ShortcutContext = createContext<ShortcutCtx>({
  registerEscape: () => () => {},
});

const SHORTCUT_KEYS: { keys: string; key: string }[] = [
  { keys: "⌘K", key: "sc_search" },
  { keys: "⌘/", key: "sc_sidebar" },
  { keys: "Esc", key: "sc_close" },
  { keys: "?", key: "sc_help" },
  { keys: "G D", key: "sc_goto_dashboard" },
  { keys: "G P", key: "sc_goto_positions" },
  { keys: "G C", key: "sc_goto_applications" },
  { keys: "G R", key: "sc_goto_ready" },
  { keys: "G T", key: "sc_goto_team" },
  { keys: "G F", key: "sc_goto_profile" },
];

function HelpOverlay({ onClose }: { onClose: () => void }) {
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
  return (
    <div
      role="dialog"
      aria-label={tr("title")}
      className="fixed inset-0 flex items-center justify-center z-50 px-5"
      style={{
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(6px)",
        animation: "fade-in 0.15s ease both",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-sm rounded-xl overflow-hidden"
        style={{
          background: "var(--color-panel)",
          border: "1px solid var(--color-border)",
          animation: "fade-in 0.2s ease both",
        }}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "var(--color-border)" }}
        >
          <p className="text-[12px] font-bold text-[var(--color-white)]">
            {tr("title")}
          </p>
          <button
            onClick={onClose}
            aria-label={tr("close")}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--color-dim)",
              fontSize: 16,
            }}
          >
            ×
          </button>
        </div>
        <ul className="px-5 py-4 flex flex-col gap-2.5">
          {SHORTCUT_KEYS.map((s) => (
            <li
              key={s.keys}
              className="flex items-center justify-between gap-4"
            >
              <span
                className="text-[11px]"
                style={{ color: "var(--color-muted)" }}
              >
                {tr(s.key)}
              </span>
              <kbd
                className="px-2 py-0.5 rounded text-[9px] font-mono font-bold flex-shrink-0"
                style={{
                  border: "1px solid var(--color-border)",
                  background: "var(--color-card)",
                  color: "var(--color-bright)",
                }}
              >
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
        <p
          className="px-5 pb-4 text-[9px]"
          style={{ color: "var(--color-dim)" }}
        >
          {tr("press")}{" "}
          <kbd
            className="px-1 rounded"
            style={{
              border: "1px solid var(--color-border)",
              background: "var(--color-card)",
            }}
          >
            Esc
          </kbd>{" "}
          {tr("or")}{" "}
          <kbd
            className="px-1 rounded"
            style={{
              border: "1px solid var(--color-border)",
              background: "var(--color-card)",
            }}
          >
            ?
          </kbd>{" "}
          {tr("to_close")}
        </p>
      </div>
    </div>
  );
}

const GOTO: Record<string, string> = {
  d: "/dashboard",
  p: "/positions",
  t: "/team",
  f: "/profile",
};

export function KeyboardShortcutsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [showHelp, setShowHelp] = useState(false);
  const [escapeFns] = useState<Set<() => void>>(new Set());
  const [pendingG, setPendingG] = useState(false);
  const router = useRouter();

  const registerEscape = useCallback(
    (fn: () => void) => {
      escapeFns.add(fn);
      return () => escapeFns.delete(fn);
    },
    [escapeFns],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (e.target as HTMLElement)?.isContentEditable;

      // Escape
      if (e.key === "Escape") {
        if (showHelp) {
          setShowHelp(false);
          return;
        }
        escapeFns.forEach((fn) => fn());
        return;
      }

      // Cmd+K — search
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent("jht:search"));
        return;
      }

      // Cmd+/ — sidebar toggle
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent("jht:sidebar-toggle"));
        return;
      }

      if (typing) return;

      // ? — help
      if (e.key === "?") {
        setShowHelp((h) => !h);
        return;
      }

      // G + letter — goto shortcut
      if (pendingG) {
        setPendingG(false);
        const dest = GOTO[e.key.toLowerCase()];
        if (dest) router.push(dest);
        return;
      }
      if (e.key.toLowerCase() === "g") {
        setPendingG(true);
        setTimeout(() => setPendingG(false), 1500);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showHelp, pendingG, escapeFns, router]);

  return (
    <ShortcutContext.Provider value={{ registerEscape }}>
      {children}
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
    </ShortcutContext.Provider>
  );
}
