/**
 * Template Engine — sostituzione variabili e composizione prompt
 *
 * Pattern {variabile} case-insensitive, composizione sezioni
 * con priorita' e budget caratteri, iniezione context files.
 */

import type {
  TemplateVariables,
  PromptSection,
  ContextFile,
  ComposeOptions,
  ComposedPrompt,
  PromptMode,
} from "./types.js";

const VAR_PATTERN = /\{([a-zA-Z_][a-zA-Z0-9_.]*)\}/g;

/** Verifica se un testo contiene variabili template {var} */
export function hasVariables(text: string): boolean {
  return VAR_PATTERN.test(text);
}

/** Sostituisce variabili {var} nel testo. Variabili non risolte restano invariate. */
export function substituteVariables(text: string, vars: TemplateVariables): string {
  return text.replace(VAR_PATTERN, (match, key: string) => {
    const lowerKey = key.toLowerCase();
    for (const [k, v] of Object.entries(vars)) {
      if (k.toLowerCase() === lowerKey && v !== undefined) return v;
    }
    return match;
  });
}

/** Estrae i nomi delle variabili presenti in un testo */
export function extractVariableNames(text: string): string[] {
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(VAR_PATTERN.source, "g");
  while ((m = re.exec(text)) !== null) names.add(m[1]);
  return [...names];
}

/** Crea una sezione prompt */
export function createSection(
  id: string,
  content: string,
  priority = 50,
  label?: string,
): PromptSection {
  return { id, content, label, priority };
}

/** Formatta un context file come blocco iniettabile nel prompt */
export function formatContextFile(file: ContextFile): string {
  return `<context-file path="${file.path}">\n${file.content}\n</context-file>`;
}

/** Formatta tutti i context file come sezione prompt */
export function formatContextFiles(files: ContextFile[]): string {
  if (files.length === 0) return "";
  return files.map(formatContextFile).join("\n\n");
}

/** Filtra sezioni per modalita' prompt */
function filterSectionsForMode(sections: PromptSection[], mode: PromptMode): PromptSection[] {
  if (mode === "none") return [];
  if (mode === "minimal") return sections.filter((s) => s.priority >= 80);
  return sections;
}

/** Tronca testo a maxChars rispettando confini di riga */
function truncateToChars(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const cutIdx = text.lastIndexOf("\n", maxChars);
  const idx = cutIdx > maxChars * 0.5 ? cutIdx : maxChars;
  return { text: text.slice(0, idx) + "\n[...troncato...]", truncated: true };
}

/**
 * Compone un prompt completo da sezioni, context files e variabili.
 *
 * Le sezioni vengono ordinate per priorita' decrescente.
 * Il budget caratteri viene rispettato escludendo sezioni a bassa priorita'.
 */
export function composePrompt(options: ComposeOptions): ComposedPrompt {
  const {
    mode = "full",
    maxChars,
    separator = "\n\n",
    sections = [],
    contextFiles = [],
    variables,
  } = options;

  const filtered = filterSectionsForMode(sections, mode);
  const sorted = [...filtered].sort((a, b) => b.priority - a.priority);

  const parts: string[] = [];
  const included: string[] = [];
  let totalChars = 0;

  for (const section of sorted) {
    let content = section.content;
    if (variables) content = substituteVariables(content, variables);
    if (!content.trim()) continue;

    if (maxChars && totalChars + content.length + separator.length > maxChars) {
      const remaining = maxChars - totalChars - separator.length;
      if (remaining < 64) continue;
      const { text } = truncateToChars(content, remaining);
      parts.push(text);
      included.push(section.id);
      totalChars += text.length + separator.length;
      break;
    }

    parts.push(content);
    included.push(section.id);
    totalChars += content.length + separator.length;
  }

  if (contextFiles.length > 0) {
    const cfBlock = formatContextFiles(contextFiles);
    if (!maxChars || totalChars + cfBlock.length < maxChars) {
      parts.push(cfBlock);
      included.push("context-files");
      totalChars += cfBlock.length;
    }
  }

  const text = parts.join(separator);
  return {
    text,
    charCount: text.length,
    sectionCount: included.length,
    truncated: maxChars ? text.length >= maxChars * 0.95 : false,
    includedSections: included,
  };
}

/**
 * Shortcut: applica variabili a un template e ritorna il testo risultante.
 */
export function renderTemplate(templateContent: string, vars: TemplateVariables): string {
  return substituteVariables(templateContent, vars);
}
