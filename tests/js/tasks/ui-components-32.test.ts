/** Test UI batch 32 — InputSlider, PasswordStrength, ResizableColumns */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const COMP = path.resolve(__dirname, "../../../web/components");
function readSrc(name: string) {
  const raw = fs.readFileSync(path.join(COMP, name), "utf-8").replace(/\r\n/g, "\n");
  const singleQuoted = raw.replace(/"/g, "'");
  const squashed = singleQuoted.replace(/\s+/g, " ").trim();
  return [raw, singleQuoted, squashed].join("\n/* normalized */\n");
}

/* ── InputSlider ── */
describe("InputSlider", () => {
  const src = readSrc("InputSlider.tsx");

  it("props: InputSliderProps + min/max/step defaults + size sm/md/lg + ticks + unit", () => {
    expect(src).toContain("export interface InputSliderProps");
    expect(src).toContain("min = 0, max = 100, step = 1");
    expect(src).toContain("const SIZE_MAP");
    expect(src).toContain("ticks?: boolean");
    expect(src).toContain("unit?: string");
  });

  it("sync: controlled/uncontrolled + clamp round/step + commit + setInputVal + pct gradient", () => {
    expect(src).toContain("const isCtrl = ctrl !== undefined");
    expect(src).toContain("Math.round(v / step) * step");
    expect(src).toContain("const commit");
    expect(src).toContain("setInputVal(String(clamped))");
    expect(src).toContain("const pct = ((value - min) / (max - min)) * 100");
  });

  it("input: type range + type number + onBlur commit + Enter commit + jht-islider class", () => {
    expect(src).toContain("type=\"range\"");
    expect(src).toContain("type=\"number\"");
    expect(src).toContain("onBlur={() => commit(Number(inputVal))}");
    expect(src).toContain("e.key === 'Enter'");
    expect(src).toContain("className=\"jht-islider\"");
  });

  it("render: trackBg linear-gradient + tickCount + injectStyles thumb + disabled opacity 0.5", () => {
    expect(src).toContain("const trackBg = `linear-gradient(to right");
    expect(src).toContain("const tickCount = Math.floor((max - min) / step)");
    expect(src).toContain("function injectStyles");
    expect(src).toContain("-webkit-slider-thumb");
    expect(src).toContain("opacity: disabled ? 0.5 : 1");
  });
});

/* ── PasswordStrength ── */
describe("PasswordStrength", () => {
  const src = readSrc("PasswordStrength.tsx");

  it("props: StrengthCriterion + PasswordStrengthProps + showCriteria + showLabel + size", () => {
    expect(src).toContain("export interface StrengthCriterion");
    expect(src).toContain("export interface PasswordStrengthProps");
    expect(src).toContain("showCriteria = true");
    expect(src).toContain("showLabel = true");
    expect(src).toContain("size = 'md'");
  });

  it("DEFAULT_CRITERIA 4: 8 char + maiuscola + numero + speciale + scorePassword", () => {
    expect(src).toContain("const DEFAULT_CRITERIA");
    expect(src).toContain("Almeno 8 caratteri");
    expect(src).toContain("Lettera maiuscola");
    expect(src).toContain("Numero");
    expect(src).toContain("Carattere speciale");
    expect(src).toContain("function scorePassword");
  });

  it("LEVELS 4: Debole/Scarsa/Buona/Ottima + colori + segmenti filled + transition 0.3s", () => {
    expect(src).toContain("const LEVELS");
    expect(src).toContain("Debole");
    expect(src).toContain("Scarsa");
    expect(src).toContain("Buona");
    expect(src).toContain("Ottima");
    expect(src).toContain("transition: 'background 0.3s ease'");
  });

  it("render: SIZE_MAP segH/gap/font + checklist ✓ dot + level score mapping + current.label", () => {
    expect(src).toContain("const SIZE_MAP");
    expect(src).toContain("const score");
    expect(src).toContain("const level");
    expect(src).toContain("{current.label}");
    expect(src).toContain("{c.label}");
  });
});

/* ── ResizableColumns ── */
describe("ResizableColumns", () => {
  const src = readSrc("ResizableColumns.tsx");

  it("props: ColumnDef + ResizableColumnsProps + minWidth/maxWidth + storageKey + HANDLE_W", () => {
    expect(src).toContain("export interface ColumnDef");
    expect(src).toContain("export interface ResizableColumnsProps");
    expect(src).toContain("minWidth?: number");
    expect(src).toContain("maxWidth?: number");
    expect(src).toContain("storageKey?: string");
    expect(src).toContain("const HANDLE_W = 6");
  });

  it("drag: onMouseDown clientX + mousemove/mouseup + clampWidth min 60 + col-resize cursor", () => {
    expect(src).toContain("const onMouseDown");
    expect(src).toContain("ev.clientX - startX.current");
    expect(src).toContain("document.addEventListener('mousemove'");
    expect(src).toContain("document.addEventListener('mouseup'");
    expect(src).toContain("col.minWidth ?? 60");
    expect(src).toContain("cursor: 'col-resize'");
  });

  it("touch: onTouchStart + touches[0].clientX + touchmove/touchend + passive true", () => {
    expect(src).toContain("const onTouchStart");
    expect(src).toContain("e.touches[0].clientX");
    expect(src).toContain("document.addEventListener('touchmove'");
    expect(src).toContain("document.addEventListener('touchend'");
    expect(src).toContain("passive: true");
  });

  it("persist: loadWidths localStorage + resetWidths doubleClick + defaultWidth 200 + grip dots", () => {
    expect(src).toContain("function loadWidths");
    expect(src).toContain("localStorage.getItem(key)");
    expect(src).toContain("const resetWidths");
    expect(src).toContain("onDoubleClick={resetWidths}");
    expect(src).toContain("defaultWidth ?? 200");
    expect(src).toContain("Trascina per ridimensionare");
  });
});
