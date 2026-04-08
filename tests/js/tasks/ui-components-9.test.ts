/** Test UI batch 9 — RadioGroup + RadioCardGroup, TextArea + CharCount + CodeArea */
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

/* ── RadioGroup ── */
describe("RadioGroup", () => {
  const src = readSrc("app/components/RadioGroup.tsx");

  it("export RadioGroup + RadioCardGroup + tipi RadioSize + RadioOption + RadioGroupProps", () => {
    expect(src).toMatch(/export function RadioGroup\b/);
    expect(src).toMatch(/export function RadioCardGroup\b/);
    expect(src).toContain("export type RadioSize");
    expect(src).toContain("export interface RadioOption");
    expect(src).toContain("export interface RadioGroupProps");
  });

  it("RadioSize sm/md/lg + OUTER_PX + INNER_PX + LABEL_CLS + DESC_CLS maps", () => {
    expect(src).toContain("OUTER_PX"); expect(src).toContain("INNER_PX");
    expect(src).toContain("LABEL_CLS"); expect(src).toContain("DESC_CLS");
    expect(src).toContain("sm: 14"); expect(src).toContain("md: 16"); expect(src).toContain("lg: 20");
  });

  it("RadioItem: hidden input sr-only + aria-checked + custom circle green + radio-pop", () => {
    expect(src).toContain("function RadioItem");
    expect(src).toContain('type="radio"'); expect(src).toContain('className="sr-only"');
    expect(src).toContain("aria-checked={checked}");
    expect(src).toContain("var(--color-green)"); expect(src).toContain("radio-pop");
    expect(src).toContain("scale(1.2)"); // bounce animation
  });

  it("orientation vertical/horizontal + role='radiogroup' + aria-label", () => {
    expect(src).toContain("orientation?: 'vertical' | 'horizontal'");
    expect(src).toContain('role="radiogroup"'); expect(src).toContain("aria-label={label}");
    expect(src).toContain("flex-row flex-wrap"); expect(src).toContain("flex-col gap-2");
  });

  it("disabled: opacity-45 + cursor-not-allowed + color dim", () => {
    expect(src).toContain("opacity-45"); expect(src).toContain("cursor-not-allowed");
    expect(src).toContain("disabled ? 'var(--color-dim)' : 'var(--color-bright)'");
  });

  it("useId per name automatico + label group uppercase + error message", () => {
    expect(src).toContain("useId"); expect(src).toContain("name ?? autoName");
    expect(src).toContain("tracking-widest uppercase");
    expect(src).toContain("var(--color-red)"); expect(src).toContain("{error}");
  });

  it("RadioCardGroup: grid cols 2/3/4 + card selezionabile con border green", () => {
    expect(src).toContain("CARD_COLS");
    expect(src).toContain("grid-cols-2"); expect(src).toContain("grid-cols-3"); expect(src).toContain("grid-cols-4");
    expect(src).toContain("value === opt.value"); // selected check
    expect(src).toContain("rounded-lg border");
  });
});

/* ── TextArea ── */
describe("TextArea", () => {
  const src = readSrc("app/components/TextArea.tsx");

  it("export TextArea + CharCount + CodeArea + tipi ResizeMode + TextAreaProps", () => {
    expect(src).toMatch(/export function TextArea\b/);
    expect(src).toMatch(/export function CharCount\b/);
    expect(src).toMatch(/export function CodeArea\b/);
    expect(src).toContain("export type ResizeMode");
    expect(src).toContain("export interface TextAreaProps");
  });

  it("TextAreaProps extends Omit<TextareaHTMLAttributes, 'onChange'> + ResizeMode 4 valori", () => {
    expect(src).toContain("export interface TextAreaProps extends Omit<");
    expect(src).toContain("TextareaHTMLAttributes<HTMLTextAreaElement>");
    expect(src).toContain("'onChange'");
    expect(src).toContain("'none' | 'vertical' | 'horizontal' | 'both'");
  });

  it("autoResize: useRef + useEffect scrollHeight + resize none + minHeight 80 + overflow hidden", () => {
    expect(src).toContain("useRef"); expect(src).toContain("useEffect");
    expect(src).toContain("ref.current.scrollHeight");
    expect(src).toContain("autoResize ? 'none' : resize");
    expect(src).toContain("autoResize ? 80 : undefined"); // minHeight
    expect(src).toContain("autoResize ? 'hidden' : undefined"); // overflowY
  });

  it("maxLength contatore: count/maxLength + overLimit → border red + colore red", () => {
    expect(src).toContain("count > maxLength");
    expect(src).toContain("{count}/{maxLength}");
    expect(src).toContain("overLimit ? 'var(--color-red)' : 'var(--color-dim)'");
    expect(src).toContain("tabular-nums");
  });

  it("accessibility: aria-invalid + aria-describedby + label htmlFor + useId", () => {
    expect(src).toContain("aria-invalid={!!(error || overLimit)}");
    expect(src).toContain("aria-describedby={help ?");
    expect(src).toContain("htmlFor={fieldId}"); expect(src).toContain("useId");
  });

  it("focus/blur border + error/help messaggio + disabled opacity", () => {
    expect(src).toContain("onFocus={(e) => {"); expect(src).toContain("onBlur={(e) => {");
    expect(src).toContain("focusColor"); expect(src).toContain("borderColor");
    expect(src).toContain("error ?? help"); // error prioritario
    expect(src).toContain("opacity-45"); expect(src).toContain("cursor-not-allowed");
  });

  it("CharCount: progress bar + color thresholds (green/yellow/red) + pct", () => {
    expect(src).toContain("Math.min(current / max, 1)");
    expect(src).toContain("pct > 0.85"); // yellow threshold
    expect(src).toContain("var(--color-yellow)"); expect(src).toContain("var(--color-green)");
    expect(src).toContain("`${pct * 100}%`"); // progress width
  });

  it("CodeArea: spellCheck false + autoCapitalize/autoCorrect off + tabSize 2", () => {
    expect(src).toContain("spellCheck={false}");
    expect(src).toContain('autoCapitalize="off"'); expect(src).toContain('autoCorrect="off"');
    expect(src).toContain("tabSize: 2");
    expect(src).toContain('resize="vertical"');
  });
});
