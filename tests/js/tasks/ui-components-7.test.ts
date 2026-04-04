/** Test UI batch 7 — InputGroup, InputAddon, Input (Checkbox/CheckboxGroup non esistono) */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
function readSrc(rel: string) { return fs.readFileSync(path.join(WEB, rel), "utf-8"); }

/* ── InputGroup ── */
describe("InputGroup", () => {
  const src = readSrc("app/components/InputGroup.tsx");

  it("export InputGroup + InputAddon + Input + tipi InputSize + 3 interface", () => {
    expect(src).toMatch(/export function InputGroup\b/);
    expect(src).toMatch(/export function InputAddon\b/);
    expect(src).toMatch(/export function Input\b/);
    expect(src).toContain("export type InputSize");
    expect(src).toContain("export interface InputGroupProps");
    expect(src).toContain("export interface InputAddonProps");
    expect(src).toContain("export interface InputProps");
  });

  it("InputSize sm/md/lg + ADDON_CLS + INPUT_CLS maps con px/py/text per ogni size", () => {
    expect(src).toContain("ADDON_CLS"); expect(src).toContain("INPUT_CLS");
    for (const s of ["sm", "md", "lg"]) expect(src).toContain(`${s}:`);
    expect(src).toContain("px-2 py-1"); expect(src).toContain("px-3 py-2"); expect(src).toContain("px-4 py-2.5");
  });

  it("SizeCtx: createContext('md') + Provider + useContext per passare size", () => {
    expect(src).toContain("createContext"); expect(src).toContain("useContext");
    expect(src).toContain("SizeCtx"); expect(src).toContain("SizeCtx.Provider");
  });

  it("prefix + suffix addon con borderRight/borderLeft + background var(--color-row)", () => {
    expect(src).toContain("{prefix}"); expect(src).toContain("{suffix}");
    expect(src).toContain("borderRight"); expect(src).toContain("borderLeft");
    expect(src).toContain("var(--color-row)"); expect(src).toContain("var(--color-dim)");
  });

  it("error state: border red + focus green condizionale", () => {
    expect(src).toContain("error ? 'var(--color-red)' : 'var(--color-border)'");
    expect(src).toContain("error ? 'var(--color-red)' : 'var(--color-green)'");
    expect(src).toContain("{error}"); // error message rendered
  });

  it("React.Children.map + cloneElement per iniettare stili nell'input child", () => {
    expect(src).toContain("React.Children.map"); expect(src).toContain("React.cloneElement");
    expect(src).toContain("React.isValidElement");
    expect(src).toContain("border: 'none'"); expect(src).toContain("borderRadius: 0");
  });

  it("focus/blur: onFocusCapture + onBlurCapture cambiano borderColor", () => {
    expect(src).toContain("onFocusCapture"); expect(src).toContain("onBlurCapture");
    expect(src).toContain("e.currentTarget"); expect(src).toContain("focusBorder");
  });

  it("InputAddon standalone: position left/right + useContext(SizeCtx)", () => {
    expect(src).toContain("position?: 'left' | 'right'");
    expect(src).toContain("useContext(SizeCtx)");
    expect(src).toContain("position === 'left' ? 'borderRight' : 'borderLeft'");
  });

  it("Input standalone: extends InputHTMLAttributes + focus/blur con callback originali", () => {
    expect(src).toContain("React.InputHTMLAttributes<HTMLInputElement>");
    expect(src).toContain("rest.onFocus?.(e)"); expect(src).toContain("rest.onBlur?.(e)");
    expect(src).toContain("fullWidth ? 'w-full'");
  });

  it("styling coerente: font-mono + placeholder dim + bg card + transition-colors", () => {
    expect(src).toContain("font-mono");
    expect(src).toContain("placeholder:text-[var(--color-dim)]");
    expect(src).toContain("bg-[var(--color-card)]");
    expect(src).toContain("transition-colors");
  });
});
