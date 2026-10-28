import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DISK_BLOCK_FREE_BYTES, DISK_BLOCK_FREE_PCT, DISK_WARN_FREE_BYTES, DISK_WARN_FREE_PCT,
  diskLevel, diskLowRefusal, engineDiskPath, formatGib, readDisk, volumeState,
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

const GIB_KIB = 1024 * 1024;
// Disco di capienza decisa: blocchi da 1 KiB, `totalGib` GiB con `freeKib` KiB liberi.
const sizedStatfs = (totalGib, freeKib) => () => ({ bsize: 1024, blocks: totalGib * GIB_KIB, bavail: freeKib });

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
  assert.match(low.refusal.message, /at least 8 GiB of disk — available: \d+(\.\d)? GiB\./);
  assert.doesNotMatch(low.refusal.message, /%/);
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

test('combined thresholds: 3% AND 8 GiB refuse, 10% AND 20 GiB warn (comparisons are strict)', () => {
  assert.equal(DISK_BLOCK_FREE_BYTES, 8 * 1024 ** 3);
  assert.equal(DISK_WARN_FREE_BYTES, 20 * 1024 ** 3);
  const level = (totalGib, freeKib) => volumeState('/h', { statfs: sizedStatfs(totalGib, freeKib), exists }).level;
  // 14 GiB su 500 GiB = 2,8%: prima rifiutava, ora no
  assert.equal(level(500, 14 * GIB_KIB), 'warn');
  // esattamente il 3% (15 GiB su 500) non rifiuta; esattamente 8 GiB non rifiuta, un KiB in meno si
  assert.equal(level(500, 15 * GIB_KIB), 'warn');
  assert.equal(level(500, 8 * GIB_KIB), 'warn');
  assert.equal(level(500, 8 * GIB_KIB - 1), 'low');
  // 4 GiB su 200 GiB = 2%: rifiuta
  assert.equal(level(200, 4 * GIB_KIB), 'low');
  assert.equal(level(200, 6 * GIB_KIB), 'warn');
  assert.equal(level(200, 6 * GIB_KIB - 1), 'low');
  assert.equal(level(500, 20 * GIB_KIB), 'ok');
  assert.equal(level(500, 20 * GIB_KIB - 1), 'warn');
  assert.equal(level(500, 49 * GIB_KIB), 'ok');
  assert.equal(level(100, 10 * GIB_KIB), 'ok');
  assert.equal(level(100, 10 * GIB_KIB - 1), 'warn');
});

test('diskLevel works on bytes directly and never rounds on the boundary', () => {
  const GIB = 1024 ** 3;
  assert.equal(diskLevel(14 * GIB, 500 * GIB), 'warn');
  assert.equal(diskLevel(4 * GIB, 200 * GIB), 'low');
  assert.equal(diskLevel(6 * GIB, 200 * GIB), 'warn');
  assert.equal(diskLevel(6 * GIB - 1, 200 * GIB), 'low');
});

test('500 GiB with 14 GiB free is not refused; 200 GiB with 4 GiB free is, with the how-to-free-space phrase', () => {
  assert.equal(diskLowRefusal({ ...base, statfs: sizedStatfs(500, 14 * GIB_KIB) }), null);
  const refusal = diskLowRefusal({ ...base, statfs: sizedStatfs(200, 4 * GIB_KIB) });
  assert.equal(refusal.code, 'disk_low');
  assert.match(refusal.message, /Trash/);
  assert.match(refusal.message, /`jht clean-images`/);
});

test('the refusal says the space the agents need and the space that is left, never a percentage', () => {
  // 200 GiB con 4 GiB liberi (2%): servono almeno 8 GiB, ne restano 4
  const refusal = diskLowRefusal({ ...base, statfs: sizedStatfs(200, 4 * GIB_KIB) });
  assert.match(refusal.message, /at least 8 GiB of disk — available: 4 GiB\./);
  assert.doesNotMatch(refusal.message, /%/);
  assert.equal(refusal.disk.minFreeBytes, 4 * 1024 ** 3);
});

test('the free space is rounded down to one decimal and carries the decimal mark of the language', () => {
  const quarter = 5 * 1024 ** 3 + 1024 ** 3 / 4; // 5,25 GiB: si dice 5,2, mai 5,3
  assert.equal(formatGib(quarter, 'en'), '5.2');
  assert.equal(formatGib(quarter, 'it'), '5,2');
  assert.equal(formatGib(2 * 1024 ** 3 - 1, 'de'), '1,9');
  assert.equal(formatGib(8 * 1024 ** 3, 'fr'), '8');
  assert.equal(formatGib(-5, 'en'), '0');
  assert.equal(formatGib(1024 ** 3 / 20, 'pt'), '0');
});

test('the worst volume is chosen by severity, not by the lowest percent alone', () => {
  // casa: 2% di un disco enorme (ok); motore: 5% di 100 GiB (warn)
  const statfs = (target) => (target === '/h' ? sizedStatfs(10000, 200 * GIB_KIB)() : sizedStatfs(100, 5 * GIB_KIB)());
  const disk = readDisk({ ...base, statfs });
  assert.equal(disk.jhtHome.level, 'ok');
  assert.equal(disk.engine.level, 'warn');
  assert.equal(disk.code, 'disk_warning');
  assert.equal(disk.minFreePct, 5);
});
