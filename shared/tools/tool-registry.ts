/**
 * Tool Registry — Registrazione e lookup dei tool
 *
 * Registry singleton che gestisce tool core e custom.
 * Supporta profili (minimal/coding/full) e sezioni per organizzazione.
 */

import type {
  Tool,
  ToolDefinition,
  ToolProfileId,
  ToolProfilePolicy,
  ToolSection,
} from "./types.js";

// --- Sezioni catalogo ---

const TOOL_SECTIONS: ToolSection[] = [
  { id: "fs", label: "Files" },
  { id: "runtime", label: "Runtime" },
  { id: "web", label: "Web" },
  { id: "memory", label: "Memory" },
  { id: "sessions", label: "Sessions" },
  { id: "automation", label: "Automation" },
];

// --- Tool definitions core ---

const CORE_TOOL_DEFINITIONS: ToolDefinition[] = [
  { id: "read", label: "read", description: "Legge contenuto file", sectionId: "fs", profiles: ["coding"] },
  { id: "write", label: "write", description: "Crea o sovrascrive file", sectionId: "fs", profiles: ["coding"] },
  { id: "edit", label: "edit", description: "Modifiche precise a file", sectionId: "fs", profiles: ["coding"] },
  { id: "exec", label: "exec", description: "Esegue comandi shell", sectionId: "runtime", profiles: ["coding"] },
  { id: "process", label: "process", description: "Gestisce processi background", sectionId: "runtime", profiles: ["coding"] },
  { id: "web_search", label: "web_search", description: "Ricerca sul web", sectionId: "web", profiles: ["coding"] },
  { id: "web_fetch", label: "web_fetch", description: "Scarica contenuto web", sectionId: "web", profiles: ["coding"] },
  { id: "memory_search", label: "memory_search", description: "Ricerca semantica", sectionId: "memory", profiles: ["coding"] },
  { id: "sessions_list", label: "sessions_list", description: "Elenca sessioni", sectionId: "sessions", profiles: ["coding"] },
  { id: "cron", label: "cron", description: "Programma task ricorrenti", sectionId: "automation", profiles: ["coding"] },
];

// --- Registry ---

const toolInstances = new Map<string, Tool>();
const customDefinitions: ToolDefinition[] = [];

export function registerTool(tool: Tool): void {
  toolInstances.set(tool.name, tool);
}

export function getTool(name: string): Tool | undefined {
  return toolInstances.get(name);
}

export function listTools(): Tool[] {
  return Array.from(toolInstances.values());
}

export function registerCustomDefinition(def: ToolDefinition): void {
  customDefinitions.push(def);
}

export function listAllDefinitions(): ToolDefinition[] {
  return [...CORE_TOOL_DEFINITIONS, ...customDefinitions];
}

// --- Profili ---

function listToolIdsForProfile(profile: ToolProfileId): string[] {
  return listAllDefinitions()
    .filter((t) => t.profiles.includes(profile))
    .map((t) => t.id);
}

export function resolveProfilePolicy(profile?: ToolProfileId): ToolProfilePolicy | undefined {
  if (!profile) return undefined;
  if (profile === "full") return undefined;
  const allow = listToolIdsForProfile(profile);
  return allow.length > 0 ? { allow } : undefined;
}

// --- Sezioni e catalogo ---

export function listSections(): Array<ToolSection & { tools: ToolDefinition[] }> {
  const allDefs = listAllDefinitions();
  return TOOL_SECTIONS
    .map((section) => ({
      ...section,
      tools: allDefs.filter((t) => t.sectionId === section.id),
    }))
    .filter((s) => s.tools.length > 0);
}

export function isKnownToolId(toolId: string): boolean {
  return listAllDefinitions().some((t) => t.id === toolId);
}
