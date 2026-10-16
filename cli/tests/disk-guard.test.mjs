import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DISK_BLOCK_FREE_PCT, DISK_WARN_FREE_PCT, diskLowRefusal, engineDiskPath, readDisk, volumeState,
} from '../src/lib/disk-guard.js';

// La frase viene dalla tabella nella lingua dell'utente: qui si fissa l'inglese.
process.env.JHT_HOME = '/nonexistent-jht-home';
process.env.JHT_LANG = 'en';

const BLOCKS = 1_000_000;
const exists = () => true;

function statfsAt(byPath, fallback = 50) {
  return (target) => {
    const hit = Object.entries(byPath).filter(([prefix]) => target === prefix || target.startsWith(`${prefix}/`))
      .sort((a, b) => b[0].length - a[0].length)[0];
    const pct = hit ? hit[1] : fallback;
    return { bsize: 4096, blocks: BLOCKS, bavail: Math.floor((BLOCKS * pct) / 100) };
  };
}

const base = { home: '/h', env: { JHT_ENGINE_DISK_PATH: '/e' }, exists };

test('thresholds are 10% warn and 3% block, strictly below', () => {
  assert.equal(DISK_WARN_FREE_PCT, 10);
  assert.equal(DISK_BLOCK_FREE_PCT, 3);
  const at = (pct) => volumeState('/h', { statfs: statfsAt({ '/h': pct }), exists }).level;
  assert.deepEqual([15, 10, 9.99, 3, 2.99].map(at), ['ok', 'ok', 'warn', 'warn', 'low']);
});

test('15% nothing, 8% warns without refusing, 2% refuses with disk_low and the table phrase', () => {
  const run = (pct) => ({ disk: readDisk({ ...base, statfs: statfsAt({ '/h': pct, '/e': pct }) }),
    refusal: diskLowRefusal({ ...base, statfs: statfsAt({ '/h': pct, '/e': pct }) }) });
  assert.equal(run(15).disk.code, null);
  assert.equal(run(15).refusal, null);
  assert.equal(run(8).disk.code, 'disk_warning');
  assert.equal(run(8).refusal, null);
  const low = run(2);
  assert.equal(low.disk.code, 'disk_low');
  assert.equal(low.refusal.code, 'disk_low');
  assert.match(low.refusal.message, /almost full \(only 2% is free\)/);
});

test('the worst of the two volumes decides', () => {
  const engineLow = diskLowRefusal({ ...base, statfs: statfsAt({ '/h': 40, '/e': 2 }) });
  assert.equal(engineLow.code, 'disk_low');
});

test('a volume that cannot be measured is unknown and never refuses', () => {
  const boom = () => { throw new Error('ENOSYS'); };
  const disk = readDisk({ ...base, statfs: boom });
  assert.equal(disk.level, 'unknown');
  assert.equal(diskLowRefusal({ ...base, statfs: boom }), null);
});

test('the engine disk is never guessed from the host disk', () => {
  assert.equal(engineDiskPath({ env: {}, inContainer: false, platform: 'darwin', exists }), null);
  assert.equal(engineDiskPath({ env: {}, inContainer: false, platform: 'win32', exists }), null);
  assert.equal(engineDiskPath({ env: {}, inContainer: true, platform: 'darwin', exists }), '/');
  assert.equal(engineDiskPath({ env: { JHT_ENGINE_DISK_PATH: '/x' }, inContainer: false, platform: 'darwin', exists }), '/x');
  assert.equal(engineDiskPath({ env: { JHT_ENGINE_DISK_PATH: '' }, inContainer: true, platform: 'linux', exists }), null);
});
