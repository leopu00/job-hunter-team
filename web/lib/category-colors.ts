import { categoryPalette, PALETTE_SIZE } from "./theme-palette";

/**
 * The colours of the categories of a chart, as CSS: `var(--cat-N, fallback)`. The variables `--cat-0 … --cat-13` are written into
 * the page from the main colour of the theme in use (theme-palette.ts) and follow it: when the person picks another theme,
 * or the web goes from light to dark, they are written again and every chart that uses them changes by itself. The fallback is
 * what a chart shows before the variables are there (the first paint, a test with no theme): a plain token, never a hex.
 */
const FALLBACK: readonly string[] = [
  "var(--color-blue)",
  "var(--color-yellow)",
  "color-mix(in srgb, var(--color-red) 75%, var(--color-purple))",
  "color-mix(in srgb, var(--color-blue) 50%, var(--color-yellow))",
  "color-mix(in srgb, var(--color-blue) 50%, var(--color-red))",
  "color-mix(in srgb, var(--color-orange) 75%, var(--color-purple))",
  "color-mix(in srgb, var(--color-blue) 75%, var(--color-yellow))",
  "var(--color-purple)",
  "color-mix(in srgb, var(--color-blue) 25%, var(--color-yellow))",
  "color-mix(in srgb, var(--color-red) 75%, var(--color-orange))",
  "var(--color-red)",
  "var(--color-orange)",
  "color-mix(in srgb, var(--color-green) 50%, var(--color-yellow))",
  "color-mix(in srgb, var(--color-blue) 50%, var(--color-green))",
];

/** The colour of category number `index` (0..13; past the last one it starts again). */
export function categoryColor(index: number): string {
  const slot = ((Math.trunc(index) % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE;
  return `var(--cat-${slot}, ${FALLBACK[slot]})`;
}

/** The colour of each role of the team: one slot each, so the 13 roles are 13 different colours of the theme. */
export const ROLE_SLOT: Readonly<Record<string, number>> = {
  scout: 0,
  analista: 1,
  scorer: 2,
  capitano: 3,
  dottore: 4,
  sentinella: 5,
  assistente: 6,
  mentor: 7,
  mantenitore: 8,
  scrittore: 9,
  critico: 10,
  tesoriere: 11,
  closer: 12,
};

export function roleCategoryColor(role: string): string | null {
  return role in ROLE_SLOT ? categoryColor(ROLE_SLOT[role]) : null;
}

const STYLE_ID = "jht-category-palette";

/** Reads the theme's main colour and card from the page and writes the variables; null (and no variables) if they are not there. */
export function applyCategoryPalette(root: HTMLElement = document.documentElement): string[] | null {
  const style = getComputedStyle(root);
  const palette = categoryPalette(style.getPropertyValue("--color-green"), style.getPropertyValue("--color-card"));
  let element = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!palette) {
    element?.remove();
    return null;
  }
  if (!element) {
    element = document.createElement("style");
    element.id = STYLE_ID;
    document.head.appendChild(element);
  }
  const text = `:root{${palette.map((color, index) => `--cat-${index}:${color}`).join(";")}}`;
  if (element.textContent !== text) element.textContent = text;
  return palette;
}

let installed = false;

/**
 * Writes the palette now and again whenever the theme changes (the attributes the themes are chosen by, or the inline variables of
 * the person's own palette), and once the page's styles have loaded. Idempotent; does nothing outside a browser.
 */
export function ensureCategoryPalette(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  let pending: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (pending !== null || typeof document === "undefined") return;
    pending = setTimeout(() => {
      pending = null;
      // The page may be gone by the time the timer fires (a test environment torn down, a closed window).
      if (typeof document === "undefined") return;
      applyCategoryPalette();
    }, 0);
  };
  applyCategoryPalette();
  new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-jht-theme", "style", "class"] });
  if (typeof window !== "undefined") {
    window.addEventListener("load", schedule);
    setTimeout(schedule, 400); // a stylesheet that arrives after the first read
  }
}

ensureCategoryPalette();
