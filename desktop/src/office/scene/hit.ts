import type { DeptId, OfficeClick, OfficeLayout, Rect, Vec } from "../contract";

/**
 * What is under the pointer in the office, in world pixels: the same order
 * as the Godot office's _on_world_click (office.gd): an agent first, then a
 * pile (or its handoff table), then the objects that open something (the CV
 * shelf, the printer, the corkboard, the hologram, a department's
 * whiteboard), then the department whose zone it is. Pure, so the order is
 * tested without WebGL; the scene gives it the agents' and the piles' boxes
 * as they are drawn.
 */
export type Hit = { rect: Rect; target: OfficeClick };

/** The furniture that opens something, by kind or id, and what it opens. */
const OBJECTS: Array<{ match: (id: string, kind: string) => boolean; target: (id: string) => OfficeClick | null }> = [
  { match: (_id, kind) => kind === "output_shelf", target: () => ({ kind: "shelf" }) },
  { match: (_id, kind) => kind === "printer", target: () => ({ kind: "printer" }) },
  { match: (_id, kind) => kind === "corkboard", target: () => ({ kind: "board" }) },
  { match: (_id, kind) => kind === "hologram", target: () => ({ kind: "hologram" }) },
];

const DEPTS: readonly DeptId[] = ["scout", "analisti", "scorer", "scrittori", "critici"];
const asDept = (s: string): DeptId | null => ((DEPTS as readonly string[]).includes(s) ? (s as DeptId) : null);

/**
 * The layout's fixed targets: the handoff tables (handoff_<dept>: the same as
 * that department's pile), the objects above, a department's whiteboard
 * (wb_<dept>: its department), and last the departments' zones.
 */
export function layoutHits(layout: OfficeLayout): { tables: Hit[]; objects: Hit[]; zones: Hit[] } {
  const tables: Hit[] = [];
  const objects: Hit[] = [];
  for (const item of layout.furniture) {
    const rect = item.draw ?? item.rect;
    const table = /^handoff_(.+)$/.exec(item.id);
    const tableDept = table ? asDept(table[1]!) : null;
    if (tableDept) {
      tables.push({ rect, target: { kind: "pile", dept: tableDept } });
      continue;
    }
    const board = /^wb_(.+)$/.exec(item.id);
    const boardDept = board ? asDept(board[1]!) : null;
    if (boardDept) {
      objects.push({ rect, target: { kind: "department", dept: boardDept } });
      continue;
    }
    const object = OBJECTS.find((o) => o.match(item.id, item.kind));
    const target = object?.target(item.id);
    if (target) objects.push({ rect, target });
  }
  const zones = layout.departments.map((d) => ({ rect: d.zone, target: { kind: "department", dept: d.id } as OfficeClick }));
  return { tables, objects, zones };
}

const inside = (p: Vec, r: Rect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/**
 * The target at `p`. Among agents, the one drawn in front (the lowest
 * bottom edge, as the y-sorted layer draws them); for the rest, the first
 * in order.
 */
export function hitTest(p: Vec, layers: { agents: Hit[]; piles: Hit[]; tables: Hit[]; objects: Hit[]; zones: Hit[] }): OfficeClick | null {
  let front: Hit | null = null;
  for (const a of layers.agents) {
    if (inside(p, a.rect) && (!front || a.rect.y + a.rect.h > front.rect.y + front.rect.h)) front = a;
  }
  if (front) return front.target;
  for (const list of [layers.piles, layers.tables, layers.objects, layers.zones]) {
    const hit = list.find((h) => inside(p, h.rect));
    if (hit) return hit.target;
  }
  return null;
}

/** Two targets are the same thing (the hover does not change while the pointer stays on it). */
export function sameTarget(a: OfficeClick | null, b: OfficeClick | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Where a target is, for the keyboard's focus ring (D08): its box in world
 * pixels, or null when it is not in the office now (an agent that left). A
 * department is its zone, not its whiteboard; a pile is its sheets, or its
 * handoff table when the pile is empty.
 */
export function rectOf(target: OfficeClick, layers: { agents: Hit[]; piles: Hit[]; tables: Hit[]; objects: Hit[]; zones: Hit[] }): Rect | null {
  const order =
    target.kind === "department"
      ? [layers.zones, layers.objects]
      : target.kind === "pile"
        ? [layers.piles, layers.tables]
        : target.kind === "agent"
          ? [layers.agents]
          : [layers.objects];
  for (const list of order) {
    const hit = list.find((h) => sameTarget(h.target, target));
    if (hit) return hit.rect;
  }
  return null;
}

/**
 * Every target the keyboard can reach, in reading order: the agents of the
 * roster, then each phase's pile, each department, the CV shelf, the
 * printer, the corkboard, the hologram (only those the layout has).
 */
export function keyboardTargets(roster: Array<{ uid: string; role: string }>, layout: OfficeLayout): OfficeClick[] {
  const { objects, zones } = layoutHits(layout);
  const out: OfficeClick[] = roster.map((a) => ({ kind: "agent", uid: a.uid, role: a.role }) as OfficeClick);
  for (const z of zones) out.push({ kind: "pile", dept: (z.target as { dept: DeptId }).dept });
  for (const z of zones) out.push(z.target);
  for (const kind of ["shelf", "printer", "board", "hologram"] as const) {
    if (objects.some((o) => o.target.kind === kind)) out.push({ kind });
  }
  return out;
}
