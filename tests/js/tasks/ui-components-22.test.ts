/** Test UI batch 22 — FloatingChat, Slider, Banner */
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

/* ── FloatingChat ── */
describe("FloatingChat", () => {
  const src = readSrc("app/components/FloatingChat.tsx");

  it("export default FloatingChat + usa i tipi condivisi dell'assistente", () => {
    expect(src).toMatch(/export default function FloatingChat\b/);
    expect(src).toContain("type AssistantChatMessage");
    expect(src).toContain("type AssistantSuggestion");
    expect(src).toContain("const [messages, setMessages] = useState<AssistantChatMessage[]>([])");
    expect(src).toContain("const [suggestions, setSuggestions] = useState<AssistantSuggestion[]>(AI_ASSISTANT_SUGGESTIONS)");
  });

  it("open/close: toggle state + aria-label Chiudi/Apri + chat-slide-up animation", () => {
    expect(src).toContain("const [open, setOpen] = useState(false)");
    expect(src).toContain("setOpen(v => !v)");
    expect(src).toContain("Chiudi chat");
    expect(src).toContain("Apri AI Assistant");
    expect(src).toContain("@keyframes chat-slide-up");
    expect(src).toContain("chat-slide-up 0.25s ease both");
  });

  it("input: Enter invia + placeholder dinamico + sending disabilita + indicatore 'Sto pensando...'", () => {
    expect(src).toContain("e.key === 'Enter' && send()");
    expect(src).toContain("placeholder={configured === false ? 'Chatbot non configurato' : 'Scrivi un messaggio...'}");
    expect(src).toContain("const [sending, setSending] = useState(false)");
    expect(src).toContain("disabled={sending || !input.trim() || configured === false}");
    expect(src).toContain("Sto pensando...");
  });

  it("fetch /api/ai-assistant GET bootstrap + POST message con history/path + scrollTo bottom + suggestions", () => {
    expect(src).toContain("fetch('/api/ai-assistant')");
    expect(src).toContain("loadStoredAssistantHistory()");
    expect(src).toContain("data.suggestions");
    expect(src).toContain("data.configured");
    expect(src).toContain("data.model");
    expect(src).toContain("method: 'POST'");
    expect(src).toContain("JSON.stringify({ message: msg, history: previousHistory, path: window.location.pathname })");
    expect(src).toContain("scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight)");
    expect(src).toContain("Ti aiuto a capire la piattaforma e da dove iniziare.");
  });
});

/* ── Slider ── */
describe("Slider", () => {
  const src = readSrc("app/components/Slider.tsx");

  it("export Slider + SliderProps union + SingleSliderProps + RangeSliderProps + SliderMark", () => {
    expect(src).toMatch(/export function Slider\b/);
    expect(src).toContain("export type SliderProps = SingleSliderProps | RangeSliderProps");
    expect(src).toContain("export interface SingleSliderProps");
    expect(src).toContain("export interface RangeSliderProps");
    expect(src).toContain("export interface SliderMark");
    expect(src).toContain("range?:");
    expect(src).toContain("range:");
  });

  it("drag: Thumb mouse+touch + clamp/snap/pct helpers + move calcola da rect", () => {
    expect(src).toContain("function Thumb");
    expect(src).toContain("function clamp(v: number, min: number, max: number)");
    expect(src).toContain("function snap(v: number, step: number, min: number)");
    expect(src).toContain("function pct(v: number, min: number, max: number)");
    expect(src).toContain("const rect = track.getBoundingClientRect()");
    expect(src).toContain("document.addEventListener('mousemove', onMove)");
    expect(src).toContain("document.addEventListener('touchmove', onTouch)");
  });

  it("keyboard: ArrowRight/Up incrementa + ArrowLeft/Down decrementa + role=slider ARIA", () => {
    expect(src).toContain("e.key === 'ArrowRight'");
    expect(src).toContain("e.key === 'ArrowUp'");
    expect(src).toContain("e.key === 'ArrowLeft'");
    expect(src).toContain("e.key === 'ArrowDown'");
    expect(src).toContain('role="slider"');
    expect(src).toContain("aria-valuemin={min}");
    expect(src).toContain("aria-valuemax={max}");
    expect(src).toContain("aria-valuenow={value}");
  });

  it("marks + tooltip hover + showValue display + disabled cursor not-allowed", () => {
    expect(src).toContain("marks && (");
    expect(src).toContain("m.label &&");
    expect(src).toContain("const [tip, setTip] = useState(false)");
    expect(src).toContain("onMouseEnter={() => setTip(true)}");
    expect(src).toContain("{isRange ? `${lo}");
    expect(src).toContain("cursor: disabled ? 'not-allowed' : 'grab'");
  });
});

/* ── Banner ── */
describe("Banner", () => {
  const src = readSrc("components/Banner.tsx");

  it("export default Banner + BannerProps + BannerVariant 4 + BannerAction", () => {
    expect(src).toMatch(/export default function Banner\b/);
    expect(src).toContain("export interface BannerProps");
    expect(src).toContain("export type BannerVariant = 'info' | 'warning' | 'error' | 'success'");
    expect(src).toContain("export interface BannerAction");
    expect(src).toContain("label: string");
    expect(src).toContain("onClick?: () => void");
    expect(src).toContain("href?: string");
  });

  it("VARIANT_CONFIG: 4 varianti con icon/bg/border/color/accent + role=alert", () => {
    expect(src).toContain("const VARIANT_CONFIG");
    for (const v of ["info", "warning", "error", "success"])
      expect(src).toContain(`${v}:`);
    expect(src).toContain("icon: '\u2139\uFE0F'");
    expect(src).toContain("icon: '\u26A0\uFE0F'");
    expect(src).toContain('role="alert"');
    expect(src).toContain("borderLeft: `3px solid ${cfg.border}`");
  });

  it("dismiss: animazione hiding opacity 0 + translateY(-4px) + setTimeout 220ms + onDismiss callback", () => {
    expect(src).toContain("const [hiding, setHiding]   = useState(false)");
    expect(src).toContain("setHiding(true)");
    expect(src).toContain("setTimeout(");
    expect(src).toContain("setVisible(false)");
    expect(src).toContain("onDismiss?.()");
    expect(src).toContain("opacity: hiding ? 0 : 1");
    expect(src).toContain("translateY(-4px)");
    expect(src).toContain('aria-label="Chiudi"');
  });

  it("action: button onClick + link href target _blank + dismissible default true + defaultVisible", () => {
    expect(src).toContain("action.href");
    expect(src).toContain('target="_blank"');
    expect(src).toContain('rel="noopener noreferrer"');
    expect(src).toContain("action.onClick");
    expect(src).toContain("dismissible = true");
    expect(src).toContain("defaultVisible = true");
    expect(src).toContain("if (!visible) return null");
  });
});
