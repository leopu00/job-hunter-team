/**
 * Test unitari — shared/memory/identity.ts e memory-manager.ts
 *
 * Esegui con: npx tsx --test tests/test_memory_identity.ts
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseIdentityMarkdown,
  identityHasValues,
  loadIdentityFromFile,
  resolveIdentityName,
  resolveIdentityPrefix,
} from '../shared/memory/identity.js';
import {
  ensureTemplates,
  loadBootstrapFiles,
  loadAgentMemory,
  hasMemoryFiles,
  listMemoryFiles,
} from '../shared/memory/memory-manager.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jht-test-identity-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- identity.ts ---

describe('parseIdentityMarkdown', () => {
  it('parsa campi con formato bold markdown', () => {
    const content = `# IDENTITY.md
- **Name:** Sol
- **Emoji:** 🛠️
- **Creature:** AI assistant
- **Vibe:** preciso e diretto
`;
    const id = parseIdentityMarkdown(content);
    assert.equal(id.name, 'Sol');
    assert.equal(id.emoji, '🛠️');
    assert.equal(id.creature, 'AI assistant');
    assert.equal(id.vibe, 'preciso e diretto');
  });

  it('ignora valori placeholder', () => {
    const content = `- **Name:** pick something you like
- **Creature:** AI? robot? familiar? ghost in the machine? something weirder?
`;
    const id = parseIdentityMarkdown(content);
    assert.equal(id.name, undefined);
    assert.equal(id.creature, undefined);
  });

  it('gestisce contenuto vuoto', () => {
    const id = parseIdentityMarkdown('');
    assert.equal(identityHasValues(id), false);
  });
});

describe('identityHasValues', () => {
  it('true se almeno un campo valorizzato', () => {
    assert.equal(identityHasValues({ name: 'Sol' }), true);
    assert.equal(identityHasValues({ emoji: '🔥' }), true);
  });

  it('false se nessun campo valorizzato', () => {
    assert.equal(identityHasValues({}), false);
  });
});

describe('loadIdentityFromFile', () => {
  it('carica e parsa IDENTITY.md valido', () => {
    const filePath = path.join(tmpDir, 'IDENTITY.md');
    fs.writeFileSync(filePath, '- **Name:** TestAgent\n- **Emoji:** 🤖');
    const id = loadIdentityFromFile(filePath);
    assert.notEqual(id, null);
    assert.equal(id!.name, 'TestAgent');
  });

  it('ritorna null per file con solo placeholder', () => {
    const filePath = path.join(tmpDir, 'IDENTITY.md');
    fs.writeFileSync(filePath, '- **Name:** pick something you like');
    assert.equal(loadIdentityFromFile(filePath), null);
  });
});

describe('resolveIdentityName / resolveIdentityPrefix', () => {
  it('risolve nome e prefisso', () => {
    assert.equal(resolveIdentityName({ name: 'Sol' }), 'Sol');
    assert.equal(resolveIdentityPrefix({ name: 'Sol' }), '[Sol]');
  });

  it('ritorna undefined per null', () => {
    assert.equal(resolveIdentityName(null), undefined);
    assert.equal(resolveIdentityPrefix(null), undefined);
  });
});

// --- memory-manager.ts ---

describe('ensureTemplates', () => {
  it('crea SOUL.md e IDENTITY.md se mancanti', () => {
    const wsDir = path.join(tmpDir, 'workspace');
    const created = ensureTemplates(wsDir);
    assert.ok(created.length > 0);
    assert.ok(fs.existsSync(path.join(wsDir, 'IDENTITY.md')));
    assert.ok(fs.existsSync(path.join(wsDir, 'SOUL.md')));
  });

  it('non sovrascrive file esistenti', () => {
    fs.writeFileSync(path.join(tmpDir, 'IDENTITY.md'), 'custom');
    const created = ensureTemplates(tmpDir);
    assert.ok(!created.includes('IDENTITY.md'));
    assert.equal(fs.readFileSync(path.join(tmpDir, 'IDENTITY.md'), 'utf-8'), 'custom');
  });
});

describe('loadBootstrapFiles', () => {
  it('carica i file bootstrap presenti', () => {
    fs.writeFileSync(path.join(tmpDir, 'SOUL.md'), '## Core Truths\nTest');
    fs.writeFileSync(path.join(tmpDir, 'MEMORY.md'), '# Memory');
    const files = loadBootstrapFiles(tmpDir);
    assert.ok(files.length >= 2);
    assert.ok(files.some(f => f.name === 'SOUL.md'));
    assert.ok(files.some(f => f.name === 'MEMORY.md'));
  });

  it('ritorna array vuoto se nessun file', () => {
    assert.deepEqual(loadBootstrapFiles(tmpDir), []);
  });
});

describe('loadAgentMemory', () => {
  it('carica contesto completo con identity e soul', () => {
    fs.writeFileSync(path.join(tmpDir, 'SOUL.md'), '## Vibe\nDiretto.');
    fs.writeFileSync(path.join(tmpDir, 'IDENTITY.md'), '- **Name:** Bot');
    const ctx = loadAgentMemory({ workspaceDir: tmpDir });
    assert.equal(ctx.workspaceDir, tmpDir);
    assert.notEqual(ctx.soul, null);
    assert.equal(ctx.soul!.vibe, 'Diretto.');
    assert.notEqual(ctx.identity, null);
    assert.equal(ctx.identity!.name, 'Bot');
    assert.ok(ctx.files.length >= 2);
  });

  it('crea template se createTemplates=true', () => {
    const wsDir = path.join(tmpDir, 'new-workspace');
    loadAgentMemory({ workspaceDir: wsDir, createTemplates: true });
    assert.ok(fs.existsSync(path.join(wsDir, 'SOUL.md')));
  });
});

describe('hasMemoryFiles / listMemoryFiles', () => {
  it('rileva file di memoria presenti', () => {
    assert.equal(hasMemoryFiles(tmpDir), false);
    fs.writeFileSync(path.join(tmpDir, 'SOUL.md'), 'content');
    assert.equal(hasMemoryFiles(tmpDir), true);
    const list = listMemoryFiles(tmpDir);
    assert.deepEqual(list, ['SOUL.md']);
  });
});
