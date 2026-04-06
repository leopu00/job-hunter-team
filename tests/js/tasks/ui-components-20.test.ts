/** Test UI batch 20 — EmojiPicker, ConfettiAnimation, ColorPicker */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
function readSrc(rel: string) { return fs.readFileSync(path.join(WEB, rel), "utf-8"); }

/* ── EmojiPicker ── */
describe("EmojiPicker", () => {
  const src = readSrc("components/EmojiPicker.tsx");

  it("export default EmojiPicker + EmojiPickerProps + CATEGORIES 8 categorie", () => {
    expect(src).toMatch(/export default function EmojiPicker\b/);
    expect(src).toContain("export interface EmojiPickerProps");
    expect(src).toContain("const CATEGORIES");
    for (const c of ["recenti", "sorrisi", "persone", "animali", "cibo", "viaggi", "oggetti", "simboli"])
      expect(src).toContain(`${c}:`);
  });

  it("search: input Cerca emoji + filtro includes + Nessun risultato fallback", () => {
    expect(src).toContain('placeholder="Cerca emoji..."');
    expect(src).toContain("e.includes(search)");
    expect(src).toContain("Nessun risultato");
  });

  it("recents: localStorage LS_KEY + MAX_RECENTS 18 + select aggiorna recenti + click fuori chiude", () => {
    expect(src).toContain("const LS_KEY = 'emoji_recents'");
    expect(src).toContain("const MAX_RECENTS = 18");
    expect(src).toContain("localStorage.setItem(LS_KEY, JSON.stringify(next))");
    expect(src).toContain("setOpen(false)");
    expect(src).toContain("!ref.current?.contains(e.target as Node)");
  });

  it("grid 8 colonne + category tabs con icon + trigger default 😀", () => {
    expect(src).toContain("repeat(8, 1fr)");
    expect(src).toContain("setCat(key as CategoryKey)");
    expect(src).toContain("😀</button>");
  });
});

/* ── ConfettiAnimation ── */
describe("ConfettiAnimation", () => {
  const src = readSrc("components/ConfettiAnimation.tsx");

  it("export default ConfettiAnimation + ConfettiAnimationProps + useConfetti hook", () => {
    expect(src).toMatch(/export default function ConfettiAnimation\b/);
    expect(src).toContain("export interface ConfettiAnimationProps");
    expect(src).toMatch(/export function useConfetti\b/);
  });

  it("Particle: 3 shape rect/circle/ribbon + COLORS 8 + makeParticle + drawParticle", () => {
    expect(src).toContain("interface Particle");
    expect(src).toContain("'rect' | 'circle' | 'ribbon'");
    expect(src).toContain("const COLORS");
    expect(src).toContain("function makeParticle");
    expect(src).toContain("function drawParticle");
  });

  it("burst 120 particelle + gravità 0.08 + attrito 0.995 + fade alpha dopo 55%", () => {
    expect(src).toContain("for (let i = 0; i < 120; i++)");
    expect(src).toContain("p.vy += 0.08");
    expect(src).toContain("p.vx *= 0.995");
    expect(src).toContain("duration * 0.55");
  });

  it("duration default 3000 + requestAnimationFrame loop + onDone callback + canvas fixed z-9999", () => {
    expect(src).toContain("duration = 3000");
    expect(src).toContain("requestAnimationFrame(tick)");
    expect(src).toContain("cancelAnimationFrame");
    expect(src).toContain("onDone()");
    expect(src).toContain("zIndex: 9999");
    expect(src).toContain("pointerEvents: 'none'");
  });
});

/* ── ColorPicker ── */
describe("ColorPicker", () => {
  const src = readSrc("components/ColorPicker.tsx");

  it("export default ColorPicker + ColorPickerProps + PALETTE 12 + isValidHex + contrastColor", () => {
    expect(src).toMatch(/export default function ColorPicker\b/);
    expect(src).toContain("export interface ColorPickerProps");
    expect(src).toContain("const PALETTE");
    expect(src).toContain("function isValidHex");
    expect(src).toContain("/^#[0-9a-fA-F]{6}$/");
    expect(src).toContain("function contrastColor");
  });

  it("hex input: handleHexChange validazione + handleHexBlur reset + maxLength 7 + placeholder #000000", () => {
    expect(src).toContain("const handleHexChange");
    expect(src).toContain("const handleHexBlur");
    expect(src).toContain("maxLength={7}");
    expect(src).toContain('placeholder="#000000"');
    expect(src).toContain("hexError ? 'var(--color-red)'");
  });

  it("palette grid 6 colonne + swatch preview + selected scale(1.15) + click fuori chiude", () => {
    expect(src).toContain("repeat(6,1fr)");
    expect(src).toContain("scale(1.15)");
    expect(src).toContain("scale(1)");
    expect(src).toContain("!containerRef.current?.contains(e.target as Node)");
  });

  it("contrastColor: luminosità r*299+g*587+b*114 + conferma hex button ✓ + disabled opacity 0.5", () => {
    expect(src).toContain("r*299 + g*587 + b*114");
    expect(src).toContain("✓");
    expect(src).toContain("opacity: disabled ? 0.5 : 1");
  });
});
