import { useSyncExternalStore, type ReactNode } from "react";

/**
 * The web's theme, as the desktop gives it. The desktop chooses its palette with its own picker (src/shell/theme.ts) and
 * writes the base, light or dark, on the page as `data-theme`: the web components only follow it. Without this stand-in
 * the web's context answered «dark» on every theme, so the Map's globe stayed dark on a light one.
 */
export type Theme = "dark" | "light" | "system";
type Resolved = "dark" | "light";

const read = (): Resolved => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

export function useTheme(): { theme: Theme; resolvedTheme: Resolved; toggleTheme: () => void; setTheme: (theme: Theme) => void } {
  const resolvedTheme = useSyncExternalStore(subscribe, read, () => "dark" as Resolved);
  // the choice is the desktop picker's: the web's own switches do nothing here
  return { theme: resolvedTheme, resolvedTheme, toggleTheme: () => {}, setTheme: () => {} };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/** The web's light/dark switch: the desktop has its own theme menu. */
export function DarkModeToggle() {
  return null;
}
