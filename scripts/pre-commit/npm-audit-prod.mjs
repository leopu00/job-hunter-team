#!/usr/bin/env node
// Pre-commit gate: run `npm audit --omit=dev --audit-level=high` su tutti
// i workspace npm del repo. Fallisce il commit se trova vulnerabilita'
// ad alta severita' nelle dipendenze di produzione.
//
// Skip mirato: per lockfile sperimentali o moduli non destinati a
// produzione, aggiungere il path a SKIP_DIRS.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
// I due workspace npm che finiscono davvero in mano a qualcuno: il CLI
// (installato sull'host e nel container) e il web (deployato su Vercel).
// `tui` era il terzo finché la TUI è stata rimossa il 2026-07-25.
const WORKSPACES = ['cli', 'web'];
const SKIP_DIRS = new Set();

let failed = false;

for (const ws of WORKSPACES) {
  if (SKIP_DIRS.has(ws)) continue;
  const dir = path.join(ROOT, ws);
  if (!existsSync(path.join(dir, 'package.json'))) continue;
  if (!existsSync(path.join(dir, 'package-lock.json'))) {
    console.warn(`[npm-audit] ${ws}: package-lock.json mancante, skip`);
    continue;
  }
  console.log(`[npm-audit] checking ${ws}...`);
  const res = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['audit', '--omit=dev', '--audit-level=high'],
    { cwd: dir, stdio: 'inherit' }
  );
  if (res.status !== 0) {
    console.error(`[npm-audit] ${ws}: vulnerabilita' high+ rilevate (exit ${res.status})`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
