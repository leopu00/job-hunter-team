/**
 * Hook Loader — Scoperta e caricamento hook da filesystem
 *
 * Scansiona directory hook, legge HOOK.md con frontmatter YAML,
 * importa handler dinamicamente, registra nel registry.
 */

import fs from "node:fs";
import path from "node:path";
import type {
  Hook,
  HookEntry,
  HookHandler,
  HookMetadata,
  HookSource,
  HooksConfig,
  HOOK_SOURCE_PRECEDENCE,
} from "./types.js";
import {
  registerHook,
  resolveHookEntries,
  filterEligibleHooks,
} from "./registry.js";

const HOOK_MD = "HOOK.md";
const HANDLER_FILES = ["handler.ts", "handler.js", "handler.mjs"];

// --- Frontmatter parsing ---

function parseFrontmatter(content: string): { metadata: HookMetadata; description: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { metadata: { events: [] }, description: content };
  }

  const yamlBlock = match[1];
  const description = match[2].trim();
  const metadata: HookMetadata = { events: [] };

  for (const line of yamlBlock.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("emoji:")) metadata.emoji = trimmed.slice(6).trim().replace(/['"]/g, "");
    if (trimmed.startsWith("always:")) metadata.always = trimmed.slice(7).trim() === "true";
    if (trimmed.startsWith("- ") && metadata.events !== undefined) {
      const val = trimmed.slice(2).trim().replace(/['"]/g, "");
      if (val.includes(":")) metadata.events.push(val);
    }
  }

  return { metadata, description };
}

// --- Directory scanning ---

function findHandlerPath(hookDir: string): string | undefined {
  for (const name of HANDLER_FILES) {
    const p = path.join(hookDir, name);
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

/**
 * Scansiona una directory per hook (ogni sottocartella con HOOK.md).
 */
export function discoverHooksInDir(dir: string, source: HookSource): HookEntry[] {
  if (!fs.existsSync(dir)) return [];

  const entries: HookEntry[] = [];
  let items: string[];
  try {
    items = fs.readdirSync(dir);
  } catch {
    return [];
  }

  for (const item of items) {
    const hookDir = path.join(dir, item);
    const stat = fs.statSync(hookDir, { throwIfNoEntry: false });
    if (!stat?.isDirectory()) continue;

    const hookMdPath = path.join(hookDir, HOOK_MD);
    if (!fs.existsSync(hookMdPath)) continue;

    const handlerPath = findHandlerPath(hookDir);
    if (!handlerPath) continue;

    let content: string;
    try {
      content = fs.readFileSync(hookMdPath, "utf-8");
    } catch {
      continue;
    }

    const { metadata, description } = parseFrontmatter(content);

    const hook: Hook = {
      name: item,
      description,
      source,
      baseDir: hookDir,
      handlerPath,
    };

    entries.push({ hook, metadata, enabled: true });
  }

  return entries;
}

// --- Dynamic loading ---

/**
 * Carica e registra tutti gli hook eligibili da una lista di entry.
 * Ritorna il numero di handler registrati.
 */
export async function loadHooks(
  entries: HookEntry[],
  config?: HooksConfig,
): Promise<number> {
  const precedence = await import("./types.js").then((m) => m.HOOK_SOURCE_PRECEDENCE);
  const resolved = resolveHookEntries(entries, precedence);
  const eligible = filterEligibleHooks(resolved, config);

  let count = 0;

  for (const entry of eligible) {
    try {
      const mod = await import(entry.hook.handlerPath);
      const handler: HookHandler = mod.default ?? mod.handler;
      if (typeof handler !== "function") continue;

      for (const event of entry.metadata.events) {
        registerHook(event, entry.hook.name, handler);
        count++;
      }
    } catch (err) {
      console.error(`[hooks] errore caricamento hook "${entry.hook.name}":`, err);
    }
  }

  return count;
}

/**
 * Scopre e carica hook dal workspace di un agente.
 */
export async function loadHooksFromWorkspace(
  workspaceDir: string,
  config?: HooksConfig,
): Promise<number> {
  const hooksDir = path.join(workspaceDir, "hooks");
  const entries = discoverHooksInDir(hooksDir, "workspace");
  return loadHooks(entries, config);
}
