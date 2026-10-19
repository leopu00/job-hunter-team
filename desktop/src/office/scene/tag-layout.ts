import type { Rect } from "../contract";

/** A tag to place: its centre as wanted (over the agent's head) and its size, in world pixels. */
export type TagBox = { id: string; x: number; y: number; w: number; h: number };

/**
 * Where each agent's tag goes so that no two overlap, nor one and a fixed label (a handoff tag):
 * the tags are placed from the lowest up, each where it wants to be or, when that spot is taken,
 * just above what takes it. A tag that would go past the top or a side of the view stays at its
 * edge. Returns each tag's centre.
 */
export function separateTags(
  tags: TagBox[],
  fixed: Rect[],
  gap: number,
  view: { top?: number; left?: number; right?: number } = {},
): Map<string, { x: number; y: number }> {
  const { top = -Infinity, left = -Infinity, right = Infinity } = view;
  const placed: Rect[] = [...fixed];
  const out = new Map<string, { x: number; y: number }>();
  const order = [...tags].sort((a, b) => b.y - a.y || a.id.localeCompare(b.id));
  for (const t of order) {
    // inside the view's sides first: where it can be read is where it is placed
    const x = Math.min(Math.max(t.x, left + t.w / 2), Math.max(left + t.w / 2, right - t.w / 2));
    const tag = { ...t, x };
    let y = tag.y;
    // each move goes above one box: at most one move per box
    for (let moves = 0; moves <= placed.length; moves++) {
      const box = { x: tag.x - tag.w / 2, y: y - tag.h / 2, w: tag.w, h: tag.h };
      const hit = placed.find((r) => overlaps(box, r, gap));
      if (!hit) break;
      y = hit.y - gap - tag.h / 2;
    }
    y = Math.max(y, top + tag.h / 2);
    placed.push({ x: tag.x - tag.w / 2, y: y - tag.h / 2, w: tag.w, h: tag.h });
    out.set(tag.id, { x, y });
  }
  return out;
}

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}
