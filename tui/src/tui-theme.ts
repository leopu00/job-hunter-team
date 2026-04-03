import chalk from "chalk";
import type { AgentStatus } from "./tui-types.js";

function isLightBackground(): boolean {
  const explicit = process.env.JHT_THEME?.toLowerCase();
  if (explicit === "light") return true;
  if (explicit === "dark") return false;
  return false;
}

export const lightMode = isLightBackground();

export const darkPalette = {
  text: "#E8E3D5",
  dim: "#7B7F87",
  accent: "#F6C453",
  accentSoft: "#F2A65A",
  border: "#3C414B",
  borderSelected: "#F6C453",
  headerBg: "#1A1D23",
  userBg: "#2B2F36",
  systemText: "#9BA3B2",
  error: "#F97066",
  success: "#7DD3A5",
  warning: "#F6C453",
  agentIdle: "#7DD3A5",
  agentWorking: "#F6C453",
  agentError: "#F97066",
  agentOffline: "#7B7F87",
  selectedRow: "#2B2F36",
} as const;

export const lightPalette = {
  text: "#1E1E1E",
  dim: "#5B6472",
  accent: "#B45309",
  accentSoft: "#C2410C",
  border: "#5B6472",
  borderSelected: "#B45309",
  headerBg: "#F3F0E8",
  userBg: "#F3F0E8",
  systemText: "#4B5563",
  error: "#DC2626",
  success: "#047857",
  warning: "#B45309",
  agentIdle: "#047857",
  agentWorking: "#B45309",
  agentError: "#DC2626",
  agentOffline: "#5B6472",
  selectedRow: "#F3F0E8",
} as const;

export const palette = lightMode ? lightPalette : darkPalette;

const fg = (hex: string) => (text: string) => chalk.hex(hex)(text);

export const theme = {
  text: fg(palette.text),
  dim: fg(palette.dim),
  accent: fg(palette.accent),
  accentSoft: fg(palette.accentSoft),
  border: fg(palette.border),
  borderSelected: fg(palette.borderSelected),
  system: fg(palette.systemText),
  error: fg(palette.error),
  success: fg(palette.success),
  warning: fg(palette.warning),
  bold: (text: string) => chalk.bold(text),
  header: (text: string) => chalk.bold(fg(palette.accent)(text)),
  selectedRow: (text: string) => chalk.bgHex(palette.selectedRow)(text),

  agentStatus: (status: AgentStatus) => {
    switch (status) {
      case "idle":
        return fg(palette.agentIdle);
      case "working":
        return fg(palette.agentWorking);
      case "error":
        return fg(palette.agentError);
      case "offline":
        return fg(palette.agentOffline);
    }
  },

  agentStatusIcon: (status: AgentStatus): string => {
    switch (status) {
      case "idle":
        return "●";
      case "working":
        return "◐";
      case "error":
        return "✗";
      case "offline":
        return "○";
    }
  },
};
