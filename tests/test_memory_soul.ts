/**
 * Test unitari — shared/memory/soul.ts
 *
 * Esegui con: npx tsx --test tests/test_memory_soul.ts
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseSoulMarkdown, loadSoulFromFile, loadSoulFromWorkspace } from '../shared/memory/soul.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jht-test-soul-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('parseSoulMarkdown', () => {
  it('parsa tutte le sezioni correttamente', () => {
    const content = `# SOUL.md

## Core Truths

Sii utile, non teatrale.

## Boundaries

- Mai inviare dati privati.

## Vibe

Conciso e diretto.

## Continuity

Ogni sessione parti da zero.
`;
    const soul = parseSoulMarkdown(content);
    assert.equal(soul.raw, content);
    assert.equal(soul.coreTruths, 'Sii utile, non teatrale.');
    assert.equal(soul.boundaries, '- Mai inviare dati privati.');
    assert.equal(soul.vibe, 'Conciso e diretto.');
    assert.equal(soul.continuity, 'Ogni sessione parti da zero.');
  });

  it('ritorna undefined per sezioni mancanti', () => {
    const content = `# SOUL.md

## Core Truths

Solo questa sezione esiste.
`;
    const soul = parseSoulMarkdown(content);
    assert.equal(soul.coreTruths, 'Solo questa sezione esiste.');
    assert.equal(soul.boundaries, undefined);
    assert.equal(soul.vibe, undefined);
    assert.equal(soul.continuity, undefined);
  });

  it('gestisce contenuto vuoto', () => {
    const soul = parseSoulMarkdown('');
    assert.equal(soul.raw, '');
    assert.equal(soul.coreTruths, undefined);
  });

  it('gestisce sezioni vuote come undefined', () => {
    const content = `## Core Truths

## Boundaries

Qualcosa qui.
`;
    const soul = parseSoulMarkdown(content);
    assert.equal(soul.coreTruths, undefined);
    assert.equal(soul.boundaries, 'Qualcosa qui.');
  });
});

describe('loadSoulFromFile', () => {
  it('carica e parsa un file SOUL.md valido', () => {
    const filePath = path.join(tmpDir, 'SOUL.md');
    fs.writeFileSync(filePath, '## Core Truths\n\nTest.');
    const soul = loadSoulFromFile(filePath);
    assert.notEqual(soul, null);
    assert.equal(soul!.coreTruths, 'Test.');
  });

  it('ritorna null per file inesistente', () => {
    const result = loadSoulFromFile(path.join(tmpDir, 'NONEXIST.md'));
    assert.equal(result, null);
  });

  it('ritorna null per file vuoto', () => {
    const filePath = path.join(tmpDir, 'SOUL.md');
    fs.writeFileSync(filePath, '   \n  \n  ');
    assert.equal(loadSoulFromFile(filePath), null);
  });
});

describe('loadSoulFromWorkspace', () => {
  it('carica SOUL.md dalla directory workspace', () => {
    fs.writeFileSync(path.join(tmpDir, 'SOUL.md'), '## Vibe\n\nCaldo.');
    const soul = loadSoulFromWorkspace(tmpDir);
    assert.notEqual(soul, null);
    assert.equal(soul!.vibe, 'Caldo.');
  });

  it('ritorna null se SOUL.md non esiste nel workspace', () => {
    assert.equal(loadSoulFromWorkspace(tmpDir), null);
  });
});
