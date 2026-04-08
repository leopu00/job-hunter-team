/**
 * TeamPanel — vista panoramica del team JHT.
 * Layout pulito: cartella lavoro, profilo %, team orizzontale.
 */
import { Container, Text } from "@mariozechner/pi-tui";
import { theme } from "../tui-theme.js";
import type { TmuxSession } from "../tui-tmux.js";
import { getMissingProfileFields, isProfileComplete, loadProfile, loadWorkspacePath } from "../tui-profile.js";

type AgentDef = { id: string; label: string; emoji: string; aliases: string[] };

const AGENTS: AgentDef[] = [
  { id: "scout", label: "Scout", emoji: "🕵️", aliases: ["scout"] },
  { id: "analista", label: "Analista", emoji: "🔬", aliases: ["analista"] },
  { id: "assistente", label: "Assistente", emoji: "💼", aliases: ["assistente"] },
  { id: "critico", label: "Critico", emoji: "⚖️", aliases: ["critico"] },
  { id: "scorer", label: "Scorer", emoji: "💻", aliases: ["scorer"] },
  { id: "scrittore", label: "Scrittore", emoji: "📝", aliases: ["scrittore"] },
  { id: "sentinella", label: "Sentinella", emoji: "💂", aliases: ["sentinella"] },
  { id: "alfa", label: "Alfa", emoji: "✈️", aliases: ["alfa"] },
];

const ACTIONS = [
  { id: "workspace", label: "📁 Cambia cartella", cmd: "/workspace" },
  { id: "profile", label: "👤 Configura profilo", cmd: "/profile" },
  { id: "dashboard", label: "📊 Dashboard", cmd: "/dashboard" },
  { id: "assistente", label: "🤖 Assistente", cmd: "/start assistente" },
  { id: "scout", label: "🔍 Scout", cmd: "/start scout" },
] as const;

function calcProfilePercent(): number {
  const profile = loadProfile();
  let filled = 0;
  if (profile.nome.trim()) filled++;
  if (profile.cognome.trim()) filled++;
  if (profile.dataNascita.trim()) filled++;
  if (profile.competenze.length > 0) filled++;
  if (profile.zona.trim()) filled++;
  if (profile.tipoLavoro.trim()) filled++;
  return Math.round((filled / 6) * 100);
}

export class TeamPanel extends Container {
  private selectedIndex = 0;

  refresh(sessions: TmuxSession[]) {
    this.clear();

    const workspace = loadWorkspacePath();
    const profile = loadProfile();
    const profilePct = calcProfilePercent();
    const profileComplete = isProfileComplete(profile);
    const missing = getMissingProfileFields(profile);
    const sessionSet = new Set(sessions.map((s) => s.agentId));

    // ── Cartella di lavoro ──
    this.add("");
    this.add(`  📁 ${theme.accent("Cartella di lavoro")}`);
    this.add(`     ${workspace || theme.dim("(non impostata)")}`);
    this.add("");

    // ── Profilo ──
    const profileColor = profileComplete ? theme.success : profilePct > 50 ? theme.warning : theme.dim;
    this.add(`  👤 ${theme.accent("Profilo")} ${profileColor(`${profilePct}%`)}`);
    if (!profileComplete) {
      this.add(`     ${theme.dim("Manca: " + missing.join(", "))}`);
    } else {
      this.add(`     ${theme.success("✓ Completato")}`);
    }
    this.add("");

    // ── Menu azioni ──
    this.add(`  ${theme.accent("Menu")}`);
    for (let i = 0; i < ACTIONS.length; i++) {
      const act = ACTIONS[i];
      const selected = i === this.selectedIndex;
      const prefix = selected ? "❯ " : "  ";
      this.add(`     ${prefix}${selected ? theme.bold(act.label) : theme.dim(act.label)}`);
    }
    this.add("");

    // ── Team orizzontale ──
    this.add(`  ${theme.accent("Team")}`);
    const agentLine = AGENTS.map((a) => {
      const active = sessionSet.has(a.id);
      const status = active ? theme.success("●") : theme.dim("○");
      return `${status} ${a.emoji} ${active ? theme.text(a.label) : theme.dim(a.label)}`;
    }).join("  ");
    this.add(`     ${agentLine}`);
    this.add("");

    // ── Aiuto minimale ──
    this.add(theme.dim("  ↑/↓ naviga · Enter attiva · Tab cambia vista"));
  }

  moveSelection(delta: number): boolean {
    const next = this.selectedIndex + delta;
    if (next < 0 || next >= ACTIONS.length) return false;
    this.selectedIndex = next;
    return true;
  }

  getSelectedAction(): { id: string; label: string; cmd: string } | null {
    return ACTIONS[this.selectedIndex] ?? null;
  }

  private add(text: string) {
    this.addChild(new Text(text, 0, 0));
  }
}
