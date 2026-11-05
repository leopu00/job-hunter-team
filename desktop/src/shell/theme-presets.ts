import type { Theme } from "./theme";
import type { Seeds, StatusColors } from "./theme-custom";

/**
 * What the editor starts from: the five seeds of each palette (ready ones and templates) and the colours of its states. The palettes
 * themselves are blocks of CSS the page cannot read for a theme that is not on it, so this table repeats them;
 * a test reads dashboard.css and fails when the two differ.
 */
export const PRESETS: Record<Theme, { seeds: Seeds; status: StatusColors }> = {
  dark: {
    seeds: { background: "#060608", panel: "#111116", text: "#c4c4d4", border: "#30303d", accent: "#31dd8a" },
    status: { "--color-yellow": "#f5c518", "--color-blue": "#68adff", "--color-red": "#ff5f75", "--color-orange": "#ff9b57", "--color-purple": "#bd76ff", "--sync-warn": "#ddb461" },
  },
  light: {
    seeds: { background: "#ebedf0", panel: "#ffffff", text: "#1d222c", border: "#a3a9b5", accent: "#08703d" },
    status: { "--color-yellow": "#7a5200", "--color-blue": "#1b5cab", "--color-red": "#b3192f", "--color-orange": "#9a3f00", "--color-purple": "#6f2da8", "--sync-warn": "#7a5200" },
  },
  graphite: {
    seeds: { background: "#141518", panel: "#1c1d21", text: "#d2d4da", border: "#4a4e58", accent: "#5aa9ff" },
    status: { "--color-yellow": "#f5c518", "--color-blue": "#68adff", "--color-red": "#ff5f75", "--color-orange": "#ff9b57", "--color-purple": "#bd76ff", "--sync-warn": "#ddb461" },
  },
  ocean: {
    seeds: { background: "#06121a", panel: "#0c202c", text: "#bad5dc", border: "#245064", accent: "#44d9e6" },
    status: { "--color-yellow": "#efd074", "--color-blue": "#66b4ff", "--color-red": "#ff7c8c", "--color-orange": "#ffae6d", "--color-purple": "#c49cff", "--sync-warn": "#e9c86c" },
  },
  paper: {
    seeds: { background: "#f4efe4", panel: "#fbf7ee", text: "#3d352d", border: "#c2b6a2", accent: "#2e6b4c" },
    status: { "--color-yellow": "#765400", "--color-blue": "#315f8a", "--color-red": "#a2323e", "--color-orange": "#8f4a16", "--color-purple": "#704d86", "--sync-warn": "#765400" },
  },
  midnight: {
    seeds: { background: "#070813", panel: "#11142a", text: "#c3c8e6", border: "#2b3160", accent: "#8f9bff" },
    status: { "--color-yellow": "#f2c94c", "--color-blue": "#6fb1ff", "--color-red": "#ff6f8a", "--color-orange": "#ff9f66", "--color-purple": "#c79bff", "--sync-warn": "#e0bd68" },
  },
  forest: {
    seeds: { background: "#07100b", panel: "#101f16", text: "#c3dccb", border: "#274636", accent: "#e9b949" },
    status: { "--color-yellow": "#f0d060", "--color-blue": "#6db6e8", "--color-red": "#ff7a7a", "--color-orange": "#f0a060", "--color-purple": "#c3a0e0", "--sync-warn": "#e0bd68" },
  },
  dusk: {
    seeds: { background: "#12070d", panel: "#220f1a", text: "#e3cdd7", border: "#4d2a41", accent: "#ff9d6b" },
    status: { "--color-yellow": "#f5c518", "--color-blue": "#78b4ff", "--color-red": "#ff7389", "--color-orange": "#ffb870", "--color-purple": "#d29cff", "--sync-warn": "#e8c06c" },
  },
  contrast: {
    seeds: { background: "#000000", panel: "#0a0a0a", text: "#e8e8e8", border: "#767676", accent: "#ffe14d" },
    status: { "--color-yellow": "#ffd400", "--color-blue": "#7fc4ff", "--color-red": "#ff8a8a", "--color-orange": "#ffa94d", "--color-purple": "#d9a8ff", "--sync-warn": "#ffd400" },
  },
  mist: {
    seeds: { background: "#dcdfe4", panel: "#eaecf0", text: "#1e222a", border: "#959ba7", accent: "#1a4fa6" },
    status: { "--color-yellow": "#7a5200", "--color-blue": "#185aa8", "--color-red": "#b3192f", "--color-orange": "#9a3f00", "--color-purple": "#6f2da8", "--sync-warn": "#7a5200" },
  },
  contrastlight: {
    seeds: { background: "#f0f0f0", panel: "#ffffff", text: "#0a0a0a", border: "#5e5e5e", accent: "#0036a8" },
    status: { "--color-yellow": "#5c3d00", "--color-blue": "#0a4590", "--color-red": "#970a20", "--color-orange": "#7a3000", "--color-purple": "#5a1f8f", "--sync-warn": "#5c3d00" },
  },
  sage: {
    seeds: { background: "#f1f4ee", panel: "#fafbf7", text: "#333d2c", border: "#bcc7b0", accent: "#2f6b3a" },
    status: { "--color-yellow": "#725c00", "--color-blue": "#2a5f94", "--color-red": "#a8303c", "--color-orange": "#8f4a16", "--color-purple": "#6b4a8a", "--sync-warn": "#725c00" },
  },
  lavender: {
    seeds: { background: "#f5f2fa", panel: "#fdfcff", text: "#372f4d", border: "#c5bbd8", accent: "#5b3fa6" },
    status: { "--color-yellow": "#7a5400", "--color-blue": "#2a5ca2", "--color-red": "#ae263f", "--color-orange": "#914000", "--color-purple": "#7330a6", "--sync-warn": "#7a5400" },
  },
};
