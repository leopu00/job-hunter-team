/** Test UI batch 13 — Divider, CopyButton, StatusIndicator, MapSVG */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
function readSrc(rel: string) { return fs.readFileSync(path.join(WEB, rel), "utf-8"); }

/* ── Divider ── */
describe("Divider", () => {
  const src = readSrc("app/components/Divider.tsx");

  it("export Divider + SectionDivider + SpaceDivider + OrDivider + 3 tipi", () => {
    expect(src).toMatch(/export function Divider\b/);
    expect(src).toMatch(/export function SectionDivider\b/);
    expect(src).toMatch(/export function SpaceDivider\b/);
    expect(src).toMatch(/export function OrDivider\b/);
    expect(src).toContain("export type DividerOrientation");
    expect(src).toContain("export type DividerVariant");
    expect(src).toContain("export type DividerSpacing");
  });

  it("orientation horizontal/vertical + variant solid/dashed/dotted + role='separator' + aria-orientation", () => {
    expect(src).toContain("'horizontal' | 'vertical'");
    expect(src).toContain("'solid' | 'dashed' | 'dotted'");
    expect(src).toContain('role="separator"');
    expect(src).toContain('aria-orientation="vertical"'); expect(src).toContain('aria-orientation="horizontal"');
  });

  it("label: left line + label tracking-widest + right line + aria-label + borderStyle helper", () => {
    expect(src).toContain("aria-label={label}"); expect(src).toContain("tracking-widest uppercase");
    expect(src).toContain("function borderStyle"); expect(src).toContain("borderTop"); expect(src).toContain("borderLeft");
  });

  it("SectionDivider title+action + SpaceDivider aria-hidden + OrDivider 'oppure'", () => {
    expect(src).toContain("export interface SectionDividerProps"); expect(src).toContain("{action}");
    expect(src).toContain("aria-hidden");
    expect(src).toContain('label="oppure"');
  });
});

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

/* ── StatusIndicator ── */
describe("StatusIndicator", () => {
  const src = readSrc("components/StatusIndicator.tsx");

  it("export default StatusIndicator + StatusBadge + Status 5 + StatusSize 3", () => {
    expect(src).toMatch(/export default function StatusIndicator\b/);
    expect(src).toMatch(/export function StatusBadge\b/);
    expect(src).toContain("export type Status");
    expect(src).toContain("export type StatusSize");
    for (const s of ["online", "offline", "busy", "away", "error"]) expect(src).toContain(`${s}:`);
  });

  it("STATUS_CONFIG color+label+icon per stato + SIZE_CONFIG dot/ring/fontSize", () => {
    expect(src).toContain("STATUS_CONFIG"); expect(src).toContain("SIZE_CONFIG");
    expect(src).toContain("'Online'"); expect(src).toContain("'Offline'"); expect(src).toContain("'Occupato'");
    expect(src).toContain("'Assente'"); expect(src).toContain("'Errore'");
  });

  it("ensureKeyframes: status-pulse scale(1.9) + status-blink opacity 0.3 + pulse default online", () => {
    expect(src).toContain("function ensureKeyframes"); expect(src).toContain("status-kf");
    expect(src).toContain("status-pulse"); expect(src).toContain("scale(1.9)");
    expect(src).toContain("status-blink"); expect(src).toContain("opacity: 0.3");
    expect(src).toContain("pulse = status === 'online'");
  });

  it("error blink + boxShadow glow + showLabel + labelOverride + StatusBadge pill", () => {
    expect(src).toContain("status === 'error' ? 'status-blink");
    expect(src).toContain("boxShadow:"); expect(src).toContain("showLabel"); expect(src).toContain("labelOverride");
    expect(src).toContain("borderRadius: 20"); // pill
  });
});

/* ── MapSVG ── */
describe("MapSVG", () => {
  const src = readSrc("components/MapSVG.tsx");

  it("export default MapSVG + MapMarker + MapSVGProps interfaces", () => {
    expect(src).toMatch(/export default function MapSVG\b/);
    expect(src).toContain("export interface MapMarker");
    expect(src).toContain("export interface MapSVGProps");
  });

  it("project equirettangolare + LAND 8 poligoni continenti + landPaths useMemo", () => {
    expect(src).toContain("function project"); expect(src).toContain("((lng + 180) / 360)");
    expect(src).toContain("const LAND"); expect(src).toContain("// Nord America");
    expect(src).toContain("// Australia"); expect(src).toContain("landPaths");
  });

  it("clusterMarkers: Math.hypot distanza + radius + count text + variable r", () => {
    expect(src).toContain("function clusterMarkers");
    expect(src).toContain("Math.hypot(p.px - q.px, p.py - q.py)");
    expect(src).toContain("clusterRadius?: number"); expect(src).toContain("clusterRadius = 20");
    expect(src).toContain("{cl.markers.length}"); // cluster count
  });

  it("tooltip: singolo label+value o 'N posizioni' + griglia lat/lng + onMarkerClick", () => {
    expect(src).toContain("tip.markers[0].label");
    expect(src).toContain("posizioni"); expect(src).toContain("tip.markers.slice(0,3)");
    expect(src).toContain("onMarkerClick?.(m)"); expect(src).toContain("pointerEvents: 'none'");
  });
});
