/** Test UI batch 27 — AlertDialog, ProgressSteps, DateRangePicker */
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

/* ── AlertDialog ── */
describe("AlertDialog", () => {
  const src = readSrc("app/components/AlertDialog.tsx");

  it("export AlertDialog + AlertDialogProps + AlertVariant 4 + AlertDialogAction con loading", () => {
    expect(src).toMatch(/export function AlertDialog\b/);
    expect(src).toContain("export interface AlertDialogProps");
    expect(src).toContain("export type AlertVariant = 'danger' | 'warning' | 'info' | 'success'");
    expect(src).toContain("export interface AlertDialogAction");
    expect(src).toContain("loading?: boolean");
  });

  it("varianti: V_CFG 4 con color/bg/border/icon + primaryBg per variant + role alertdialog aria-modal", () => {
    expect(src).toContain("const V_CFG");
    for (const v of ["danger", "warning", "info", "success"]) expect(src).toContain(`${v}:`);
    expect(src).toContain("variant === 'danger' ? 'var(--color-red)'");
    expect(src).toContain('role="alertdialog"');
    expect(src).toContain('aria-modal="true"');
    expect(src).toContain('aria-labelledby="ad-title"');
  });

  it("focus trap: useFocusTrap + Tab shift trap + querySelectorAll focusables + first().focus()", () => {
    expect(src).toContain("function useFocusTrap");
    expect(src).toContain("e.key !== 'Tab'");
    expect(src).toContain("e.shiftKey");
    expect(src).toContain("el.querySelectorAll");
    expect(src).toContain("first()?.focus()");
  });

  it("azioni: primary/secondary buttons + ESC chiude + closeOnBackdrop + scroll lock + ad-in animation", () => {
    expect(src).toContain("primary?:");
    expect(src).toContain("secondary?:");
    expect(src).toContain("e.key === 'Escape'");
    expect(src).toContain("closeOnBackdrop = true");
    expect(src).toContain("document.body.style.overflow = open ? 'hidden' : ''");
    expect(src).toContain("@keyframes ad-in");
    expect(src).toContain("ad-in .22s ease");
  });
});

/* ── ProgressSteps ── */
describe("ProgressSteps", () => {
  const src = readSrc("components/ProgressSteps.tsx");

  it("export default ProgressSteps + ProgressStepsProps + Step + StepStatus 4 stati", () => {
    expect(src).toMatch(/export default function ProgressSteps\b/);
    expect(src).toContain("export interface ProgressStepsProps");
    expect(src).toContain("export interface Step");
    expect(src).toContain("export type StepStatus = 'completed' | 'active' | 'pending' | 'error'");
  });

  it("step states: resolveStatuses helper + COLORS 4 + CheckIcon + ErrorIcon + active boxShadow glow", () => {
    expect(src).toContain("function resolveStatuses");
    expect(src).toContain("const COLORS");
    expect(src).toContain("function CheckIcon");
    expect(src).toContain("function ErrorIcon");
    expect(src).toContain("isActive ? `0 0 0 3px color-mix");
  });

  it("animazione: linea completata width transition 0.4s cubic-bezier + SIZE_MAP sm/md/lg + showLabels", () => {
    expect(src).toContain("width 0.4s cubic-bezier(0.4,0,0.2,1)");
    expect(src).toContain("const SIZE_MAP");
    expect(src).toContain("showLabels  = true");
    expect(src).toContain("step.description &&");
  });

  it("percentuale: showPercent + completed/steps.length + percent Math.round + 'step' label", () => {
    expect(src).toContain("showPercent = false");
    expect(src).toContain("statuses.filter(s => s === 'completed').length");
    expect(src).toContain("Math.round((completed / (steps.length - 1)) * 100)");
    expect(src).toContain("{percent}%");
  });
});

/* ── DateRangePicker ── */
describe("DateRangePicker", () => {
  const src = readSrc("components/DateRangePicker.tsx");

  it("export default DateRangePicker + DateRangePickerProps + DateRange start/end + CalendarMonth", () => {
    expect(src).toMatch(/export default function DateRangePicker\b/);
    expect(src).toContain("export interface DateRangePickerProps");
    expect(src).toContain("export interface DateRange");
    expect(src).toContain("start: Date | null");
    expect(src).toContain("end: Date | null");
    expect(src).toContain("function CalendarMonth");
  });

  it("range: selectDay phase start/end + auto-sort s/e + inRange helper + sameDay + hover preview", () => {
    expect(src).toContain("const selectDay");
    expect(src).toContain("phase === 'start'");
    expect(src).toContain("setPhase('end')");
    expect(src).toContain("d < value.start ? [d, value.start] : [value.start, d]");
    expect(src).toContain("function inRange");
    expect(src).toContain("function sameDay");
  });

  it("preset: PRESETS 5 (7/30/90/180/365 giorni) + applyPreset + click fuori chiude + clear ×", () => {
    expect(src).toContain("const PRESETS");
    expect(src).toContain("days: 7");
    expect(src).toContain("days: 30");
    expect(src).toContain("days: 90");
    expect(src).toContain("days: 180");
    expect(src).toContain("days: 365");
    expect(src).toContain("const applyPreset");
    expect(src).toContain("!ref.current?.contains(e.target as Node)");
  });

  it("format: fmt toLocaleDateString it-IT + DAYS 7 + MONTHS 12 + startOfDay + prev/nextMonth nav", () => {
    expect(src).toContain("function fmt(d: Date)");
    expect(src).toContain("toLocaleDateString('it-IT'");
    expect(src).toContain("const DAYS");
    expect(src).toContain("const MONTHS");
    expect(src).toContain("function startOfDay");
    expect(src).toContain("const prevMonth");
    expect(src).toContain("const nextMonth");
  });
});
