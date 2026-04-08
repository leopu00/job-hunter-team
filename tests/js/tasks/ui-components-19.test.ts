/** Test UI batch 19 — PasswordInput, OTPInput, Watermark */
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

/* ── PasswordInput ── */
describe("PasswordInput", () => {
  const src = readSrc("app/components/PasswordInput.tsx");

  it("export PasswordInput + PasswordInputProps + PasswordRequirement + PASSWORD_REQUIREMENTS 4", () => {
    expect(src).toMatch(/export function PasswordInput\b/);
    expect(src).toContain("export interface PasswordInputProps");
    expect(src).toContain("export interface PasswordRequirement");
    expect(src).toContain("export const PASSWORD_REQUIREMENTS");
    expect(src).toContain("Almeno 8 caratteri");
    expect(src).toContain("Una lettera maiuscola");
    expect(src).toContain("Un numero");
    expect(src).toContain("Un carattere speciale");
  });

  it("toggle visibilità: type text/password + EyeOpen/EyeOff + aria-label Mostra/Nascondi", () => {
    expect(src).toContain("visible ? 'text' : 'password'");
    expect(src).toContain("const EyeOpen");
    expect(src).toContain("const EyeOff");
    expect(src).toContain("Nascondi password");
    expect(src).toContain("Mostra password");
  });

  it("calcStrength 0-3: Debole/Media/Forte + barra 33%/66%/100% + colori red/orange/green", () => {
    expect(src).toContain("function calcStrength");
    expect(src).toContain("0 | 1 | 2 | 3");
    expect(src).toContain("'Debole'");
    expect(src).toContain("'Media'");
    expect(src).toContain("'Forte'");
    expect(src).toContain("w: '33%'");
    expect(src).toContain("w: '66%'");
    expect(src).toContain("w: '100%'");
  });

  it("requirements checklist: Check icon SVG + colore green/dim + autoComplete current-password", () => {
    expect(src).toContain("const Check");
    expect(src).toContain("r.test(value)");
    expect(src).toContain("r.label");
    expect(src).toContain("autoComplete=\"current-password\"");
  });
});

/* ── OTPInput ── */
describe("OTPInput", () => {
  const src = readSrc("app/components/OTPInput.tsx");

  it("export OTPInput + OTPInputProps + length default 6 + type number/alphanumeric", () => {
    expect(src).toMatch(/export function OTPInput\b/);
    expect(src).toContain("export interface OTPInputProps");
    expect(src).toContain("length = 6");
    expect(src).toContain("'number' | 'alphanumeric'");
  });

  it("sanitize: number rimuove \\D, alphanumeric uppercase + auto-advance focus(idx+1)", () => {
    expect(src).toContain("function sanitize");
    expect(src).toContain("v.replace(/\\D/g, '')");
    expect(src).toContain(".toUpperCase()");
    expect(src).toContain("focus(idx + 1)");
  });

  it("Backspace: svuota o torna indietro + ArrowLeft/Right + Delete + onPaste slice(0,length)", () => {
    expect(src).toContain("e.key === 'Backspace'");
    expect(src).toContain("focus(idx - 1)");
    expect(src).toContain("e.key === 'ArrowLeft'");
    expect(src).toContain("e.key === 'ArrowRight'");
    expect(src).toContain("e.key === 'Delete'");
    expect(src).toContain("raw.slice(0, length)");
    expect(src).toContain("e.clipboardData.getData('text')");
  });

  it("a11y: role=group, aria-label Cifra {i+1}, autoComplete one-time-code, inputMode numeric", () => {
    expect(src).toContain('role="group"');
    expect(src).toContain("Cifra ${i + 1} di ${length}");
    expect(src).toContain('autoComplete="one-time-code"');
    expect(src).toContain("inputMode={type === 'number' ? 'numeric' : 'text'}");
    expect(src).toContain("Codice non valido");
  });
});

/* ── Watermark ── */
describe("Watermark", () => {
  const src = readSrc("components/Watermark.tsx");

  it("export default Watermark + WatermarkProps + WatermarkText", () => {
    expect(src).toMatch(/export default function Watermark\b/);
    expect(src).toContain("export interface WatermarkProps");
    expect(src).toMatch(/export function WatermarkText\b/);
  });

  it("canvas offscreen: measureText + rotate Math.PI/180 + fillText + toDataURL", () => {
    expect(src).toContain("document.createElement('canvas')");
    expect(src).toContain("ctx.measureText(text)");
    expect(src).toContain("rotate * Math.PI) / 180");
    expect(src).toContain("ctx.fillText(text, 0, 0)");
    expect(src).toContain("canvas.toDataURL()");
  });

  it("defaults: rotate=-30, opacity=0.1, fontSize=16, gap=60 + layer overlay/underlay", () => {
    expect(src).toContain("rotate = -30");
    expect(src).toContain("opacity = 0.1");
    expect(src).toContain("fontSize = 16");
    expect(src).toContain("gap = 60");
    expect(src).toContain("'overlay' | 'underlay'");
    expect(src).toContain("layer === 'overlay'");
  });

  it("pattern: backgroundRepeat repeat + pointerEvents none + WatermarkText CSS fallback 40 spans", () => {
    expect(src).toContain("backgroundRepeat: 'repeat'");
    expect(src).toContain("pointerEvents: 'none'");
    expect(src).toContain("Array.from({ length: 40 })");
    expect(src).toContain("userSelect: 'none'");
  });
});
