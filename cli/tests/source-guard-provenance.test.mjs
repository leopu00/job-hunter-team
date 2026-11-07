import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyInput } from './source-guard-provenance.mjs';

test('capture verifies actual source bytes against the attested Git blob, not a HEAD label', () => {
  const root = mkdtempSync(join(tmpdir(), 'jht-capture-input-'));
  try {
    const file = join(root, 'source.rs');
    writeFileSync(file, 'const SYNTHETIC: u8 = 1;\n');
    const oid = execFileSync('git', ['hash-object', file], { encoding: 'utf8' }).trim();
    const expected = new Map([['source.rs', { mode: '100644', oid }]]);
    assert.equal(verifyInput(root, expected, file).path, 'source.rs');
    writeFileSync(file, 'const SYNTHETIC: u8 = 2;\n');
    assert.throws(() => verifyInput(root, expected, file), /differs from attested source/);
    assert.throws(() => verifyInput(root, new Map(), file), /absent from attested source/);
    expected.set('source.rs', { mode: '120000', oid });
    assert.throws(() => verifyInput(root, expected, file), /not a regular file/);
  } finally {
    rmSync(root, { recursive: true });
  }
});
