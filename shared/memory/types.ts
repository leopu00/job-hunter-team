// shared/memory/types.ts — Tipi per il memory system degli agenti

/** Identità visiva e personalità di un agente (da IDENTITY.md) */
export type AgentIdentity = {
  name?: string;
  emoji?: string;
  creature?: string;
  vibe?: string;
  theme?: string;
  avatar?: string;
};

/** Sezioni parsate da SOUL.md */
export type AgentSoul = {
  raw: string;
  coreTruths?: string;
  boundaries?: string;
  vibe?: string;
  continuity?: string;
};

/** Un singolo file di bootstrap caricato dal workspace */
export type BootstrapFile = {
  name: BootstrapFileName;
  filePath: string;
  content: string;
};

/** Nomi dei file di bootstrap riconosciuti */
export type BootstrapFileName =
  | 'SOUL.md'
  | 'IDENTITY.md'
  | 'MEMORY.md'
  | 'AGENTS.md'
  | 'USER.md'
  | 'TOOLS.md';

/** Risultato del caricamento completo della memoria agente */
export type AgentMemoryContext = {
  workspaceDir: string;
  identity: AgentIdentity | null;
  soul: AgentSoul | null;
  files: BootstrapFile[];
};

/** Opzioni per il memory manager */
export type MemoryManagerOptions = {
  workspaceDir: string;
  createTemplates?: boolean;
};
