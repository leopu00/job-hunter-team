// shared/memory/identity.ts — Parsing e caricamento IDENTITY.md

import fs from 'node:fs';
import path from 'node:path';
import type { AgentIdentity } from './types.js';

const IDENTITY_FILENAME = 'IDENTITY.md';

const PLACEHOLDER_VALUES = new Set([
  'pick something you like',
  'ai? robot? familiar? ghost in the machine? something weirder?',
  'how do you come across? sharp? warm? chaotic? calm?',
  'your signature - pick one that feels right',
  'workspace-relative path, http(s) url, or data uri',
]);

function normalizeValue(value: string): string {
  let normalized = value.trim();
  normalized = normalized.replace(/^[*_]+|[*_]+$/g, '').trim();
  if (normalized.startsWith('(') && normalized.endsWith(')')) {
    normalized = normalized.slice(1, -1).trim();
  }
  normalized = normalized.replace(/[\u2013\u2014]/g, '-');
  normalized = normalized.replace(/\s+/g, ' ').toLowerCase();
  return normalized;
}

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_VALUES.has(normalizeValue(value));
}

/** Parsa il contenuto markdown di un file IDENTITY.md */
export function parseIdentityMarkdown(content: string): AgentIdentity {
  const identity: AgentIdentity = {};
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const cleaned = line.trim().replace(/^\s*-\s*/, '');
    const colonIndex = cleaned.indexOf(':');
    if (colonIndex === -1) continue;

    const label = cleaned.slice(0, colonIndex).replace(/[*_]/g, '').trim().toLowerCase();
    const value = cleaned.slice(colonIndex + 1).replace(/^[*_]+|[*_]+$/g, '').trim();

    if (!value || isPlaceholder(value)) continue;

    if (label === 'name') identity.name = value;
    if (label === 'emoji') identity.emoji = value;
    if (label === 'creature') identity.creature = value;
    if (label === 'vibe') identity.vibe = value;
    if (label === 'theme') identity.theme = value;
    if (label === 'avatar') identity.avatar = value;
  }

  return identity;
}

/** Verifica se un'identità ha almeno un campo valorizzato */
export function identityHasValues(identity: AgentIdentity): boolean {
  return Boolean(
    identity.name || identity.emoji || identity.theme ||
    identity.creature || identity.vibe || identity.avatar,
  );
}

/** Carica e parsa IDENTITY.md da un path specifico */
export function loadIdentityFromFile(filePath: string): AgentIdentity | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseIdentityMarkdown(content);
    return identityHasValues(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Carica IDENTITY.md dalla directory workspace di un agente */
export function loadIdentityFromWorkspace(workspaceDir: string): AgentIdentity | null {
  return loadIdentityFromFile(path.join(workspaceDir, IDENTITY_FILENAME));
}

/** Risolve il nome display di un agente dalla sua identità */
export function resolveIdentityName(identity: AgentIdentity | null): string | undefined {
  return identity?.name?.trim() || undefined;
}

/** Formato prefisso: [Nome] per messaggi */
export function resolveIdentityPrefix(identity: AgentIdentity | null): string | undefined {
  const name = resolveIdentityName(identity);
  return name ? `[${name}]` : undefined;
}

/** Template IDENTITY.md per nuovi workspace */
export const IDENTITY_TEMPLATE = `# IDENTITY.md - Chi Sono?

_Compila questo file durante la prima conversazione._

- **Name:**
  _(scegli un nome)_
- **Creature:**
  _(AI? robot? famiglio? fantasma nella macchina?)_
- **Vibe:**
  _(come ti presenti? preciso? caldo? caotico? calmo?)_
- **Emoji:**
  _(la tua firma — scegli quella giusta)_
- **Avatar:**
  _(path relativo al workspace, URL http(s), o data URI)_

---

Questo non e' solo metadata. E' l'inizio della tua identita'.
`;
