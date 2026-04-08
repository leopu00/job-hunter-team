/** Test UI batch 30 — Highlight, PinInput, SpeedDial */
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

/* ── Highlight ── */
describe("Highlight", () => {
  const src = readSrc("app/components/Highlight.tsx");

  it("export Highlight + HighlightList + useHighlight + HighlightProps + query string|string[]", () => {
    expect(src).toMatch(/export function Highlight\b/);
    expect(src).toMatch(/export function HighlightList\b/);
    expect(src).toMatch(/export function useHighlight\b/);
    expect(src).toContain("export interface HighlightProps");
    expect(src).toContain("query: string | string[]");
  });

  it("match: buildChunks + escapeRegex + Chunk interface start/end/highlight + <mark> tag + borderRadius 2", () => {
    expect(src).toContain("function buildChunks");
    expect(src).toContain("function escapeRegex");
    expect(src).toContain("interface Chunk");
    expect(src).toContain("start: number; end: number; highlight: boolean");
    expect(src).toContain("<mark");
    expect(src).toContain("borderRadius: 2");
  });

  it("case-insensitive: caseSensitive default false + flags g/gi + wholeWord \\b boundary", () => {
    expect(src).toContain("caseSensitive = false");
    expect(src).toContain("caseSensitive ? 'g' : 'gi'");
    expect(src).toContain("wholeWord = false");
    expect(src).toContain("`\\\\b${t}\\\\b`");
  });

  it("multi-match: queries join | + merge overlapping ranges + HighlightList fields + useHighlight hasMatch", () => {
    expect(src).toContain("escaped.join('|')");
    expect(src).toContain("// Merge range sovrapposti");
    expect(src).toContain("last[1] = Math.max(last[1], ranges[i][1])");
    expect(src).toContain("export interface HighlightListProps");
    expect(src).toContain("fields:");
    expect(src).toContain("const hasMatch = chunks.some((c) => c.highlight)");
  });
});

/* ── PinInput ── */
describe("PinInput", () => {
  const src = readSrc("components/PinInput.tsx");

  it("export default PinInput + PinInputProps + length 4|5|6 + controlled/uncontrolled + SIZE_MAP 3", () => {
    expect(src).toMatch(/export default function PinInput\b/);
    expect(src).toContain("export interface PinInputProps");
    expect(src).toContain("length?: 4 | 5 | 6");
    expect(src).toContain("const isCtrl = ctrl !== undefined");
    expect(src).toContain("const SIZE_MAP");
  });

  it("auto-advance: handleChange focus(i+1) + commit clean + onComplete quando length raggiunto + inputMode numeric", () => {
    expect(src).toContain("const handleChange");
    expect(src).toContain("focus(i + 1)");
    expect(src).toContain("const commit");
    expect(src).toContain("clean.length === length) onComplete?.(clean)");
    expect(src).toContain('inputMode="numeric"');
  });

  it("masked: type password/text + Backspace/Delete/ArrowLeft/ArrowRight keyboard + invalid border red", () => {
    expect(src).toContain("masked ? 'password' : 'text'");
    expect(src).toContain("e.key === 'Backspace'");
    expect(src).toContain("e.key === 'Delete'");
    expect(src).toContain("e.key === 'ArrowLeft'");
    expect(src).toContain("e.key === 'ArrowRight'");
    expect(src).toContain("invalid ? 'var(--color-red");
  });

  it("paste: handlePaste clipboardData replace \\D + autoFocus + disabled opacity 0.5 + caretColor transparent", () => {
    expect(src).toContain("const handlePaste");
    expect(src).toContain("e.clipboardData.getData('text')");
    expect(src).toContain(".replace(/\\D/g, '')");
    expect(src).toContain("if (autoFocus) refs.current[0]?.focus()");
    expect(src).toContain("opacity: disabled ? 0.5 : 1");
    expect(src).toContain("caretColor: 'transparent'");
  });
});

/* ── SpeedDial ── */
describe("SpeedDial", () => {
  const src = readSrc("app/components/SpeedDial.tsx");

  it("export SpeedDial + SpeedDialProps + SpeedDialAction + 4 direction + 5 position", () => {
    expect(src).toMatch(/export function SpeedDial\b/);
    expect(src).toContain("export interface SpeedDialProps");
    expect(src).toContain("export interface SpeedDialAction");
    expect(src).toContain("direction?: 'up' | 'down' | 'left' | 'right'");
    expect(src).toContain("'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'relative'");
  });

  it("open: FAB toggle + rotate(135deg) + aria-expanded + sd-in animation stagger i*0.04", () => {
    expect(src).toContain("setOpen((o) => !o)");
    expect(src).toContain("rotate(135deg)");
    expect(src).toContain("aria-expanded={open}");
    expect(src).toContain("@keyframes sd-in");
    expect(src).toContain("i * 0.04");
  });

  it("action: onClick + setOpen(false) + disabled 0.45 + aria-label + mini button size*0.72", () => {
    expect(src).toContain("action.onClick(); setOpen(false)");
    expect(src).toContain("opacity: action.disabled ? 0.45 : 1");
    expect(src).toContain("aria-label={action.label}");
    expect(src).toContain("size * 0.72");
  });

  it("close: mousedown outside + Escape keydown + POS_STYLE 5 + itemOffset + labelSide 4", () => {
    expect(src).toContain("!ref.current?.contains(e.target as Node)");
    expect(src).toContain("e.key === 'Escape'");
    expect(src).toContain("const POS_STYLE");
    expect(src).toContain("function itemOffset");
    expect(src).toContain("const labelSide");
  });
});
