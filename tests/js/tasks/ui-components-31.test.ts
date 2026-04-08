/** Test UI batch 31 — Truncate, CurrencyInput, TimeInput */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const COMP = path.resolve(__dirname, "../../../web/app/components");
function readSrc(name: string) {
  const raw = fs.readFileSync(path.join(COMP, name), "utf-8").replace(/\r\n/g, "\n");
  const singleQuoted = raw.replace(/"/g, "'");
  const squashed = singleQuoted.replace(/\s+/g, " ").trim();
  return [raw, singleQuoted, squashed].join("\n/* normalized */\n");
}

/* ── Truncate ── */
describe("Truncate", () => {
  const src = readSrc("Truncate.tsx");

  it("props: TruncateProps + lines default 3 + expandable + showTooltip + TruncateCellProps", () => {
    expect(src).toContain("export interface TruncateProps");
    expect(src).toContain("lines = 3");
    expect(src).toContain("expandable = true");
    expect(src).toContain("showTooltip = true");
    expect(src).toContain("export interface TruncateCellProps");
  });

  it("clamp: WebkitLineClamp + WebkitBoxOrient vertical + overflow hidden + ResizeObserver", () => {
    expect(src).toContain("WebkitLineClamp: lines");
    expect(src).toContain("WebkitBoxOrient: 'vertical'");
    expect(src).toContain("overflow: 'hidden'");
    expect(src).toContain("new ResizeObserver(check)");
  });

  it("expand: Mostra di più / Mostra meno + button toggle + setClamped scrollHeight > clientHeight", () => {
    expect(src).toContain("expandLabel = 'Mostra di più'");
    expect(src).toContain("collapseLabel = 'Mostra meno'");
    expect(src).toContain("setExpanded((e) => !e)");
    expect(src).toContain("setClamped(el.scrollHeight > el.clientHeight + 2)");
  });

  it("TruncateCell: maxWidth 240 + textOverflow ellipsis + useTruncated hook scrollWidth", () => {
    expect(src).toContain("export function TruncateCell");
    expect(src).toContain("maxWidth = 240");
    expect(src).toContain("textOverflow: 'ellipsis'");
    expect(src).toContain("export function useTruncated");
    expect(src).toContain("el.scrollWidth > el.clientWidth");
  });
});

/* ── CurrencyInput ── */
describe("CurrencyInput", () => {
  const src = readSrc("CurrencyInput.tsx");

  it("props: CurrencyInputProps + currency EUR + locale it-IT + size sm/md/lg", () => {
    expect(src).toContain("export interface CurrencyInputProps");
    expect(src).toContain("currency = 'EUR'");
    expect(src).toContain("locale = 'it-IT'");
    expect(src).toContain("size?:");
  });

  it("SYMBOLS 7 valute + formatDisplay Intl.NumberFormat + parseRaw thousand/decimal", () => {
    expect(src).toContain("const SYMBOLS: Record<string, string>");
    expect(src).toContain("EUR: '€'");
    expect(src).toContain("USD: '$'");
    expect(src).toContain("GBP: '£'");
    expect(src).toContain("new Intl.NumberFormat(locale");
    expect(src).toContain("function parseRaw");
  });

  it("input: inputMode decimal + aria-invalid + ArrowUp/ArrowDown increment + Enter blur", () => {
    expect(src).toContain("inputMode=\"decimal\"");
    expect(src).toContain("aria-invalid={!!error}");
    expect(src).toContain("e.key === 'ArrowUp'");
    expect(src).toContain("e.key === 'ArrowDown'");
    expect(src).toContain("e.key === 'Enter'");
  });

  it("render: symbol + SIZE_CLS/SYM_CLS + range hint min/max + error color-red", () => {
    expect(src).toContain("{symbol}");
    expect(src).toContain("const SIZE_CLS");
    expect(src).toContain("const SYM_CLS");
    expect(src).toContain("aria-label={label ?? `Importo in ${currency}`}");
    expect(src).toContain("color: 'var(--color-red)'");
  });
});

/* ── TimeInput ── */
describe("TimeInput", () => {
  const src = readSrc("TimeInput.tsx");

  it("props: TimeValue hours/minutes + format 12h/24h + minuteStep + placeholder --:--", () => {
    expect(src).toContain("export interface TimeValue");
    expect(src).toContain("hours: number");
    expect(src).toContain("minutes: number");
    expect(src).toContain("export interface TimeInputProps");
    expect(src).toContain("format?:");
    expect(src).toContain("minuteStep = 1");
    expect(src).toContain("placeholder = '--:--'");
  });

  it("helpers: pad padStart 2 + clampH 12/24 + clampM step + to12/from12 AM/PM", () => {
    expect(src).toContain("String(n).padStart(2, '0')");
    expect(src).toContain("function clampH");
    expect(src).toContain("function clampM");
    expect(src).toContain("function to12");
    expect(src).toContain("function from12");
    expect(src).toContain("ampm: 'AM'");
    expect(src).toContain("ampm: 'PM'");
  });

  it("Segment: ArrowUp/ArrowDown step + inputMode numeric + maxLength 2 + aria-label Ore/Minuti", () => {
    expect(src).toContain("function Segment");
    expect(src).toContain("e.key === 'ArrowUp'");
    expect(src).toContain("e.key === 'ArrowDown'");
    expect(src).toContain("inputMode=\"numeric\"");
    expect(src).toContain("maxLength={2}");
    expect(src).toContain("label=\"Ore\"");
    expect(src).toContain("label=\"Minuti\"");
  });

  it("AM/PM: toggleAmpm button + role group + Orario aria-label + border color-green focus", () => {
    expect(src).toContain("const toggleAmpm");
    expect(src).toContain("ampm === 'AM' ? 'PM' : 'AM'");
    expect(src).toContain("{ampm}");
    expect(src).toContain("role=\"group\"");
    expect(src).toContain("aria-label={label ?? 'Orario'}");
    expect(src).toContain("'var(--color-green)'");
  });
});
