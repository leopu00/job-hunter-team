// Narrow before/after measurement of the wizard's filesystem login lookup, not OAuth/network time.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { findProviderLogin } from '../wizard/provider-login.js';

const base = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(base || '')) throw new Error('An exact baseline commit is required');
const source = execFileSync('git', ['show', `${base}:cli/wizard/provider-login.js`], { encoding: 'utf8' });
const previous = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const root = mkdtempSync(join(tmpdir(), 'jht-login-timing-'));
try {
  mkdirSync(join(root, '.codex'));
  writeFileSync(join(root, '.codex/auth.json'), '{}');
  const records = [];
  for (const present of [true, false]) {
    const homes = [present ? root : join(root, 'missing')];
    const samples = { before: [], after: [] };
    for (let sample = 0; sample < 20; sample++) {
      const order = sample % 2 ? ['after', 'before'] : ['before', 'after'];
      for (const side of order) {
        const find = side === 'before' ? previous.findProviderLogin : findProviderLogin;
        const start = performance.now();
        for (let i = 0; i < 500; i++) {
          assert.equal(find('codex', { homes }), present ? join(root, '.codex/auth.json') : null);
        }
        samples[side].push((performance.now() - start) / 500);
      }
    }
    const median = (xs) => [...xs].sort((a, b) => a - b).slice(9, 11).reduce((a, b) => a + b) / 2;
    records.push({ present, unit: 'ms per lookup', samples, median_before: median(samples.before), median_after: median(samples.after) });
  }
  console.log(JSON.stringify({ baseline: base, scope: 'findProviderLogin + existsSync, 20 x 500 calls per side; excludes terminal, child and network', records }));
} finally {
  rmSync(root, { recursive: true, force: true });
}
