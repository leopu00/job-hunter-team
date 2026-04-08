/** Test UI batch 8 — Checkbox + CheckboxGroup (RadioGroup non esiste) */
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

/* ── Checkbox ── */
describe("Checkbox", () => {
  const src = readSrc("app/components/Checkbox.tsx");

  it("export Checkbox + CheckboxGroup + tipi CheckboxSize + 3 interface", () => {
    expect(src).toMatch(/export function Checkbox\b/);
    expect(src).toMatch(/export function CheckboxGroup\b/);
    expect(src).toContain("export type CheckboxSize");
    expect(src).toContain("export interface CheckboxProps");
    expect(src).toContain("export interface CheckboxOption");
    expect(src).toContain("export interface CheckboxGroupProps");
  });

  it("CheckboxSize sm/md/lg + BOX_SIZE + LABEL_CLS + DESC_CLS maps", () => {
    expect(src).toContain("BOX_SIZE"); expect(src).toContain("LABEL_CLS"); expect(src).toContain("DESC_CLS");
    for (const s of ["sm", "md", "lg"]) expect(src).toContain(`${s}:`);
    expect(src).toContain("sm: 14"); expect(src).toContain("md: 16"); expect(src).toContain("lg: 20");
  });

  it("indeterminate: useRef + useEffect sync + aria-checked='mixed'", () => {
    expect(src).toContain("useRef"); expect(src).toContain("useEffect");
    expect(src).toContain("inputRef.current.indeterminate = indeterminate");
    expect(src).toContain("aria-checked={indeterminate ? 'mixed' : checked}");
  });

  it("custom box: SVG checkmark polyline + SVG dash per indeterminate + cb-pop animation", () => {
    expect(src).toContain("cb-pop"); expect(src).toContain("cb-mark");
    expect(src).toContain("polyline"); // checkmark
    expect(src).toContain('x1="2"');
    expect(src).toContain('y1="5"');
    expect(src).toContain('x2="8"');
    expect(src).toContain('y2="5"'); // dash
    expect(src).toContain("scale(1.15)"); // bounce
  });

  it("accessibility: hidden input sr-only + htmlFor + aria-invalid + useId", () => {
    expect(src).toContain('type="checkbox"'); expect(src).toContain('className="sr-only"');
    expect(src).toContain("htmlFor={fieldId}"); expect(src).toContain("useId");
    expect(src).toContain("aria-invalid={!!error}");
  });

  it("disabled: opacity-45 + cursor-not-allowed + color dim", () => {
    expect(src).toContain("opacity-45"); expect(src).toContain("cursor-not-allowed");
    expect(src).toContain("disabled ? 'var(--color-dim)' : 'var(--color-bright)'");
  });

  it("error state: border red + error message con marginLeft", () => {
    expect(src).toContain("error ? 'var(--color-red)' : active ?");
    expect(src).toContain("color: 'var(--color-red)', marginLeft: px + 8");
  });

  it("description sotto label con DESC_CLS + marginLeft calcolato", () => {
    expect(src).toContain("{description}"); expect(src).toContain("DESC_CLS[size]");
    expect(src).toContain("marginLeft: px + 8");
  });
});

/* ── CheckboxGroup ── */
describe("CheckboxGroup", () => {
  const src = readSrc("app/components/Checkbox.tsx");

  it("CheckboxGroupProps: options + value string[] + onChange + label + selectAll", () => {
    expect(src).toContain("options: CheckboxOption[]");
    expect(src).toContain("value: string[]");
    expect(src).toContain("onChange: (value: string[]) => void");
    expect(src).toContain("selectAll?: boolean");
  });

  it("toggle singolo + toggleAll: allChecked/someChecked + skip disabled", () => {
    expect(src).toContain("const toggle"); expect(src).toContain("const toggleAll");
    expect(src).toContain("allChecked"); expect(src).toContain("someChecked");
    expect(src).toContain("options.every((o) => value.includes(o.value))");
    expect(src).toContain("options.filter((o) => !o.disabled).map((o) => o.value)");
  });

  it("selectAll checkbox: indeterminate quando someChecked && !allChecked + label 'Seleziona tutti'", () => {
    expect(src).toContain("someChecked && !allChecked");
    expect(src).toContain('label="Seleziona tutti"');
    expect(src).toContain("onChange={toggleAll}");
  });

  it("options.map → Checkbox per ogni opzione con checked/label/description/disabled", () => {
    expect(src).toContain("options.map((opt) =>");
    expect(src).toContain("key={opt.value}");
    expect(src).toContain("checked={value.includes(opt.value)}");
    expect(src).toContain("label={opt.label}");
    expect(src).toContain("disabled={opt.disabled}");
  });

  it("group label uppercase + error message a livello group", () => {
    expect(src).toContain("tracking-widest uppercase");
    expect(src).toContain("var(--color-muted)");
    expect(src).toContain("{error && (");
    expect(src).toContain("className='text-[10px]'");
    expect(src).toContain("{error}");
  });
});
