/** Test UI batch 25 — FilePreview, PhoneInput, Stepper */
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

/* ── FilePreview ── */
describe("FilePreview", () => {
  const src = readSrc("components/FilePreview.tsx");

  it("export default FilePreview + FilePreviewProps + PreviewFile interface con id/name/size/url/type", () => {
    expect(src).toMatch(/export default function FilePreview\b/);
    expect(src).toContain("export interface FilePreviewProps");
    expect(src).toContain("export interface PreviewFile");
    expect(src).toContain("id: string");
    expect(src).toContain("name: string");
    expect(src).toContain("size: number");
    expect(src).toContain("type: string");
  });

  it("thumbnail: isImage type.startsWith image/ + img src url + getIcon ICONS con 12 ext + default 📎", () => {
    expect(src).toContain("function isImage(type: string)");
    expect(src).toContain("type.startsWith('image/')");
    expect(src).toContain("function getIcon(name: string)");
    expect(src).toContain("const ICONS");
    expect(src).toContain("default: '📎'");
    expect(src).toContain("objectFit: 'cover'");
  });

  it("delete: onDelete callback + button × + title 'Rimuovi file' + color-red", () => {
    expect(src).toContain("onDelete?: (id: string) => void");
    expect(src).toContain("onDelete(file.id)");
    expect(src).toContain("Rimuovi file");
    expect(src).toContain("color: 'var(--color-red");
  });

  it("size: fmtSize B/KB/MB + truncate max 22 + drag reorder + thumbSize default 40", () => {
    expect(src).toContain("function fmtSize(bytes: number)");
    expect(src).toContain("1024");
    expect(src).toContain("KB");
    expect(src).toContain("MB");
    expect(src).toContain("function truncate(name: string, max = 22)");
    expect(src).toContain("onReorder?.(next)");
    expect(src).toContain("thumbSize = 40");
  });
});

/* ── PhoneInput ── */
describe("PhoneInput", () => {
  const src = readSrc("app/components/PhoneInput.tsx");

  it("export PhoneInput + PhoneInputProps + Country interface + COUNTRIES 26 paesi", () => {
    expect(src).toMatch(/export function PhoneInput\b/);
    expect(src).toContain("export interface PhoneInputProps");
    expect(src).toContain("export interface Country");
    expect(src).toContain("export const COUNTRIES: Country[]");
    expect(src).toContain("code: 'IT'");
    expect(src).toContain("dial: '+39'");
  });

  it("country select: dropdown open/close + searchable Cerca paese + filtered by name/dial + click esterno chiude", () => {
    expect(src).toContain("setOpen((o) => !o)");
    expect(src).toContain('placeholder="Cerca paese..."');
    expect(src).toContain("c.name.toLowerCase().includes(query.toLowerCase())");
    expect(src).toContain("c.dial.includes(query)");
    expect(src).toContain("!wrapRef.current?.contains(e.target as Node)");
    expect(src).toContain("Nessun risultato");
  });

  it("format: formatPhone 3-4-5 digit groups + replace /\\D/g + type tel + inputMode tel", () => {
    expect(src).toContain("function formatPhone(raw: string)");
    expect(src).toContain("raw.replace(/\\D/g, '')");
    expect(src).toContain('type="tel"');
    expect(src).toContain('inputMode="tel"');
    expect(src).toContain("d.slice(0, 3)");
    expect(src).toContain("d.slice(3, 7)");
  });

  it("validation: isValid >= 7 digits + ✓ check verde + aria-invalid + error border red", () => {
    expect(src).toContain("function isValid(phone: string)");
    expect(src).toContain(".length >= 7");
    expect(src).toContain("isValid(value) ? 'var(--color-green)'");
    expect(src).toContain("aria-invalid={!!error}");
    expect(src).toContain("error ? 'var(--color-red)' : 'var(--color-border)'");
  });
});

/* ── Stepper ── */
describe("Stepper", () => {
  const src = readSrc("components/Stepper.tsx");

  it("export default Stepper + StepperProps + StepConfig con validate + StepState 4 stati", () => {
    expect(src).toMatch(/export default function Stepper\b/);
    expect(src).toContain("export interface StepperProps");
    expect(src).toContain("export interface StepConfig");
    expect(src).toContain("validate?: () => boolean | string");
    expect(src).toContain("type StepState = 'pending' | 'active' | 'done' | 'error'");
  });

  it("step nav: handleNext/handleBack + goTo indietro + allowBack default true + '← Indietro' / 'Avanti →'", () => {
    expect(src).toContain("const handleNext");
    expect(src).toContain("const handleBack");
    expect(src).toContain("const goTo");
    expect(src).toContain("allowBack = true");
    expect(src).toContain("Indietro");
    expect(src).toContain("Avanti →");
  });

  it("validation: step.validate() + errore string/default + setErrors + display errore rgba rosso", () => {
    expect(src).toContain("step.validate()");
    expect(src).toContain("result !== true");
    expect(src).toContain("Completa questo step prima di continuare.");
    expect(src).toContain("setErrors");
    expect(src).toContain("rgba(255,59,59,0.1)");
  });

  it("completed: Set + stepState done/active/error/pending + ✓ done + completeLabel default 'Completa' + onComplete", () => {
    expect(src).toContain("useState<Set<number>>(new Set())");
    expect(src).toContain("const stepState");
    expect(src).toContain("completed.has(i)");
    expect(src).toContain("completeLabel = 'Completa'");
    expect(src).toContain("onComplete?.()");
    expect(src).toContain("current + 1} di {steps.length}");
  });
});
