import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// rename e open passano dal modulo vero, salvo nei test che simulano i due
// rifiuti che qui non si riproducono: DrvFS che nega il rename di un file tenuto
// aperto da un processo Windows, e una cartella di root che l'uid del container
// non può scrivere (da proprietario, `ensurePrivateDir` la riporta a 0700).
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return { ...real, renameSync: vi.fn(real.renameSync), openSync: vi.fn(real.openSync) };
});

import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error — modulo JS della CLI senza tipi
import { writePrivateJson } from '../../../cli/src/lib/secure-config-io.js';

const refused = (code: string) => Object.assign(new Error(`${code}: refused`), { code });
const leftovers = (dir: string) => fs.readdirSync(dir).filter((name) => name.includes('.tmp-'));

let dir: string;
let file: string;
let stderr: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  const real = await vi.importActual<typeof import('node:fs')>('node:fs');
  vi.mocked(fs.renameSync).mockImplementation(real.renameSync);
  vi.mocked(fs.openSync).mockImplementation(real.openSync);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jht-secure-io-'));
  file = path.join(dir, 'jht.config.json');
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stderr.mockRestore();
  fs.rmSync(dir, { recursive: true, force: true });
});

const saved = () => JSON.parse(fs.readFileSync(file, 'utf8'));

describe('writePrivateJson — scrittura atomica', () => {
  it('il caso normale sostituisce il file e non lascia temporanei', () => {
    writePrivateJson(file, { team: { working_hours: null } });
    writePrivateJson(file, { team: { working_hours: { timezone: 'UTC', windows: [] } } });

    expect(saved().team.working_hours.timezone).toBe('UTC');
    expect(leftovers(dir)).toEqual([]);
    expect(stderr).not.toHaveBeenCalled();
  });

  it('un rifiuto passeggero del rename (Windows) si riprova, e il salvataggio resta atomico', () => {
    writePrivateJson(file, { version: 1 });
    vi.mocked(fs.renameSync)
      .mockImplementationOnce(() => { throw refused('EBUSY'); })
      .mockImplementationOnce(() => { throw refused('EACCES'); });

    writePrivateJson(file, { version: 2 });

    expect(saved().version).toBe(2);
    expect(leftovers(dir)).toEqual([]);
    expect(stderr).not.toHaveBeenCalled();
  });

  it('un rename rifiutato per sempre: il file si riscrive al suo posto e lo si dice', () => {
    writePrivateJson(file, { version: 1, padding: 'x'.repeat(200) });
    vi.mocked(fs.renameSync).mockImplementation(() => { throw refused('EACCES'); });

    writePrivateJson(file, { version: 2 });

    // Più corto del precedente: senza troncare resterebbe la coda del vecchio.
    expect(saved()).toEqual({ version: 2 });
    expect(leftovers(dir)).toEqual([]);
    expect(String(stderr.mock.calls[0]?.[0])).toContain('refused the atomic replace (EACCES)');
  });

  it('un errore che non è un rifiuto della cartella arriva al chiamante, senza ripiego', () => {
    writePrivateJson(file, { version: 1 });
    vi.mocked(fs.renameSync).mockImplementation(() => { throw refused('EIO'); });

    expect(() => writePrivateJson(file, { version: 2 })).toThrow(/EIO/);
    expect(saved().version).toBe(1);
    expect(leftovers(dir)).toEqual([]);
  });

  const refuseTempFiles = async () => {
    const real = await vi.importActual<typeof import('node:fs')>('node:fs');
    vi.mocked(fs.openSync).mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
      if (String(p).includes('.tmp-')) throw refused('EACCES');
      return (real.openSync as (...a: unknown[]) => number)(p, ...rest);
    }) as typeof fs.openSync);
  };

  it('cartella che rifiuta il temporaneo, file esistente: salvato al suo posto', async () => {
    writePrivateJson(file, { version: 1 });
    await refuseTempFiles();

    writePrivateJson(file, { version: 2 });

    expect(saved().version).toBe(2);
    expect(String(stderr.mock.calls[0]?.[0])).toContain(file);
  });

  it('cartella che rifiuta il temporaneo e file assente: errore chiaro, niente creato', async () => {
    await refuseTempFiles();

    let thrown: unknown;
    try { writePrivateJson(file, { version: 1 }); } catch (err) { thrown = err; }

    expect((thrown as { code?: string })?.code).toBe('config_write_failed');
    expect(String((thrown as Error).message)).toContain(file);
    expect(String((thrown as Error).message)).toMatch(/EACCES/);
    expect(fs.existsSync(file)).toBe(false);
  });
});
