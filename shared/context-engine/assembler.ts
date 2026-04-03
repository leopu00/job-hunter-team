/**
 * JHT Context Engine — Assembler: costruisce contesto per chiamate AI
 *
 * Prende sezioni (system, memory, tools, history) e le assembla
 * in un array di messaggi rispettando il budget di token.
 * Sezioni con priorita' piu' alta vengono incluse per prime.
 */
import type {
  ContextSection,
  ContextMessage,
  AssembleResult,
  SectionPriority,
} from './types.js';
import { estimateSectionTokens, estimateMessageTokens } from './types.js';

const PRIORITY_ORDER: Record<SectionPriority, number> = {
  required: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function sortByPriority(sections: ContextSection[]): ContextSection[] {
  return [...sections].sort(
    (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
  );
}

/**
 * Tronca i messaggi di una sezione per rientrare nel budget.
 * Rimuove i messaggi piu' vecchi (inizio array) mantenendo i recenti.
 */
function truncateSection(
  section: ContextSection,
  maxTokens: number,
): ContextMessage[] {
  const messages = section.messages;
  if (messages.length === 0) return [];

  let totalTokens = 0;
  const kept: ContextMessage[] = [];

  // Scorri dal piu' recente al piu' vecchio
  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens = estimateMessageTokens(messages[i]);
    if (totalTokens + msgTokens > maxTokens) break;
    totalTokens += msgTokens;
    kept.unshift(messages[i]);
  }

  return kept;
}

/**
 * Assembla contesto da sezioni multiple rispettando un budget.
 *
 * Strategia:
 * 1. Sezioni "required" vengono sempre incluse (system prompt)
 * 2. Budget rimanente allocato per priorita' (high > medium > low)
 * 3. Sezioni troppo grandi vengono troncate (messaggi vecchi rimossi)
 * 4. Sezioni che non entrano nel budget vengono scartate
 */
export function assembleContext(params: {
  sections: ContextSection[];
  tokenBudget: number;
}): AssembleResult {
  const { tokenBudget } = params;
  const sorted = sortByPriority(params.sections);

  const allMessages: ContextMessage[] = [];
  const includedSections: string[] = [];
  const droppedSections: string[] = [];
  let totalTokens = 0;

  for (const section of sorted) {
    const sectionTokens = estimateSectionTokens(section);
    const sectionMax = section.maxTokens ?? Infinity;
    const remainingBudget = tokenBudget - totalTokens;

    // Sezioni required: includi sempre (tronca se necessario)
    if (section.priority === 'required') {
      const budget = Math.min(sectionMax, remainingBudget);
      const messages =
        sectionTokens <= budget
          ? section.messages
          : truncateSection(section, budget);

      if (messages.length > 0) {
        allMessages.push(...messages);
        totalTokens += messages.reduce(
          (sum, msg) => sum + estimateMessageTokens(msg),
          0,
        );
        includedSections.push(section.id);
      }
      continue;
    }

    // Altre sezioni: includi se c'e' budget
    if (remainingBudget <= 0) {
      droppedSections.push(section.id);
      continue;
    }

    const budget = Math.min(sectionMax, remainingBudget);
    if (sectionTokens <= budget) {
      allMessages.push(...section.messages);
      totalTokens += sectionTokens;
      includedSections.push(section.id);
    } else if (budget > 50) {
      // Tronca se c'e' abbastanza spazio per almeno qualcosa di utile
      const messages = truncateSection(section, budget);
      if (messages.length > 0) {
        allMessages.push(...messages);
        totalTokens += messages.reduce(
          (sum, msg) => sum + estimateMessageTokens(msg),
          0,
        );
        includedSections.push(section.id);
      } else {
        droppedSections.push(section.id);
      }
    } else {
      droppedSections.push(section.id);
    }
  }

  return {
    messages: allMessages,
    estimatedTokens: totalTokens,
    includedSections,
    droppedSections,
  };
}

// --- Section Builder Helpers ---

export function systemSection(content: string): ContextSection {
  return {
    id: 'system',
    priority: 'required',
    messages: [{ role: 'system', content }],
  };
}

export function memorySection(memories: string[]): ContextSection {
  if (memories.length === 0) return { id: 'memory', priority: 'high', messages: [] };
  return {
    id: 'memory',
    priority: 'high',
    messages: [{ role: 'system', content: `Memoria rilevante:\n${memories.join('\n')}` }],
  };
}

export function toolsSection(tools: Array<{ name: string; description: string }>): ContextSection {
  if (tools.length === 0) return { id: 'tools', priority: 'medium', messages: [] };
  const desc = tools.map((t) => `- ${t.name}: ${t.description}`).join('\n');
  return {
    id: 'tools',
    priority: 'medium',
    messages: [{ role: 'system', content: `Tool disponibili:\n${desc}` }],
  };
}

export function historySection(messages: ContextMessage[]): ContextSection {
  return { id: 'history', priority: 'high', messages };
}
