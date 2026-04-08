/** Test UI batch 11 — CommandPalette + Carousel */
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

/* ── CommandPalette ── */
describe("CommandPalette", () => {
  const src = readSrc("app/components/CommandPalette.tsx");

  it("export CommandPalette + useCommandPalette + Command + CommandPaletteProps", () => {
    expect(src).toMatch(/export function CommandPalette\b/);
    expect(src).toMatch(/export function useCommandPalette\b/);
    expect(src).toContain("export interface Command");
    expect(src).toContain("export interface CommandPaletteProps");
  });

  it("fuzzy match: query lowercase, indices tracking + Highlight mark green fontWeight 700", () => {
    expect(src).toContain("function fuzzy");
    expect(src).toContain("query.toLowerCase()"); expect(src).toContain("text.toLowerCase()");
    expect(src).toContain("indices.push(ti)"); expect(src).toContain("qi === q.length");
    expect(src).toContain("function Highlight"); expect(src).toContain("<mark");
    expect(src).toContain("var(--color-green)"); expect(src).toContain("fontWeight: 700");
  });

  it("gruppi: Map<string, Matched[]> + group label uppercase tracking-widest", () => {
    expect(src).toContain("new Map<string, Matched[]>()");
    expect(src).toContain("c.group ?? ''"); expect(src).toContain("map.get(g)!.push(c)");
    expect(src).toContain("tracking-widest uppercase");
  });

  it("keyboard: ArrowDown/ArrowUp/Enter + scrollIntoView data-idx + Escape chiude", () => {
    expect(src).toContain("'ArrowDown'"); expect(src).toContain("'ArrowUp'"); expect(src).toContain("'Enter'");
    expect(src).toContain("e.key === 'Escape'");
    expect(src).toContain("scrollIntoView"); expect(src).toContain("data-idx");
  });

  it("role='dialog' aria-modal + overlay click + 'Nessun risultato' + cp-in animation", () => {
    expect(src).toContain('role="dialog"'); expect(src).toContain('aria-modal="true"');
    expect(src).toContain('aria-label="Palette comandi"');
    expect(src).toContain("Nessun risultato"); expect(src).toContain("cp-in");
    expect(src).toContain("scale(0.96)");
  });

  it("footer hints: ↑↓ naviga, ↵ seleziona, esc chiudi + shortcut kbd + placeholder 'Cerca comandi…'", () => {
    expect(src).toContain("naviga"); expect(src).toContain("seleziona"); expect(src).toContain("chiudi");
    expect(src).toContain("cmd.shortcut"); expect(src).toContain("Cerca comandi…");
  });

  it("useCommandPalette: Ctrl+K / metaKey+K toggle + returns open/setOpen/onClose", () => {
    expect(src).toContain("e.ctrlKey || e.metaKey"); expect(src).toContain("e.key === 'k'");
    expect(src).toContain("e.preventDefault()"); expect(src).toContain("setOpen(v => !v)");
    expect(src).toContain("onClose: () => setOpen(false)");
  });
});

/* ── Carousel ── */
describe("Carousel", () => {
  const src = readSrc("components/Carousel.tsx");

  it("export default Carousel + CarouselProps interface", () => {
    expect(src).toMatch(/export default function Carousel\b/);
    expect(src).toContain("export interface CarouselProps");
  });

  it("props: autoPlay, interval 3000, showDots, showArrows, infinite, slidesPerView 1-4", () => {
    expect(src).toContain("autoPlay?: boolean"); expect(src).toContain("interval?: number");
    expect(src).toContain("showDots?: boolean"); expect(src).toContain("showArrows?: boolean");
    expect(src).toContain("infinite?: boolean"); expect(src).toContain("slidesPerView?: number");
    expect(src).toContain("autoPlay = false"); expect(src).toContain("interval = 3000");
    expect(src).toContain("infinite = true"); expect(src).toContain("slidesPerView = 1");
  });

  it("clamp: infinite modulo + non-infinite Math.max/min + goTo/prev/next callbacks", () => {
    expect(src).toContain("const clamp"); expect(src).toContain("((n % total) + total) % total");
    expect(src).toContain("Math.max(0, Math.min(total - slidesPerView, n))");
    expect(src).toContain("const goTo"); expect(src).toContain("const prev"); expect(src).toContain("const next");
  });

  it("autoPlay: setInterval/clearInterval + resetAuto riavvia timer", () => {
    expect(src).toContain("setInterval(next, interval)");
    expect(src).toContain("clearInterval(autoRef.current)");
    expect(src).toContain("const resetAuto");
  });

  it("touch swipe: touchStart/Move/End + threshold 40px + mouse drag desktop", () => {
    expect(src).toContain("onTouchStart"); expect(src).toContain("onTouchMove"); expect(src).toContain("onTouchEnd");
    expect(src).toContain("Math.abs(touchDelta.current) > 40");
    expect(src).toContain("onMouseDown"); expect(src).toContain("onMouseUp");
    expect(src).toContain("cursor: dragging ? 'grabbing' : 'grab'");
  });

  it("arrows: prev ‹ / next › + disabled atStart/atEnd (non-infinite) + absolute center", () => {
    expect(src).toContain("showArrows && total > 1");
    expect(src).toContain("atStart"); expect(src).toContain("atEnd");
    expect(src).toContain("!infinite && current === 0"); // atStart
    expect(src).toContain("!infinite && current >= total - slidesPerView"); // atEnd
    expect(src).toContain("translateY(-50%)"); // center vertically
  });

  it("dots: active green wider (16→6px) + transition width + translateX slideW%", () => {
    expect(src).toContain("showDots && total > 1");
    expect(src).toContain("i === current ? 16 : 6"); // active dot wider
    expect(src).toContain("var(--color-green)"); // active color
    expect(src).toContain("transition: 'width 0.2s ease");
    expect(src).toContain("100 / slidesPerView"); // slideW
    expect(src).toContain("-(current * slideW)"); // translateX
  });
});
