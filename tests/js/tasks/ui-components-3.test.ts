/** Test vitest componenti UI batch 3 — ChatBubble, ConfettiAnimation, Accordion, Dropdown, Stepper, Tooltip, ProgressRing */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
function read(rel: string) { return fs.readFileSync(path.join(WEB, rel), "utf-8"); }

/* ── ChatBubble ── */
describe("ChatBubble", () => {
  const src = read("app/components/ChatBubble.tsx");
  it("export ChatBubble + ChatList + TypingIndicator + tipi ChatRole, ChatMessage", () => {
    expect(src).toMatch(/export function ChatBubble/);
    expect(src).toMatch(/export function ChatList/);
    expect(src).toMatch(/export function TypingIndicator/);
    expect(src).toContain("export type ChatRole");
    expect(src).toContain("export type ChatMessage");
  });
  it("BubbleAvatar sub-componente con ruoli user/assistant", () => {
    expect(src).toContain("function BubbleAvatar");
    expect(src).toContain("'user'");
    expect(src).toContain("'assistant'");
  });
  it("fmtTime helper + showAvatar prop + typing dots animation", () => {
    expect(src).toContain("function fmtTime");
    expect(src).toContain("showAvatar");
    expect(src).toContain("typing-dot");
    expect(src).toContain("Sta scrivendo");
  });
});

/* ── ConfettiAnimation ── */
describe("ConfettiAnimation", () => {
  const src = read("components/ConfettiAnimation.tsx");
  it("export default ConfettiAnimation + useConfetti hook + ConfettiAnimationProps", () => {
    expect(src).toMatch(/export default function ConfettiAnimation/);
    expect(src).toMatch(/export function useConfetti/);
    expect(src).toContain("export interface ConfettiAnimationProps");
  });
  it("Particle interface con shape rect/circle/ribbon + COLORS palette", () => {
    expect(src).toContain("interface Particle");
    expect(src).toContain("'rect'");
    expect(src).toContain("'circle'");
    expect(src).toContain("'ribbon'");
    expect(src).toContain("COLORS");
  });
  it("makeParticle + drawParticle + ConfettiCanvas con gravità e fade", () => {
    expect(src).toContain("function makeParticle");
    expect(src).toContain("function drawParticle");
    expect(src).toContain("function ConfettiCanvas");
    expect(src).toContain("0.08");  // gravità
  });
});

/* ── Accordion ── */
describe("Accordion", () => {
  const src = read("components/Accordion.tsx");
  it("export default Accordion + AccordionItem + AccordionProps", () => {
    expect(src).toMatch(/export default function Accordion/);
    expect(src).toContain("export interface AccordionItem");
    expect(src).toContain("export interface AccordionProps");
  });
  it("modalità single e multi + 3 varianti (default/bordered/ghost)", () => {
    expect(src).toContain("'single'");
    expect(src).toContain("'multi'");
    expect(src).toContain("'default'");
    expect(src).toContain("'bordered'");
    expect(src).toContain("'ghost'");
  });
  it("AccordionPanel + animazione altezza + chevron rotazione + badge + disabled", () => {
    expect(src).toContain("function AccordionPanel");
    expect(src).toContain("scrollHeight");
    expect(src).toContain("rotate(180deg)");
    expect(src).toContain("badge");
    expect(src).toContain("disabled");
  });
});

/* ── Dropdown ── */
describe("Dropdown", () => {
  const src = read("components/Dropdown.tsx");
  it("export default Dropdown + DropdownItem + DropdownProps + DropdownAlign", () => {
    expect(src).toMatch(/export default function Dropdown/);
    expect(src).toContain("export interface DropdownItem");
    expect(src).toContain("export interface DropdownProps");
    expect(src).toContain("export type DropdownAlign");
  });
  it("keyboard: Enter, ArrowDown, ArrowUp, Escape, Tab", () => {
    for (const k of ["Enter", "ArrowDown", "ArrowUp", "Escape", "Tab"])
      expect(src).toContain(`'${k}'`);
  });
  it("ARIA: role menu/menuitem + aria-haspopup + aria-expanded", () => {
    expect(src).toContain('role="menu"');
    expect(src).toContain('role="menuitem"');
    expect(src).toContain("aria-haspopup");
    expect(src).toContain("aria-expanded");
  });
  it("item props: icon, shortcut, disabled, danger, separator", () => {
    for (const p of ["icon", "shortcut", "disabled", "danger", "separator"])
      expect(src).toContain(`${p}?:`);
  });
});

/* ── Stepper ── */
describe("Stepper", () => {
  const src = read("components/Stepper.tsx");
  it("export default Stepper + StepConfig + StepperProps", () => {
    expect(src).toMatch(/export default function Stepper/);
    expect(src).toContain("export interface StepConfig");
    expect(src).toContain("export interface StepperProps");
  });
  it("4 stati step: pending, active, done, error", () => {
    for (const s of ["pending", "active", "done", "error"])
      expect(src).toContain(`'${s}'`);
  });
  it("navigazione avanti/indietro + allowBack + validate + completeLabel", () => {
    expect(src).toContain("handleNext");
    expect(src).toContain("handleBack");
    expect(src).toContain("allowBack");
    expect(src).toContain("validate");
    expect(src).toContain("Completa");
    expect(src).toContain("Indietro");
    expect(src).toContain("Avanti");
  });
});

/* ── Tooltip ── */
describe("Tooltip", () => {
  const src = read("app/components/Tooltip.tsx");
  it("export Tooltip + InfoTooltip + TooltipProps + TooltipPlacement", () => {
    expect(src).toMatch(/export function Tooltip\b/);
    expect(src).toMatch(/export function InfoTooltip/);
    expect(src).toContain("export type TooltipProps");
    expect(src).toContain("export type TooltipPlacement");
  });
  it("5 placement: top, bottom, left, right, auto", () => {
    for (const p of ["top", "bottom", "left", "right", "auto"])
      expect(src).toContain(`'${p}'`);
  });
  it("helper autoSide + resolveSide + tooltipStyle + arrowStyle", () => {
    expect(src).toContain("function autoSide");
    expect(src).toContain("function resolveSide");
    expect(src).toContain("function tooltipStyle");
    expect(src).toContain("function arrowStyle");
  });
  it("role tooltip + delay prop + animazione tt-in", () => {
    expect(src).toContain('role="tooltip"');
    expect(src).toContain("delay");
    expect(src).toContain("tt-in");
  });
});

/* ── ProgressRing ── */
describe("ProgressRing", () => {
  const src = read("components/ProgressRing.tsx");
  it("export default ProgressRing + ProgressRingProps + ProgressRingSize", () => {
    expect(src).toMatch(/export default function ProgressRing/);
    expect(src).toContain("export interface ProgressRingProps");
    expect(src).toContain("export type ProgressRingSize");
  });
  it("SIZE_MAP 5 taglie (xs/sm/md/lg/xl) con px, stroke, fontSize", () => {
    for (const s of ["xs", "sm", "md", "lg", "xl"]) expect(src).toContain(`${s}:`);
    expect(src).toContain("SIZE_MAP");
  });
  it("getColor soglie 30/70 + animazione ease-out cubic + caption", () => {
    expect(src).toContain("function getColor");
    expect(src).toContain("value < 30");
    expect(src).toContain("value < 70");
    expect(src).toContain("ease-out cubic");
    expect(src).toContain("caption");
  });
});
