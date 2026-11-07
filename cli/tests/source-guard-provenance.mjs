// Capture provenance is part of test evidence, never inferred from a HEAD label.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const INTEGRITY_SHA256 = '7292a456ac59b6e976ca67566f705cf9e064d45b9b1f50a3c87b99a042b8cf2e';
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

function manifestEntries(text) {
  const entries = new Map();
  for (const line of text.split('\0').join('\n').split('\n').filter(Boolean)) {
    const found = /^(\d+) (blob|commit) ([a-f0-9]{40})\t(.+)$/.exec(line);
    assert.ok(found, 'invalid source manifest entry');
    assert.ok(!entries.has(found[4]), `duplicate manifest path: ${found[4]}`);
    entries.set(found[4], { mode: found[1], oid: found[3] });
  }
  assert.ok(entries.size > 0, 'empty source manifest');
  return entries;
}

export function verifyInput(root, entries, file) {
  const name = relative(root, file).split(sep).join('/');
  const expected = entries.get(name);
  assert.ok(expected && !name.startsWith('../'), `input absent from attested source: ${name}`);
  assert.ok(['100644', '100755'].includes(expected.mode), `source input is not a regular file: ${name}`);
  const bytes = readFileSync(file);
  const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  assert.equal(actual, expected.oid, `input differs from attested source: ${name}`);
  return { path: name, sha256: sha256(bytes), bytes: bytes.length };
}

export function beginCapture(directory) {
  const root = realpathSync(directory);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  let provenance, entries, check;
  if (existsSync(join(root, '.git'))) {
    const sha = git('rev-parse', 'HEAD');
    const tree = git('rev-parse', 'HEAD^{tree}');
    check = () => {
      assert.equal(git('status', '--porcelain=v1', '--untracked-files=all'), '', 'capture requires clean source');
      assert.equal(git('rev-parse', 'HEAD'), sha, 'capture HEAD changed');
    };
    check();
    entries = manifestEntries(execFileSync('git', ['ls-tree', '-rz', 'HEAD'], { cwd: root, encoding: 'utf8' }));
    provenance = { sha, tree, mode: 'clean-git-checkout' };
  } else {
    assert.equal(realpathSync(process.env.RT_SOURCE_ROOT ?? ''), root, 'capture requires canonical source root');
    const control = process.env.RT_CONTROL;
    assert.ok(control && /^[a-f0-9]{40}$/.test(process.env.RT_SOURCE_SHA ?? ''), 'canonical provenance missing');
    const tool = join(control, 'integrity.mjs');
    assert.equal(sha256(readFileSync(tool)), INTEGRITY_SHA256, 'canonical integrity helper changed');
    const manifest = join(control, 'expected.tsv');
    const expected = readFileSync(manifest, 'utf8');
    const manifestSha256 = sha256(expected);
    entries = manifestEntries(expected);
    check = (phase) => {
      assert.equal(sha256(readFileSync(manifest)), manifestSha256, 'source manifest changed');
      assert.equal(sha256(readFileSync(tool)), INTEGRITY_SHA256, 'integrity helper changed during capture');
      execFileSync(process.env.RT_INPUT_NODE ?? process.execPath, [tool, root, manifest,
        phase, join(control, `${phase}.tsv`), 'tracked'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    };
    check('cli-capture-pre');
    // The archive has no .git. Its full Git tree is attested in the runner log;
    // do not invent a tree from HEAD or from the PNG-filtered input manifest.
    provenance = { sha: process.env.RT_SOURCE_SHA, tree: null, mode: 'canonical-v4',
      manifestSha256, integritySha256: INTEGRITY_SHA256, run: process.env.RT_ID };
  }
  return { provenance, input: (file) => verifyInput(root, entries, file),
    finish: () => { check('cli-capture-post'); return provenance; } };
}
