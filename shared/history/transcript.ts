/**
 * History — Persistenza transcript JSONL
 */
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import type {
  HistoryMessage,
  TranscriptHeader,
  TranscriptLine,
  TranscriptData,
  HistoryConfig,
} from './types.js';
import { createTranscriptHeader, DEFAULT_HISTORY_CONFIG } from './types.js';

const DEFAULT_BASE_DIR = path.join(homedir(), '.jht', 'history');

export function resolveBaseDir(config?: HistoryConfig): string {
  return config?.baseDir ?? DEFAULT_BASE_DIR;
}

export function resolveTranscriptPath(sessionId: string, config?: HistoryConfig): string {
  const baseDir = resolveBaseDir(config);
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(baseDir, `${safe}.jsonl`);
}

export function ensureTranscriptFile(sessionId: string, config?: HistoryConfig): string {
  const filePath = resolveTranscriptPath(sessionId, config);
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    const header = createTranscriptHeader(sessionId, process.cwd());
    fs.writeFileSync(filePath, JSON.stringify(header) + '\n', 'utf-8');
  }

  return filePath;
}

/** Appende un messaggio al transcript JSONL. Crea il file se non esiste. */
export function appendMessage(
  sessionId: string,
  message: HistoryMessage,
  config?: HistoryConfig,
): void {
  const filePath = ensureTranscriptFile(sessionId, config);

  const id = message.id ?? `msg-${Date.now()}`;
  const line: TranscriptLine = { id, message };

  fs.appendFileSync(filePath, JSON.stringify(line) + '\n', 'utf-8');

  // Enforce limits
  enforceLimits(filePath, config);
}

/** Appende piu' messaggi in batch. */
export function appendMessages(
  sessionId: string,
  messages: HistoryMessage[],
  config?: HistoryConfig,
): void {
  if (messages.length === 0) return;
  const filePath = ensureTranscriptFile(sessionId, config);

  const lines = messages.map((msg) => {
    const id = msg.id ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    return JSON.stringify({ id, message: msg } satisfies TranscriptLine);
  });

  fs.appendFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
  enforceLimits(filePath, config);
}

/** Legge un transcript JSONL e ritorna header + messaggi. */
export function loadTranscript(sessionId: string, config?: HistoryConfig): TranscriptData {
  const filePath = resolveTranscriptPath(sessionId, config);

  if (!fs.existsSync(filePath)) {
    return { header: null, messages: [], lineCount: 0 };
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);

  let header: TranscriptHeader | null = null;
  const messages: HistoryMessage[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'session') {
        header = parsed as TranscriptHeader;
      } else if (parsed.message) {
        messages.push(parsed.message as HistoryMessage);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return { header, messages, lineCount: lines.length };
}

/** Archivia un transcript (rinomina con suffisso .archived.TIMESTAMP). */
export function archiveTranscript(sessionId: string, config?: HistoryConfig): boolean {
  const filePath = resolveTranscriptPath(sessionId, config);
  if (!fs.existsSync(filePath)) return false;

  const archivePath = `${filePath}.archived.${Date.now()}`;
  fs.renameSync(filePath, archivePath);
  return true;
}

export function deleteTranscript(sessionId: string, config?: HistoryConfig): boolean {
  const filePath = resolveTranscriptPath(sessionId, config);
  if (!fs.existsSync(filePath)) return false;

  fs.unlinkSync(filePath);
  return true;
}

export function listTranscriptSessionIds(config?: HistoryConfig): string[] {
  const baseDir = resolveBaseDir(config);
  if (!fs.existsSync(baseDir)) return [];

  return fs.readdirSync(baseDir)
    .filter((f) => f.endsWith('.jsonl') && !f.includes('.archived.'))
    .map((f) => f.replace('.jsonl', ''));
}

function enforceLimits(filePath: string, config?: HistoryConfig): void {
  const maxMessages = config?.maxMessages ?? DEFAULT_HISTORY_CONFIG.maxMessages ?? 0;
  const maxBytes = config?.maxBytes ?? DEFAULT_HISTORY_CONFIG.maxBytes ?? 0;

  if (maxMessages <= 0 && maxBytes <= 0) return;

  if (maxBytes > 0) {
    const stat = fs.statSync(filePath);
    if (stat.size > maxBytes) truncateOldestMessages(filePath, maxMessages || 100);
  }

  if (maxMessages > 0) {
    truncateOldestMessages(filePath, maxMessages);
  }
}

function truncateOldestMessages(filePath: string, keep: number): void {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);

  const headerLines: string[] = [];
  const msgLines: string[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'session') headerLines.push(line);
      else msgLines.push(line);
    } catch {
      // skip
    }
  }

  if (msgLines.length <= keep) return;

  const kept = msgLines.slice(-keep);
  const output = [...headerLines, ...kept].join('\n') + '\n';
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, output, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}
