/** Test UI batch 23 — Rating, AvatarGroup, SpeedDial */
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

/* ── Rating ── */
describe("Rating", () => {
  const src = readSrc("components/Rating.tsx");

  it("export default Rating + RatingProps + RatingSize sm/md/lg + SIZE_MAP 3 taglie", () => {
    expect(src).toMatch(/export default function Rating\b/);
    expect(src).toContain("export interface RatingProps");
    expect(src).toContain("export type RatingSize = 'sm' | 'md' | 'lg'");
    expect(src).toContain("const SIZE_MAP");
    for (const s of ["sm", "md", "lg"]) expect(src).toContain(`${s}:`);
  });

  it("star click: handleClick + getStarValue + toggle reset a 0 + half mezzo star via rect.width/2", () => {
    expect(src).toContain("const handleClick");
    expect(src).toContain("const getStarValue");
    expect(src).toContain("value === v ? 0 : v");
    expect(src).toContain("rect.width / 2");
    expect(src).toContain("starIdx - 0.5");
  });

  it("hover: handleMouseMove + setHover + displayed = hover ?? value + onMouseLeave reset null", () => {
    expect(src).toContain("const handleMouseMove");
    expect(src).toContain("setHover(getStarValue(starIdx, e))");
    expect(src).toContain("const displayed = hover ?? value");
    expect(src).toContain("setHover(null)");
  });

  it("readonly: role slider/img + keyboard ArrowRight/Left/Home/End + Star SVG clipPath fill + showValue", () => {
    expect(src).toContain("role={isInteractive ? 'slider' : 'img'}");
    expect(src).toContain("e.key === 'ArrowRight'");
    expect(src).toContain("e.key === 'ArrowLeft'");
    expect(src).toContain("e.key === 'Home'");
    expect(src).toContain("e.key === 'End'");
    expect(src).toContain("function Star");
    expect(src).toContain("<clipPath id={id}>");
    expect(src).toContain("showValue &&");
  });
});

/* ── AvatarGroup ── */
describe("AvatarGroup", () => {
  const src = readSrc("app/components/AvatarGroup.tsx");

  it("export AvatarGroup + AvatarGroupProps + AvatarGroupItem + AvatarGroupSize sm/md/lg", () => {
    expect(src).toMatch(/export function AvatarGroup\b/);
    expect(src).toContain("export interface AvatarGroupProps");
    expect(src).toContain("export interface AvatarGroupItem");
    expect(src).toContain("export type AvatarGroupSize = 'sm' | 'md' | 'lg'");
  });

  it("overflow +N: max default 4 + items.slice(0, max) visible + items.slice(max) overflow + OverflowBadge +count", () => {
    expect(src).toContain("max = 4");
    expect(src).toContain("items.slice(0, max)");
    expect(src).toContain("items.slice(max)");
    expect(src).toContain("function OverflowBadge");
    expect(src).toContain("+{count}");
    expect(src).toContain("overflow.length > 0");
  });

  it("SIZE_MAP 3 taglie + spacing overlap default -8 + zIndex decrescente + boxShadow ring", () => {
    expect(src).toContain("const SIZE_MAP");
    expect(src).toContain("spacing = -8");
    expect(src).toContain("zIndex={visible.length - i}");
    expect(src).toContain("boxShadow: '0 0 0 2px var(--color-card)'");
  });

  it("Tooltip: AvatarItem + Tip component + showTooltip default true + overflow names lista", () => {
    expect(src).toContain("function AvatarItem");
    expect(src).toContain("function Tip");
    expect(src).toContain("showTooltip = true");
    expect(src).toContain("overflow.map((o) => o.name");
  });
});

/* ── SpeedDial ── */
describe("SpeedDial", () => {
  const src = readSrc("app/components/SpeedDial.tsx");

  it("export SpeedDial + SpeedDialProps + SpeedDialAction + direction 4 + position 5", () => {
    expect(src).toMatch(/export function SpeedDial\b/);
    expect(src).toContain("export interface SpeedDialProps");
    expect(src).toContain("export interface SpeedDialAction");
    expect(src).toContain("direction?: 'up' | 'down' | 'left' | 'right'");
    expect(src).toContain("'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'relative'");
  });

  it("open/close: FAB toggle + icon default '+' + iconOpen '✕' + rotate(135deg) + aria-expanded", () => {
    expect(src).toContain("setOpen((o) => !o)");
    expect(src).toContain("icon = '+'");
    expect(src).toContain("iconOpen = '✕'");
    expect(src).toContain("rotate(135deg)");
    expect(src).toContain("aria-expanded={open}");
    expect(src).toContain("Chiudi menu");
    expect(src).toContain("Apri menu azioni");
  });

  it("action click: onClick + setOpen(false) + disabled opacity 0.45 + sd-in animation stagger", () => {
    expect(src).toContain("action.onClick(); setOpen(false)");
    expect(src).toContain("opacity: action.disabled ? 0.45 : 1");
    expect(src).toContain("@keyframes sd-in");
    expect(src).toContain("sd-in 0.15s ease");
    expect(src).toContain("i * 0.04");
  });

  it("outside dismiss: mousedown contains + ESC keydown + POS_STYLE 5 posizioni + itemOffset helper", () => {
    expect(src).toContain("!ref.current?.contains(e.target as Node)");
    expect(src).toContain("e.key === 'Escape'");
    expect(src).toContain("const POS_STYLE");
    expect(src).toContain("function itemOffset");
    expect(src).toContain("const labelSide");
  });
});
