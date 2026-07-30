// shared/memory/memory-manager.ts — Orchestratore caricamento memoria agente

import fs from 'node:fs';
import path from 'node:path';
import type {
  AgentMemoryContext,
  BootstrapFile,
  BootstrapFileName,
  MemoryManagerOptions,
} from './types.js';
import { loadIdentityFromWorkspace } from './identity.js';
import { loadSoulFromWorkspace } from './soul.js';
import { IDENTITY_TEMPLATE } from './identity.js';
import { SOUL_TEMPLATE } from './soul.js';

/** Nomi dei file di bootstrap riconosciuti, in ordine di caricamento */
const BOOTSTRAP_FILES: readonly BootstrapFileName[] = [
  'SOUL.md',
  'IDENTITY.md',
  'MEMORY.md',
  'AGENTS.md',
  'USER.md',
  'TOOLS.md',
];

/** File che hanno un template predefinito */
const TEMPLATES: Partial<Record<BootstrapFileName, string>> = {
  'IDENTITY.md': IDENTITY_TEMPLATE,
  'SOUL.md': SOUL_TEMPLATE,
};

/** Carica un singolo file bootstrap se esiste */
function loadBootstrapFile(
  dir: string,
  name: BootstrapFileName,
): BootstrapFile | null {
  const filePath = path.join(dir, name);
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    if (!content.trim()) return null;
    return { name, filePath, content };
  } catch {
    return null;
  }
}

/** Scrive un file template se non esiste gia */
function writeFileIfMissing(filePath: string, content: string): boolean {
  if (fs.existsSync(filePath)) return false;
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/** Crea i file template mancanti nel workspace */
export function ensureTemplates(workspaceDir: string): string[] {
  const created: string[] = [];

  // Crea la directory se non esiste
  if (!fs.existsSync(workspaceDir)) {
    fs.mkdirSync(workspaceDir, { recursive: true });
  }

  for (const [name, template] of Object.entries(TEMPLATES)) {
    const filePath = path.join(workspaceDir, name);
    if (writeFileIfMissing(filePath, template)) {
      created.push(name);
    }
  }

  return created;
}

/**
 * Carica tutti i file di bootstrap dal workspace di un agente.
 * Restituisce i file trovati con il loro contenuto.
 */
export function loadBootstrapFiles(workspaceDir: string): BootstrapFile[] {
  const files: BootstrapFile[] = [];

  // MEMORY.md: preferisci maiuscolo, fallback a minuscolo
  const memoryFile =
    loadBootstrapFile(workspaceDir, 'MEMORY.md') ??
    loadBootstrapFile(workspaceDir, 'memory.md');

  for (const name of BOOTSTRAP_FILES) {
    if (name === 'MEMORY.md') {
      if (memoryFile) files.push(memoryFile);
      continue;
    }
    const file = loadBootstrapFile(workspaceDir, name);
    if (file) files.push(file);
  }

  return files;
}

/**
 * Carica il contesto memoria completo di un agente.
 * Include identity, soul, e tutti i file bootstrap.
 */
export function loadAgentMemory(options: MemoryManagerOptions): AgentMemoryContext {
  const { workspaceDir, createTemplates = false } = options;

  if (createTemplates) {
    ensureTemplates(workspaceDir);
  }

  return {
    workspaceDir,
    identity: loadIdentityFromWorkspace(workspaceDir),
    soul: loadSoulFromWorkspace(workspaceDir),
    files: loadBootstrapFiles(workspaceDir),
  };
}

/** Verifica se un workspace ha almeno un file di memoria */
export function hasMemoryFiles(workspaceDir: string): boolean {
  return BOOTSTRAP_FILES.some((name) =>
    fs.existsSync(path.join(workspaceDir, name)),
  );
}

/** Lista i file di bootstrap presenti nel workspace */
export function listMemoryFiles(workspaceDir: string): string[] {
  return BOOTSTRAP_FILES.filter((name) =>
    fs.existsSync(path.join(workspaceDir, name)),
  );
}
