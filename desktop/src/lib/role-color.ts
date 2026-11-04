import { categoryColor, ROLE_SLOT } from "@/lib/category-colors";
import type { BudgetRole } from "./team-budget-native";

/**
 * One colour for each role of the team, derived from the MAIN colour of the CHOSEN theme (web/lib/category-colors.ts: the desktop's
 * eleven palettes and the person's own follow it): a green theme has shades of green, an orange one shades of orange, and the 13
 * roles stay 13 different colours. Used by every chart that tells the roles apart (the Budget page, the agents' lanes and gantt).
 * Never a hex here.
 */
export const ROLE_COLOR: Record<BudgetRole, string> = Object.fromEntries(
  (Object.keys(ROLE_SLOT) as BudgetRole[]).map((role) => [role, categoryColor(ROLE_SLOT[role])]),
) as Record<BudgetRole, string>;

/** The colour of a role by its name; a role this list does not know is the neutral one, never a made-up colour. */
export function roleColor(role: string): string {
  return (ROLE_COLOR as Record<string, string>)[role] ?? "var(--color-muted)";
}
