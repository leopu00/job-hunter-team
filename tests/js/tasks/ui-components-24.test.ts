/** Test UI batch 24 — BottomSheet, SegmentedControl, NotificationBadge */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
function readSrc(rel: string) { return fs.readFileSync(path.join(WEB, rel), "utf-8"); }

/* ── BottomSheet ── */
describe("BottomSheet", () => {
  const src = readSrc("app/components/BottomSheet.tsx");

  it("export BottomSheet + useBottomSheet hook + BottomSheetProps + SnapPoint type 0.25/0.5/1", () => {
    expect(src).toMatch(/export function BottomSheet\b/);
    expect(src).toMatch(/export function useBottomSheet\b/);
    expect(src).toContain("export interface BottomSheetProps");
    expect(src).toContain("export type SnapPoint = 0.25 | 0.5 | 1");
  });

  it("snap points: nearest helper + snapPoints default [0.25, 0.5, 1] + snap tabs con setSnap + percentuale", () => {
    expect(src).toContain("function nearest(target: number, points: SnapPoint[])");
    expect(src).toContain("snapPoints = [0.25, 0.5, 1]");
    expect(src).toContain("defaultSnap = 0.5");
    expect(src).toContain("onClick={() => setSnap(s)}");
    expect(src).toContain("Math.round(s * 100)");
  });

  it("drag: onDragStart/Move/End + mouse+touch events + Math.max(0, clientY - startY) + translateY", () => {
    expect(src).toContain("const onDragStart");
    expect(src).toContain("const onDragMove");
    expect(src).toContain("const onDragEnd");
    expect(src).toContain("Math.max(0, clientY - startY.current)");
    expect(src).toContain("document.addEventListener('mousemove', mm)");
    expect(src).toContain("document.addEventListener('touchmove', tm");
    expect(src).toContain("cursor: 'grab'");
    expect(src).toContain("touchAction: 'none'");
  });

  it("backdrop: rgba(0,0,0,0.55) + backdropDismiss default true + scroll lock + animation bs-in/bs-out", () => {
    expect(src).toContain("rgba(0,0,0,0.55)");
    expect(src).toContain("backdropDismiss = true");
    expect(src).toContain("backdropDismiss ? close : undefined");
    expect(src).toContain("document.body.style.overflow = open ? 'hidden' : ''");
    expect(src).toContain("@keyframes bs-in");
    expect(src).toContain("@keyframes bs-out");
    expect(src).toContain("bs-out 0.28s ease forwards");
  });
});

/* ── SegmentedControl ── */
describe("SegmentedControl", () => {
  const src = readSrc("components/SegmentedControl.tsx");

  it("export default SegmentedControl + SegmentedControlProps + Segment + SegmentedSize sm/md/lg", () => {
    expect(src).toMatch(/export default function SegmentedControl\b/);
    expect(src).toContain("export interface SegmentedControlProps");
    expect(src).toContain("export interface Segment");
    expect(src).toContain("export type SegmentedSize = 'sm' | 'md' | 'lg'");
  });

  it("select: controlled/uncontrolled + role radio aria-checked + thumb animato + keyboard ArrowRight/Left", () => {
    expect(src).toContain("const isControlled = controlledValue !== undefined");
    expect(src).toContain("if (!isControlled) setInternal(seg.value)");
    expect(src).toContain('role="radio"');
    expect(src).toContain("aria-checked={isActive}");
    expect(src).toContain("e.key === 'ArrowRight'");
    expect(src).toContain("e.key === 'ArrowLeft'");
  });

  it("disabled: globale opacity 0.5 + seg.disabled + navigable filter !disabled + cursor default", () => {
    expect(src).toContain("opacity: disabled ? 0.5 : 1");
    expect(src).toContain("disabled || seg.disabled");
    expect(src).toContain("segments.filter(s => !s.disabled)");
    expect(src).toContain("cursor: isDisabled ? 'default' : 'pointer'");
  });

  it("SIZE_MAP 3 taglie + thumb getBoundingClientRect + transition cubic-bezier + data-seg", () => {
    expect(src).toContain("const SIZE_MAP");
    expect(src).toContain("container.querySelectorAll");
    expect(src).toContain("btn.getBoundingClientRect()");
    expect(src).toContain("cubic-bezier(0.34,1.1,0.64,1)");
    expect(src).toContain("data-seg");
  });
});

/* ── NotificationBadge ── */
describe("NotificationBadge", () => {
  const src = readSrc("app/components/NotificationBadge.tsx");

  it("export NotificationBadge + NotificationBadgeProps + BadgeVariant count/dot + IconBell", () => {
    expect(src).toMatch(/export function NotificationBadge\b/);
    expect(src).toContain("export interface NotificationBadgeProps");
    expect(src).toContain("export type BadgeVariant = 'count' | 'dot'");
    expect(src).toMatch(/export function IconBell\b/);
    expect(src).toContain("export interface IconBellProps");
  });

  it("count 99+: max default 99 + label count > max → max+ + showZero + visible logic", () => {
    expect(src).toContain("max = 99");
    expect(src).toContain("count > max ? `${max}+` : String(count)");
    expect(src).toContain("showZero = false");
    expect(src).toContain("showZero ? count >= 0 : count > 0");
  });

  it("pulse: nb-pulse keyframes 1.4s + nb-pop 0.25s + '--nb-color' css var + border card", () => {
    expect(src).toContain("@keyframes nb-pulse");
    expect(src).toContain("nb-pulse 1.4s ease infinite");
    expect(src).toContain("@keyframes nb-pop");
    expect(src).toContain("nb-pop .25s ease");
    expect(src).toContain("'--nb-color': color");
    expect(src).toContain("1.5px solid var(--color-card)");
  });

  it("dot: variant dot width 8 height 8 + count mode minWidth/height 18 + offset transform + aria-label notifiche", () => {
    expect(src).toContain("variant === 'dot'");
    expect(src).toContain("width: 8");
    expect(src).toContain("height: 8");
    expect(src).toContain("height: 18");
    expect(src).toContain("offset[0]}px)");
    expect(src).toContain("aria-label={`${count} notifiche`}");
  });
});
