/** Test UI batch 17 — HotkeysProvider, CountdownTimer (MediaPlayer non esiste) */
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

/* ── HotkeysProvider ── */
describe("HotkeysProvider", () => {
  const src = readSrc("components/HotkeysProvider.tsx");

  it("export HotkeysProvider + useHotkeys + useHotkeysScope + Hotkey interface", () => {
    expect(src).toMatch(/export function HotkeysProvider\b/);
    expect(src).toMatch(/export function useHotkeys\b/);
    expect(src).toMatch(/export function useHotkeysScope\b/);
    expect(src).toContain("export interface Hotkey");
  });

  it("normalizeKeys: mod → meta/ctrl + eventToCombo: ctrl/meta/alt/shift parts", () => {
    expect(src).toContain("function normalizeKeys");
    expect(src).toContain("replace(/mod/g,");
    expect(src).toContain("navigator.platform");
    expect(src).toContain("function eventToCombo");
    expect(src).toContain("e.ctrlKey"); expect(src).toContain("e.metaKey");
    expect(src).toContain("e.altKey"); expect(src).toContain("e.shiftKey");
  });

  it("scope filtering + enabled check + ignora INPUT/TEXTAREA/SELECT tranne Escape", () => {
    expect(src).toContain("h.scope && h.scope !== activeScope");
    expect(src).toContain("h.enabled === false");
    expect(src).toContain("['INPUT','TEXTAREA','SELECT'].includes(tag)");
    expect(src).toContain("e.key !== 'Escape'");
  });

  it("cheatsheet: ? toggle + grouped by scope + 'Scorciatoie tastiera' + Nessuna shortcut", () => {
    expect(src).toContain("'?' || combo === 'shift+/'");
    expect(src).toContain("setShow(v => !v)");
    expect(src).toContain("Cheatsheet");
    expect(src).toContain("Scorciatoie tastiera");
    expect(src).toContain("Nessuna shortcut registrata");
  });

  it("register/unregister via ref + useHotkeys cleanup + defaultScope='global'", () => {
    expect(src).toContain("hotkeysRef.current = [...hotkeysRef.current, h]");
    expect(src).toContain("hotkeysRef.current.filter(x => x !== h)");
    expect(src).toContain("cleanups.forEach(fn => fn())");
    expect(src).toContain("defaultScope = 'global'");
  });
});

/* ── CountdownTimer ── */
describe("CountdownTimer", () => {
  const src = readSrc("app/components/CountdownTimer.tsx");

  it("export CountdownTimer + CountdownTimerProps + CountdownBadge", () => {
    expect(src).toMatch(/export function CountdownTimer\b/);
    expect(src).toContain("export type CountdownTimerProps");
    expect(src).toMatch(/export function CountdownBadge\b/);
  });

  it("remaining: target.getTime - Date.now + fmt: days/hours/minutes/seconds + pad", () => {
    expect(src).toContain("function remaining");
    expect(src).toContain("target.getTime() - Date.now()");
    expect(src).toContain("function fmt");
    expect(src).toContain("Math.floor(s / 86400)");
    expect(src).toContain("Math.floor((s % 86400) / 3600)");
    expect(src).toContain("function pad");
    expect(src).toContain("padStart(2, '0')");
  });

  it("urgencyColor: red<3d, yellow<7d, green>=7d + urgencyLabel 5 stati", () => {
    expect(src).toContain("function urgencyColor");
    expect(src).toContain("var(--color-red)");
    expect(src).toContain("var(--color-yellow)");
    expect(src).toContain("var(--color-green)");
    expect(src).toContain("function urgencyLabel");
    expect(src).toContain("'Scaduto'");
    expect(src).toContain("'Urgente'");
    expect(src).toContain("'Imminente'");
    expect(src).toContain("'In scadenza'");
    expect(src).toContain("'In programma'");
  });

  it("setInterval 1000ms + clearInterval on expired + pulse <24h animation cd-pulse", () => {
    expect(src).toContain("setInterval(");
    expect(src).toContain("}, 1000)");
    expect(src).toContain("clearInterval(id)");
    expect(src).toContain("ms < 86400000");
    expect(src).toContain("@keyframes cd-pulse");
    expect(src).toContain("opacity: 0.55");
  });

  it("3 sizes sm/md/lg + units gg/hh/mm/ss + showSeconds + CountdownBadge ⏱ inline", () => {
    expect(src).toContain("sm: { digit:");
    expect(src).toContain("md: { digit:");
    expect(src).toContain("lg: { digit:");
    expect(src).toContain("gg");
    expect(src).toContain("hh");
    expect(src).toContain("mm");
    expect(src).toContain("ss");
    expect(src).toContain("showSeconds");
    expect(src).toContain("⏱");
  });
});
