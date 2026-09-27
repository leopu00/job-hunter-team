import type { FurnitureItem, OfficeLayout } from "./contract";

/**
 * Every piece of furniture of the layout: the free-standing ones and the
 * departments' desks, which the contract lets live only in their Desk. One
 * per id: a desk listed in both places is drawn once.
 */
export function allFurniture(layout: OfficeLayout): FurnitureItem[] {
  const out = new Map<string, FurnitureItem>();
  for (const item of layout.furniture) out.set(item.id, item);
  for (const dept of layout.departments) for (const desk of dept.desks) if (!out.has(desk.furniture.id)) out.set(desk.furniture.id, desk.furniture);
  return [...out.values()];
}
