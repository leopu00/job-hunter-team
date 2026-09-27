import type { FurnitureItem, OfficeLayout, Rect } from "./contract";

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

/**
 * What the camera frames: the floor and what stands behind it (the wall
 * and the glass band above the floor), so the fit shows the office whole.
 */
export function sceneBounds(layout: OfficeLayout): Rect {
  let { x, y, w, h } = layout.floor;
  let right = x + w;
  let bottom = y + h;
  for (const b of layout.backdrop ?? []) {
    x = Math.min(x, b.draw.x);
    y = Math.min(y, b.draw.y);
    right = Math.max(right, b.draw.x + b.draw.w);
    bottom = Math.max(bottom, b.draw.y + b.draw.h);
  }
  return { x, y, w: right - x, h: bottom - y };
}
