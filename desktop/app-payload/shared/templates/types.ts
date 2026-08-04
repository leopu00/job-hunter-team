/**
 * Template system — Tipi core
 *
 * Strutture per template .md, variabili, sezioni prompt,
 * e composizione con budget di caratteri.
 */

// ── Template ───────────────────────────────────────────────────────────────

/** Frontmatter YAML estratto da un template .md */
export type TemplateFrontmatter = {
  title?: string;
  summary?: string;
  read_when?: string;
  [key: string]: string | undefined;
};

/** Template caricato da file .md */
export type PromptTemplate = {
  name: string;
  filePath: string;
  content: string;
  frontmatter: TemplateFrontmatter;
  raw: string;
};

/** File di contesto iniettato nel prompt */
export type ContextFile = {
  path: string;
  content: string;
};

// ── Variabili ──────────────────────────────────────────────────────────────

/** Mappa variabili per sostituzione: { nomeVar: valore } */
export type TemplateVariables = Record<string, string | undefined>;

// ── Sezioni prompt ─────────────────────────────────────────────────────────

/** Singola sezione di un prompt composto */
export type PromptSection = {
  id: string;
  label?: string;
  content: string;
  priority: number;
};

/** Modalita' di composizione prompt */
export type PromptMode = "full" | "minimal" | "none";

/** Opzioni di composizione */
export type ComposeOptions = {
  mode?: PromptMode;
  maxChars?: number;
  separator?: string;
  sections?: PromptSection[];
  contextFiles?: ContextFile[];
  variables?: TemplateVariables;
};

/** Risultato della composizione */
export type ComposedPrompt = {
  text: string;
  charCount: number;
  sectionCount: number;
  truncated: boolean;
  includedSections: string[];
};

// ── Costanti budget ────────────────────────────────────────────────────────

/** Budget massimo per singolo file di contesto (caratteri) */
export const MAX_CONTEXT_FILE_CHARS = 20_000;

/** Budget massimo totale per tutti i file di contesto */
export const MAX_TOTAL_CONTEXT_CHARS = 150_000;

/** Budget minimo per file (sotto questo viene escluso) */
export const MIN_FILE_BUDGET_CHARS = 64;

// ── Nomi file bootstrap ────────────────────────────────────────────────────

export const BOOTSTRAP_FILENAMES = [
  "SOUL.md",
  "IDENTITY.md",
  "MEMORY.md",
  "AGENTS.md",
  "USER.md",
  "TOOLS.md",
  "HEARTBEAT.md",
  "BOOTSTRAP.md",
] as const;

export type BootstrapFileName = (typeof BOOTSTRAP_FILENAMES)[number];
