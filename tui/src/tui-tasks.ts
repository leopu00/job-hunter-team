/**
 * Task reader — legge i file task da ~/.jht-dev/tasks/.
 * Parsa il frontmatter YAML e restituisce dati strutturati.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type JhtTask = {
  id: string;
  richiesta: string;
  da: string;
  assegnato_a: string;
  branch: string;
  stato: string;
  creato: string;
  aggiornato: string;
};

const TASKS_DIR = join(homedir(), ".jht-dev", "tasks");

function parseTaskFrontmatter(content: string): JhtTask | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match?.[1]) return null;
  const yaml = match[1];
  const fields: Record<string, string> = {};
  for (const line of yaml.split("\n")) {
    const m = line.match(/^(\w[\w_]*?):\s*"?(.+?)"?\s*$/);
    if (m?.[1] && m[2]) fields[m[1]] = m[2];
  }
  if (!fields.id) return null;
  return {
    id: fields.id,
    richiesta: fields.richiesta ?? "",
    da: fields.da ?? "",
    assegnato_a: fields.assegnato_a ?? "",
    branch: fields.branch ?? "",
    stato: fields.stato ?? "",
    creato: fields.creato ?? "",
    aggiornato: fields.aggiornato ?? "",
  };
}

/** Carica tutti i task da ~/.jht-dev/tasks/ */
export function loadTasks(): JhtTask[] {
  try {
    const files = readdirSync(TASKS_DIR)
      .filter((f) => f.startsWith("task-") && f.endsWith(".md"))
      .sort();
    return files
      .map((f) => {
        try {
          return parseTaskFrontmatter(readFileSync(join(TASKS_DIR, f), "utf-8"));
        } catch {
          return null;
        }
      })
      .filter((t): t is JhtTask => t !== null);
  } catch {
    return [];
  }
}

/** Conta i task per stato */
export function countByStatus(tasks: JhtTask[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of tasks) {
    const s = t.stato || "unknown";
    counts[s] = (counts[s] ?? 0) + 1;
  }
  return counts;
}
