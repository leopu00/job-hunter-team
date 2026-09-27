/**
 * The office's walkable grid and its A*: a port of game/scripts/office/
 * nav_grid.gd (NavGrid on Godot's AStar2D).
 *
 * The floor is cut in cells of `cell` px; a cell is walkable when its centre
 * falls outside every obstacle grown by `margin` (furniture) or `wallMargin`
 * (glass walls, thin: the body's radius is enough). Cells connect to their
 * four neighbours, and diagonally only when both orthogonal cells are free,
 * so a path never cuts a corner. Costs are euclidean, as in AStar2D.
 */

import type { Rect, Vec } from "../contract";

export type NavInput = {
  floor: Rect;
  obstacles: Rect[];
  walls: Rect[];
  cell: number;
  margin: number;
  wallMargin: number;
};

/** Godot's Rect2.has_point: the start edges belong to the rect, the end edges do not. */
export function hasPoint(r: Rect, p: Vec): boolean {
  return p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;
}

/** Godot's Rect2.grow. */
export function grow(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by };
}

export function distance(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly cell: number;
  private readonly origin: Vec;
  private readonly floor: Rect;
  private readonly grown: Rect[];
  private readonly walkable: Uint8Array;
  /** walkable cell ids, ascending: the candidates of closestPoint */
  private readonly walkableIds: number[];

  constructor(input: NavInput) {
    this.cell = input.cell;
    this.floor = input.floor;
    this.origin = { x: input.floor.x, y: input.floor.y };
    this.cols = Math.floor(input.floor.w / input.cell);
    this.rows = Math.floor(input.floor.h / input.cell);
    this.grown = [
      ...input.obstacles.map((r) => grow(r, input.margin)),
      ...input.walls.map((r) => grow(r, input.wallMargin)),
    ];
    this.walkable = new Uint8Array(this.cols * this.rows);
    this.walkableIds = [];
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const p = this.center(x, y);
        if (!this.grown.some((r) => hasPoint(r, p))) {
          const id = this.id(x, y);
          this.walkable[id] = 1;
          this.walkableIds.push(id);
        }
      }
    }
  }

  /** How many cells can be walked on. */
  get pointCount(): number {
    return this.walkableIds.length;
  }

  /**
   * The path from `from` to `to`: the cell centres from the one closest to
   * `from` to the one closest to `to`, the last replaced by `to` itself when
   * `to` is walkable (else by its closest cell). Empty when there is no way.
   */
  path(from: Vec, to: Vec): Vec[] {
    if (this.walkableIds.length === 0) return [];
    const a = this.closestId(from);
    const b = this.closestId(to);
    const ids = this.astar(a, b);
    if (ids.length === 0) return [];
    const pts = ids.map((id) => this.pointOf(id));
    pts[pts.length - 1] = this.clampToWalkable(to);
    return pts;
  }

  /** True only for a point inside the floor and outside every grown obstacle. */
  isPointWalkable(p: Vec): boolean {
    if (!hasPoint(this.floor, p)) return false;
    return !this.grown.some((r) => hasPoint(r, p));
  }

  clampToWalkable(p: Vec): Vec {
    if (this.isPointWalkable(p)) return { ...p };
    return this.pointOf(this.closestId(p));
  }

  /** A random walkable cell centre (the agents' wandering). */
  randomPoint(random: () => number): Vec {
    if (this.walkableIds.length === 0) return { ...this.origin };
    const i = Math.min(this.walkableIds.length - 1, Math.floor(random() * this.walkableIds.length));
    return this.pointOf(this.walkableIds[i]!);
  }

  private center(x: number, y: number): Vec {
    return { x: this.origin.x + (x + 0.5) * this.cell, y: this.origin.y + (y + 0.5) * this.cell };
  }

  private id(x: number, y: number): number {
    return y * this.cols + x;
  }

  private pointOf(id: number): Vec {
    return this.center(id % this.cols, Math.floor(id / this.cols));
  }

  private free(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows && this.walkable[this.id(x, y)] === 1;
  }

  /** AStar2D.get_closest_point: the nearest walkable centre, the lowest id on a tie. */
  private closestId(p: Vec): number {
    let best = this.walkableIds[0]!;
    let bestD = Infinity;
    for (const id of this.walkableIds) {
      const q = this.pointOf(id);
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  private neighbours(id: number): number[] {
    const x = id % this.cols;
    const y = Math.floor(id / this.cols);
    const out: number[] = [];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      if (this.free(x + dx, y + dy)) out.push(this.id(x + dx, y + dy));
    }
    for (const [dx, dy] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      if (this.free(x + dx, y + dy) && this.free(x + dx, y) && this.free(x, y + dy)) {
        out.push(this.id(x + dx, y + dy));
      }
    }
    return out;
  }

  /** A* on the cells, euclidean cost and heuristic. */
  private astar(start: number, goal: number): number[] {
    if (start === goal) return [start];
    const goalP = this.pointOf(goal);
    const g = new Map<number, number>([[start, 0]]);
    const came = new Map<number, number>();
    const heap = new MinHeap();
    heap.push(start, distance(this.pointOf(start), goalP));
    const closed = new Set<number>();
    while (heap.size > 0) {
      const current = heap.pop()!;
      if (current === goal) {
        const out = [current];
        let c = current;
        while (came.has(c)) {
          c = came.get(c)!;
          out.push(c);
        }
        return out.reverse();
      }
      if (closed.has(current)) continue;
      closed.add(current);
      const cp = this.pointOf(current);
      const gc = g.get(current)!;
      for (const n of this.neighbours(current)) {
        if (closed.has(n)) continue;
        const np = this.pointOf(n);
        const tentative = gc + distance(cp, np);
        if (tentative < (g.get(n) ?? Infinity)) {
          g.set(n, tentative);
          came.set(n, current);
          heap.push(n, tentative + distance(np, goalP));
        }
      }
    }
    return [];
  }
}

/** A binary min-heap of (id, priority); ties go to the lower id, so paths are deterministic. */
class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, key: number): void {
    this.ids.push(id);
    this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number | undefined {
    if (this.ids.length === 0) return undefined;
    const top = this.ids[0];
    const lastId = this.ids.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.ids.length && this.less(l, m)) m = l;
        if (r < this.ids.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private less(a: number, b: number): boolean {
    return this.keys[a]! < this.keys[b]! || (this.keys[a] === this.keys[b] && this.ids[a]! < this.ids[b]!);
  }

  private swap(a: number, b: number): void {
    [this.ids[a], this.ids[b]] = [this.ids[b]!, this.ids[a]!];
    [this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!];
  }
}
