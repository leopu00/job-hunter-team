// Source acquisition only: assertions and parsers stay in their original tests.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXCLUDED = new Set(['node_modules', '.git', 'dist', 'target', '__pycache__']);
const TEST_HELPERS = fileURLToPath(new URL('../../tests', import.meta.url));
// Only transport is here: Rust parsing and graph selection have one owner.
const RUST_BRIDGE = `
import json, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from rust_source_guard import production_files, symbol_source
root, marker = Path(sys.argv[2]), sys.argv[3]
source = symbol_source("lib.rs", marker, root=root, include_tests=False, preserve_newlines=True)
inputs = [str(record.path) for record in production_files("lib.rs", root=root)]
assert source and inputs, "empty Rust acquisition"
print(json.dumps({"source": source, "inputs": inputs, "python": sys.version.split()[0]}))
`;

export function sourceFiles(root, extension) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) =>
    Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)))) {
    const path = join(root, entry.name);
    if (entry.isDirectory() && !EXCLUDED.has(entry.name)) files.push(...sourceFiles(path, extension));
    else if (entry.isFile() && entry.name.endsWith(extension)) files.push(path);
  }
  return files;
}

export function sourceContaining(root, extension, pattern, observe) {
  const matcher = new RegExp(pattern.source, `${pattern.flags.replaceAll('g', '')}g`);
  if (extension === '.rs') {
    const marker = /^const [A-Za-z_][A-Za-z_0-9]*:/.exec(pattern.source)?.[0];
    assert.ok(marker, 'Rust lookup requires an explicit constant declaration');
    const reply = JSON.parse(execFileSync('python3', ['-c', RUST_BRIDGE, TEST_HELPERS, root, marker], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }));
    assert.equal([...reply.source.matchAll(matcher)].length, 1, `selected Rust item does not match ${pattern}`);
    if (observe) observe(reply.inputs, { python: reply.python });
    return reply.source;
  }
  const hits = [];
  for (const file of sourceFiles(root, extension)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(matcher)) hits.push({ file, text, match });
  }
  assert.equal(hits.length, 1, `expected one ${pattern} under ${root}; found ${hits.length}`);
  if (observe) observe([hits[0].file]);
  return hits[0].text;
}

export function namedSource(root, name, observe) {
  const files = sourceFiles(root, parse(name).ext).filter((file) => basename(file) === name);
  assert.equal(files.length, 1, `expected one ${name} under ${root}; found ${files.length}`);
  if (observe) observe(files);
  const text = readFileSync(files[0], 'utf8');
  assert.ok(text.trim().length > 0, `empty source script: ${name}`);
  return text;
}
