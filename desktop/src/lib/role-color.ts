import type { BudgetRole } from "./team-budget-native";

/**
 * One colour for each role of the team, always a token of the CHOSEN theme (the desktop's eleven palettes follow it), so a
 * chart is in the palette of the person's theme and its categories stay apart. Used by every chart that tells the roles
 * apart (the Budget page, the agents' gantt). Never a hex here.
 */
export const ROLE_COLOR: Record<BudgetRole, string> = {
  scout: "var(--color-blue)",
  analista: "var(--color-green)",
  scorer: "var(--color-red)",
  capitano: "var(--color-purple)",
  dottore: "var(--color-orange)",
  sentinella: "var(--color-yellow)",
  assistente: "var(--color-ready)",
  mentor: "var(--color-white)",
  mantenitore: "var(--color-muted)",
  scrittore: "var(--color-border-glow)",
  critico: "var(--color-base)",
  tesoriere: "var(--color-dim)",
  closer: "var(--color-deep)",
};

/** The colour of a role by its name; a role this list does not know is the neutral one, never a made-up colour. */
export function roleColor(role: string): string {
  return (ROLE_COLOR as Record<string, string>)[role] ?? "var(--color-muted)";
}
