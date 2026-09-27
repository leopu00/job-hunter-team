import type { OfficeLayout, Vec } from "../contract";

/**
 * The paper on a handoff table, as game/scripts/office/paper_pile.gd lays
 * it: one sheet per document, in stacks of `perStack`, at most `maxStacks`
 * stacks in rows of `columns` along the table's perspective axes (basisX to
 * the right, basisY towards the front); past maxStacks x perStack the
 * surplus is spread evenly, so no single tower grows to the ceiling. Pure.
 */
export type PaperRule = NonNullable<OfficeLayout["paperPile"]>;

export function stackSizes(count: number, rule: PaperRule): number[] {
  if (count <= 0) return [];
  const stacks = Math.min(rule.maxStacks, Math.ceil(count / rule.perStack));
  const sizes: number[] = [];
  let remaining = count;
  for (let i = 0; i < stacks; i++) {
    const amount = Math.min(rule.perStack, remaining);
    sizes.push(amount);
    remaining -= amount;
  }
  let cursor = 0;
  while (remaining > 0) {
    const addition = Math.min(remaining, stacks);
    for (let i = 0; i < addition; i++) sizes[(cursor + i) % stacks] += 1;
    remaining -= addition;
    cursor = (cursor + addition) % stacks;
  }
  return sizes;
}

export function stackBase(index: number, total: number, rule: PaperRule): Vec {
  const row = Math.floor(index / rule.columns);
  const col = index % rule.columns;
  const rows = Math.ceil(total / rule.columns);
  const rowCount = Math.min(rule.columns, total - row * rule.columns);
  const across = col - (rowCount - 1) / 2;
  const depth = row - (rows - 1) / 2;
  return { x: rule.basisX.x * across + rule.basisY.x * depth, y: rule.basisX.y * across + rule.basisY.y * depth };
}

/** Every sheet's offset from the pile's spot and its slight tilt, in drawing order. */
export function sheetPlacements(count: number, rule: PaperRule): Array<{ x: number; y: number; rotation: number }> {
  const sizes = stackSizes(count, rule);
  const out: Array<{ x: number; y: number; rotation: number }> = [];
  let i = 0;
  sizes.forEach((size, stack) => {
    const base = stackBase(stack, sizes.length, rule);
    for (let level = 0; level < size; level++, i++)
      out.push({ x: base.x + Math.sin(i * 2.17) * 1.2, y: base.y - level * rule.rise, rotation: Math.sin(i * 1.31) * 0.012 });
  });
  return out;
}

/** How tall the pile stands: its highest stack, in world px. */
export function towerHeight(count: number, rule: PaperRule): number {
  return Math.max(0, ...stackSizes(count, rule)) * rule.rise;
}
