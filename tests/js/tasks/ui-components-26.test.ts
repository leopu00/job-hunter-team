/** Test UI batch 26 — Chip, Collapsible, Dropdown */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
function readSrc(rel: string) {
  const raw = fs.readFileSync(path.join(WEB, rel), "utf-8").replace(/\r\n/g, "\n");
  const singleQuoted = raw.replace(/"/g, "'");
  const squashed = singleQuoted.replace(/\s+/g, " ").trim();
  return [raw, singleQuoted, squashed].join("\n/* normalized */\n");
}

/* ── Chip ── */
describe("Chip", () => {
  const src = readSrc("app/components/Chip.tsx");

  it("export Chip + ChipGroup + ChipProps + ChipVariant filled/outlined + ChipColor 7 + ChipSize 3", () => {
    expect(src).toMatch(/export function Chip\b/);
    expect(src).toMatch(/export function ChipGroup\b/);
    expect(src).toContain("export interface ChipProps");
    expect(src).toContain("export type ChipVariant = 'filled' | 'outlined'");
    expect(src).toContain("export type ChipColor =");
    expect(src).toContain("'default' | 'green' | 'red' | 'yellow' | 'blue' | 'orange' | 'purple'");
    expect(src).toContain("export type ChipSize = 'sm' | 'md' | 'lg'");
  });

  it("close: onRemove + stopPropagation + svg X path + aria-label Rimuovi + disabled nasconde close", () => {
    expect(src).toContain("onRemove?: () => void");
    expect(src).toContain("e.stopPropagation(); onRemove()");
    expect(src).toContain("aria-label={`Rimuovi ${label}`}");
    expect(src).toContain("onRemove && !disabled");
    expect(src).toContain("strokeLinecap=\"round\"");
  });

  it("click: onClick selectable + aria-pressed + Enter/Space keyboard + chip-pop animation + disabled opacity 0.45", () => {
    expect(src).toContain("onClick?: () => void");
    expect(src).toContain("aria-pressed={clickable ? selected : undefined}");
    expect(src).toContain("e.key === 'Enter' || e.key === ' '");
    expect(src).toContain("@keyframes chip-pop");
    expect(src).toContain("chip-pop .2s ease");
    expect(src).toContain("opacity: disabled ? 0.45 : 1");
  });

  it("icon: leading icon + COLOR 7 colori con base/bg/border + SIZE 3 con h/px/font + ChipGroup wrap/gap", () => {
    expect(src).toContain("icon?: ReactNode");
    expect(src).toContain("{icon}");
    expect(src).toContain("const COLOR");
    expect(src).toContain("const SIZE");
    expect(src).toContain("export interface ChipGroupProps");
    expect(src).toContain("wrap = true");
  });
});

/* ── Collapsible ── */
describe("Collapsible", () => {
  const src = readSrc("components/Collapsible.tsx");

  it("export default Collapsible + CollapsibleProps + variant 3 + chevronSide left/right", () => {
    expect(src).toMatch(/export default function Collapsible\b/);
    expect(src).toContain("export interface CollapsibleProps");
    expect(src).toContain("variant?: 'default' | 'bordered' | 'ghost'");
    expect(src).toContain("chevronSide?: 'left' | 'right'");
  });

  it("expand/collapse: toggle + controlled/uncontrolled + aria-expanded + Enter/Space keyboard + disabled opacity 0.5", () => {
    expect(src).toContain("const isControlled = controlledOpen !== undefined");
    expect(src).toContain("if (!isControlled) setInternal(next)");
    expect(src).toContain("onChange?.(next)");
    expect(src).toContain("aria-expanded={open}");
    expect(src).toContain("e.key === 'Enter' || e.key === ' '");
    expect(src).toContain("opacity: disabled ? 0.5 : 1");
  });

  it("animation: scrollHeight + requestAnimationFrame + height transition 0.27s cubic-bezier + setTimeout 280", () => {
    expect(src).toContain("el.scrollHeight");
    expect(src).toContain("requestAnimationFrame(()");
    expect(src).toContain("height 0.27s cubic-bezier(0.4,0,0.2,1)");
    expect(src).toContain("setTimeout(() => setHeight('auto'), 280)");
    expect(src).toContain("setTimeout(() => setVisible(false), 280)");
  });

  it("Chevron SVG: rotate(180deg)/rotate(0deg) + VARIANTS 3 stili + defaultOpen + visible state", () => {
    expect(src).toContain("function Chevron");
    expect(src).toContain("rotate(180deg)");
    expect(src).toContain("rotate(0deg)");
    expect(src).toContain("const VARIANTS");
    expect(src).toContain("defaultOpen = false");
    expect(src).toContain("const [visible, setVisible]");
  });
});

/* ── Dropdown ── */
describe("Dropdown", () => {
  const src = readSrc("components/Dropdown.tsx");

  it("export default Dropdown + DropdownProps + DropdownItem con id/label/icon/shortcut/disabled/danger + DropdownAlign", () => {
    expect(src).toMatch(/export default function Dropdown\b/);
    expect(src).toContain("export interface DropdownProps");
    expect(src).toContain("export interface DropdownItem");
    expect(src).toContain("export type DropdownAlign = 'left' | 'right'");
    expect(src).toContain("shortcut?: string");
    expect(src).toContain("danger?: boolean");
    expect(src).toContain("separator?: boolean");
  });

  it("open/close: trigger toggle + aria-haspopup menu + aria-expanded + click fuori chiude + string trigger ▾", () => {
    expect(src).toContain("setOpen(v => !v)");
    expect(src).toContain('aria-haspopup="menu"');
    expect(src).toContain("aria-expanded={open}");
    expect(src).toContain("!containerRef.current?.contains(e.target as Node)");
    expect(src).toContain("typeof trigger === 'string'");
  });

  it("select: handleSelect + onSelect callback + setOpen(false) + role menuitem + danger color-red", () => {
    expect(src).toContain("const handleSelect");
    expect(src).toContain("onSelect(item)");
    expect(src).toContain('role="menuitem"');
    expect(src).toContain("item.danger ? 'var(--color-red)'");
    expect(src).toContain('role="menu"');
  });

  it("keyboard: ArrowDown/Up navigazione + Enter seleziona + Escape chiude + Tab chiude + focusIdx state", () => {
    expect(src).toContain("e.key === 'ArrowDown'");
    expect(src).toContain("e.key === 'ArrowUp'");
    expect(src).toContain("e.key === 'Enter'");
    expect(src).toContain("e.key === 'Escape'");
    expect(src).toContain("e.key === 'Tab'");
    expect(src).toContain("const [focusIdx, setFocusIdx]");
    expect(src).toContain("!items[next]?.disabled");
  });
});
