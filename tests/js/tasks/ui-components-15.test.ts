/** Test UI batch 15 — ResizablePanel, Masonry, Popconfirm, NumberInput */
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

/* ── ResizablePanel ── */
describe("ResizablePanel", () => {
  const src = readSrc("components/ResizablePanel.tsx");

  it("export default + ResizeDirection + ResizablePanelProps", () => {
    expect(src).toMatch(/export default function ResizablePanel\b/);
    expect(src).toContain("export type ResizeDirection");
    expect(src).toContain("export interface ResizablePanelProps");
    expect(src).toContain("'horizontal' | 'vertical'");
  });

  it("props: first/second, defaultSize=50, minSize=15, maxSize=85, onResize, height", () => {
    expect(src).toContain("defaultSize = 50");
    expect(src).toContain("minSize = 15");
    expect(src).toContain("maxSize = 85");
    expect(src).toContain("onResize?.(clamped)");
    expect(src).toContain("height = '100%'");
  });

  it("mouse drag: mousemove/mouseup + touch: touchmove/touchend passive:false", () => {
    expect(src).toContain("window.addEventListener('mousemove', onMove)");
    expect(src).toContain("window.addEventListener('mouseup', onUp)");
    expect(src).toContain("window.addEventListener('touchmove', onMove, { passive: false })");
    expect(src).toContain("window.addEventListener('touchend', onEnd)");
  });

  it("doubleClick reset + clamp min/max + cursor col-resize/row-resize + grip lines 3", () => {
    expect(src).toContain("onDoubleClick");
    expect(src).toContain("setSize(defaultSize)");
    expect(src).toContain("Math.min(maxSize, Math.max(minSize, v))");
    expect(src).toContain("col-resize");
    expect(src).toContain("row-resize");
    expect(src).toContain("Array.from({ length: 3 })");
  });

  it("userSelect none durante drag + handle green on drag + hover rgba", () => {
    expect(src).toContain("userSelect = dragging ? 'none' : ''");
    expect(src).toContain("dragging ? 'var(--color-green)' : 'var(--color-border)'");
    expect(src).toContain("rgba(0,232,122,0.4)");
  });
});

/* ── Masonry ── */
describe("Masonry", () => {
  const src = readSrc("components/Masonry.tsx");

  it("export default Masonry + MasonryColumns + MasonryProps + useBreakpoint", () => {
    expect(src).toMatch(/export default function Masonry\b/);
    expect(src).toContain("export interface MasonryColumns");
    expect(src).toContain("export interface MasonryProps");
    expect(src).toMatch(/export function useBreakpoint\b/);
  });

  it("responsive breakpoints: sm < 640, md < 1024, lg >= 1024", () => {
    expect(src).toContain("w < 640");
    expect(src).toContain("w < 1024");
    expect(src).toContain("sm = 1, md = 2, lg = 3");
  });

  it("Children.toArray + ResizeObserver + offsetHeight + shortest column", () => {
    expect(src).toContain("Children.toArray(children)");
    expect(src).toContain("new ResizeObserver");
    expect(src).toContain("el?.offsetHeight");
    expect(src).toContain("Math.min(...colHeights)");
  });

  it("grid layout repeat(cols, 1fr) + gap + opacity ready transition", () => {
    expect(src).toContain("repeat(${cols}, 1fr)");
    expect(src).toContain("opacity: ready ? 1 : 0");
    expect(src).toContain("transition: 'opacity 0.2s ease'");
  });
});

/* ── Popconfirm ── */
describe("Popconfirm", () => {
  const src = readSrc("app/components/Popconfirm.tsx");

  it("export Popconfirm + PopconfirmPlacement 4 + PopconfirmProps + usePopconfirm", () => {
    expect(src).toMatch(/export function Popconfirm\b/);
    expect(src).toContain("export type PopconfirmPlacement");
    expect(src).toContain("export interface PopconfirmProps");
    expect(src).toMatch(/export function usePopconfirm\b/);
    expect(src).toContain("'top' | 'bottom' | 'left' | 'right'");
  });

  it("getPlacementStyle GAP=10 + 4 posizionamenti + arrow rotate(45deg)", () => {
    expect(src).toContain("const GAP = 10");
    expect(src).toContain("placement === 'top'");
    expect(src).toContain("placement === 'bottom'");
    expect(src).toContain("placement === 'left'");
    expect(src).toContain("rotate(45deg)");
  });

  it("ESC chiude + click outside cancel + confirmLabel Sì + cancelLabel No", () => {
    expect(src).toContain("e.key === 'Escape'");
    expect(src).toContain("panelRef.current?.contains(e.target as Node)");
    expect(src).toContain("confirmLabel = 'Sì'");
    expect(src).toContain("cancelLabel = 'No'");
  });

  it("danger: red button + default: green + role=dialog + animation pcf-in", () => {
    expect(src).toContain("background: 'var(--color-red)'");
    expect(src).toContain("background: 'var(--color-green)'");
    expect(src).toContain('role="dialog"');
    expect(src).toContain("@keyframes pcf-in");
    expect(src).toContain("animation: 'pcf-in 0.15s ease both'");
  });
});

/* ── NumberInput ── */
describe("NumberInput", () => {
  const src = readSrc("app/components/NumberInput.tsx");

  it("export NumberInput + NumberInputSize 3 + NumberInputProps + SIZE_CLS/BTN_CLS/ADDON_CLS", () => {
    expect(src).toMatch(/export function NumberInput\b/);
    expect(src).toContain("export type NumberInputSize");
    expect(src).toContain("export interface NumberInputProps");
    expect(src).toContain("'sm' | 'md' | 'lg'");
    expect(src).toContain("SIZE_CLS"); expect(src).toContain("BTN_CLS"); expect(src).toContain("ADDON_CLS");
  });

  it("clampRound: Math.pow(10, precision) + Math.round + Math.max(min) + Math.min(max)", () => {
    expect(src).toContain("function clampRound");
    expect(src).toContain("Math.pow(10, precision)");
    expect(src).toContain("Math.round(v * factor) / factor");
  });

  it("hold to repeat: 400ms delay + acceleration Math.max(50, speed - 10)", () => {
    expect(src).toContain("startHold");
    expect(src).toContain("}, 400)");
    expect(src).toContain("speed = Math.max(50, speed - 10)");
  });

  it("keyboard ArrowUp/Down + stepper −/+ + prefix/suffix addon + error red", () => {
    expect(src).toContain("e.key === 'ArrowUp'");
    expect(src).toContain("e.key === 'ArrowDown'");
    expect(src).toContain("'Decrementa' ? '−' : '+'");
    expect(src).toContain("prefix");
    expect(src).toContain("suffix");
    expect(src).toContain("color: 'var(--color-red)'");
  });
});
