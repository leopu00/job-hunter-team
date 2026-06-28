/** Test UI batch 13 — CopyButton (Divider/StatusIndicator/MapSVG rimossi: componenti orfani cancellati) */
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

/* ── CopyButton ── */
describe("CopyButton", () => {
  const src = readSrc("app/components/CopyButton.tsx");

  it("export CopyButton + CopyField + useCopy + CopyState type + CopyButtonProps", () => {
    expect(src).toMatch(/export function CopyButton\b/);
    expect(src).toMatch(/export function CopyField\b/);
    expect(src).toMatch(/export function useCopy\b/);
    expect(src).toContain("export type CopyState");
    expect(src).toContain("export interface CopyButtonProps");
  });

  it("CopyState idle/copied/error + useCopy: navigator.clipboard.writeText + timer reset", () => {
    expect(src).toContain("'idle' | 'copied' | 'error'");
    expect(src).toContain("navigator.clipboard.writeText(text)");
    expect(src).toContain("setState('copied')"); expect(src).toContain("setState('error')");
    expect(src).toContain("clearTimeout(timer.current)");
    expect(src).toContain("successDuration = 2000");
  });

  it("3 icons: ClipboardIcon + CheckIcon + ErrorIcon + ICON_PX/BTN_CLS/INLINE_CLS size maps", () => {
    expect(src).toContain("function ClipboardIcon"); expect(src).toContain("function CheckIcon"); expect(src).toContain("function ErrorIcon");
    expect(src).toContain("ICON_PX"); expect(src).toContain("BTN_CLS"); expect(src).toContain("INLINE_CLS");
  });

  it("3 varianti default/inline/ghost + stateColor green/red + aria-label 'Copiato!'/'Copia'", () => {
    expect(src).toContain("'default' | 'inline' | 'ghost'");
    expect(src).toContain("var(--color-green)"); expect(src).toContain("var(--color-red)");
    expect(src).toContain("'Copiato!'"); expect(src).toContain("'Copia'");
  });

  it("CopyField: readonly input + CopyButton inline integrato + label tracking-widest", () => {
    expect(src).toContain("readOnly value={value}"); expect(src).toContain("font-mono");
    expect(src).toContain('variant="inline"'); expect(src).toContain("tracking-widest");
  });
});
