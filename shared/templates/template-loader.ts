/**
 * Template Loader — caricamento template .md con frontmatter
 *
 * Carica file .md da directory, parsa frontmatter YAML,
 * cache in memoria, risoluzione da workspace con fallback.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import type {
  PromptTemplate,
  TemplateFrontmatter,
  ContextFile,
  BootstrapFileName,
} from "./types.js";
import { BOOTSTRAP_FILENAMES, MAX_CONTEXT_FILE_CHARS } from "./types.js";

const templateCache = new Map<string, PromptTemplate>();

/** Parsa frontmatter YAML delimitato da --- */
export function parseFrontmatter(raw: string): { frontmatter: TemplateFrontmatter; content: string } {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("---")) {
    return { frontmatter: {}, content: raw };
  }
  const endIdx = trimmed.indexOf("---", 3);
  if (endIdx === -1) {
    return { frontmatter: {}, content: raw };
  }
  const fmBlock = trimmed.slice(3, endIdx).trim();
  const content = trimmed.slice(endIdx + 3).trimStart();
  const frontmatter: TemplateFrontmatter = {};
  for (const line of fmBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key && value) frontmatter[key] = value;
  }
  return { frontmatter, content };
}

/** Carica un singolo template da file .md */
export function loadTemplate(filePath: string): PromptTemplate | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    if (!raw.trim()) return null;
    const { frontmatter, content } = parseFrontmatter(raw);
    return {
      name: basename(filePath),
      filePath,
      content,
      frontmatter,
      raw,
    };
  } catch {
    return null;
  }
}

/** Carica un template con cache */
export function loadTemplateCached(filePath: string): PromptTemplate | null {
  const cached = templateCache.get(filePath);
  if (cached) return cached;
  const template = loadTemplate(filePath);
  if (template) templateCache.set(filePath, template);
  return template;
}

/** Carica tutti i template .md da una directory */
export function loadTemplatesFromDir(dirPath: string): PromptTemplate[] {
  if (!existsSync(dirPath)) return [];
  const files = readdirSync(dirPath).filter((f) => f.endsWith(".md"));
  const templates: PromptTemplate[] = [];
  for (const file of files) {
    const t = loadTemplate(join(dirPath, file));
    if (t) templates.push(t);
  }
  return templates;
}

/** Carica i file bootstrap da una workspace directory */
export function loadBootstrapTemplates(workspaceDir: string): PromptTemplate[] {
  const templates: PromptTemplate[] = [];
  for (const name of BOOTSTRAP_FILENAMES) {
    const t = loadTemplate(join(workspaceDir, name));
    if (t) templates.push(t);
  }
  return templates;
}

/** Verifica se un file e' un bootstrap file noto */
export function isBootstrapFile(filename: string): filename is BootstrapFileName {
  return (BOOTSTRAP_FILENAMES as readonly string[]).includes(filename);
}

/** Converte template in ContextFile per iniezione nel prompt */
export function templateToContextFile(template: PromptTemplate): ContextFile {
  const content = template.content.length > MAX_CONTEXT_FILE_CHARS
    ? truncateContent(template.content, MAX_CONTEXT_FILE_CHARS)
    : template.content;
  return { path: template.filePath, content };
}

/** Converte lista di template in ContextFile[] con budget totale */
export function templatesToContextFiles(
  templates: PromptTemplate[],
  totalBudget?: number,
): ContextFile[] {
  const budget = totalBudget ?? 150_000;
  const files: ContextFile[] = [];
  let used = 0;
  for (const t of templates) {
    const remaining = budget - used;
    if (remaining < 64) break;
    const maxChars = Math.min(remaining, MAX_CONTEXT_FILE_CHARS);
    const content = t.content.length > maxChars
      ? truncateContent(t.content, maxChars)
      : t.content;
    files.push({ path: t.filePath, content });
    used += content.length;
  }
  return files;
}

/** Tronca contenuto con strategia 70/20/10 (head/tail/marker) */
export function truncateContent(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const headSize = Math.floor(maxChars * 0.7);
  const tailSize = Math.floor(maxChars * 0.2);
  const marker = "\n\n[...contenuto troncato...]\n\n";
  const head = text.slice(0, headSize);
  const tail = text.slice(-tailSize);
  return head + marker + tail;
}

/** Svuota la cache dei template */
export function clearTemplateCache(): void {
  templateCache.clear();
}
