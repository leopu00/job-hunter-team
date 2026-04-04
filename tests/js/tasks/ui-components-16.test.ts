/** Test UI batch 16 — Slider, Marquee, Spotlight, ThemeProvider */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
function readSrc(rel: string) { return fs.readFileSync(path.join(WEB, rel), "utf-8"); }

/* ── Slider ── */
describe("Slider", () => {
  const src = readSrc("app/components/Slider.tsx");

  it("export Slider + SliderProps union + SingleSliderProps + RangeSliderProps + SliderMark", () => {
    expect(src).toMatch(/export function Slider\b/);
    expect(src).toContain("export type SliderProps");
    expect(src).toContain("export interface SingleSliderProps");
    expect(src).toContain("export interface RangeSliderProps");
    expect(src).toContain("export interface SliderMark");
  });

  it("helpers: clamp min/max + snap step + pct percentage", () => {
    expect(src).toContain("function clamp");
    expect(src).toContain("Math.max(min, Math.min(max, v))");
    expect(src).toContain("function snap");
    expect(src).toContain("Math.round((v - min) / step) * step + min");
    expect(src).toContain("function pct");
  });

  it("Thumb: role=slider, aria-valuemin/max/now, tooltip hover, keyboard ArrowRight/Left", () => {
    expect(src).toContain('role="slider"');
    expect(src).toContain("aria-valuemin={min}");
    expect(src).toContain("aria-valuemax={max}");
    expect(src).toContain("aria-valuenow={value}");
    expect(src).toContain("e.key === 'ArrowRight'");
    expect(src).toContain("e.key === 'ArrowLeft'");
  });

  it("range mode: lo/hi thumbs + marks con label + showValue display", () => {
    expect(src).toContain("isRange");
    expect(src).toContain("props.range === true");
    expect(src).toContain("marks.map(m =>");
    expect(src).toContain("m.label");
    expect(src).toContain("showValue");
  });
});

/* ── Marquee ── */
describe("Marquee", () => {
  const src = readSrc("app/components/Marquee.tsx");

  it("export Marquee + MarqueeProps + MarqueeItem + NewsTicker", () => {
    expect(src).toMatch(/export function Marquee\b/);
    expect(src).toContain("export interface MarqueeProps");
    expect(src).toMatch(/export function MarqueeItem\b/);
    expect(src).toMatch(/export function NewsTicker\b/);
  });

  it("speed=60 default + direction left/right + pauseOnHover + gap=48", () => {
    expect(src).toContain("speed = 60");
    expect(src).toContain("'left' | 'right'");
    expect(src).toContain("pauseOnHover = true");
    expect(src).toContain("gap = 48");
  });

  it("keyframes marquee-scroll translateX + duration = w/speed + paused state", () => {
    expect(src).toContain("@keyframes marquee-scroll");
    expect(src).toContain("w / speed");
    expect(src).toContain("animationPlayState: paused ? 'paused' : 'running'");
  });

  it("due copie per loop continuo + aria-hidden clone + separator default •", () => {
    expect(src).toContain("aria-hidden");
    expect(src).toContain("paddingRight: gap");
    expect(src).toContain("separator = '•'");
    expect(src).toContain("label = 'LIVE'");
  });
});

/* ── Spotlight ── */
describe("Spotlight", () => {
  const src = readSrc("components/Spotlight.tsx");

  it("export default Spotlight + SpotlightStep + SpotlightProps", () => {
    expect(src).toMatch(/export default function Spotlight\b/);
    expect(src).toContain("export interface SpotlightStep");
    expect(src).toContain("export interface SpotlightProps");
  });

  it("step nav: next/prev/skip + keyboard ArrowRight/Left/Escape + counter {idx+1}/{total}", () => {
    expect(src).toContain("const next = ()");
    expect(src).toContain("const prev = ()");
    expect(src).toContain("const skip = ()");
    expect(src).toContain("e.key === 'ArrowRight'");
    expect(src).toContain("e.key === 'Escape'");
    expect(src).toContain("{currentIdx + 1} / {steps.length}");
  });

  it("overlay SVG cutout + target highlight: querySelector + scrollIntoView + getBoundingClientRect", () => {
    expect(src).toContain("rgba(0,0,0,0.65)");
    expect(src).toContain('fillRule="evenodd"');
    expect(src).toContain("document.querySelector(step.target)");
    expect(src).toContain("scrollIntoView");
    expect(src).toContain("getBoundingClientRect");
  });

  it("placement auto-flip 4 posizioni + TOOLTIP_W 280 + GAP 12 + buttons Salta/Indietro/Avanti/Fine", () => {
    expect(src).toContain("const TOOLTIP_W = 280");
    expect(src).toContain("const GAP       = 12");
    expect(src).toContain("'top' | 'bottom' | 'left' | 'right'");
    expect(src).toContain("Salta");
    expect(src).toContain("← Indietro");
    expect(src).toContain("Avanti →");
    expect(src).toContain("Fine ✓");
  });
});

/* ── ThemeProvider ── */
describe("ThemeProvider", () => {
  const src = readSrc("app/theme-provider.tsx");

  it("export ThemeProvider + useTheme + ThemeToggle + DarkModeToggle + Theme type dark/light/system", () => {
    expect(src).toMatch(/export function ThemeProvider\b/);
    expect(src).toMatch(/export function useTheme\b/);
    expect(src).toMatch(/export function ThemeToggle\b/);
    expect(src).toMatch(/export function DarkModeToggle\b/);
    expect(src).toContain("'dark' | 'light' | 'system'");
  });

  it("localStorage STORAGE_KEY + resolveInitialTheme + getSystemTheme prefers-color-scheme", () => {
    expect(src).toContain("const STORAGE_KEY = 'jht-theme'");
    expect(src).toContain("function resolveInitialTheme");
    expect(src).toContain("localStorage.getItem(STORAGE_KEY)");
    expect(src).toContain("function getSystemTheme");
    expect(src).toContain("prefers-color-scheme: dark");
  });

  it("applyTheme data-theme + enableTransition 0.25s + toggleTheme dark↔light + PATCH /api/preferences", () => {
    expect(src).toContain("data-theme");
    expect(src).toContain("function enableTransition");
    expect(src).toContain("background-color 0.25s ease");
    expect(src).toContain("const toggleTheme");
    expect(src).toContain("fetch('/api/preferences'");
    expect(src).toContain("method: 'PATCH'");
  });

  it("DarkModeToggle 3 options dark/light/system + ThemeToggle sun/moon icons ☀/◐", () => {
    expect(src).toContain("{ value: 'dark',   label: '☀ dark'   }");
    expect(src).toContain("{ value: 'light',  label: '◐ light'  }");
    expect(src).toContain("{ value: 'system', label: '⊙ system' }");
    expect(src).toContain("isDark ? '☀' : '◐'");
  });
});
