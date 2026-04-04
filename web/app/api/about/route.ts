/**
 * API About — Info progetto, versione, moduli, pagine, stack tech
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), '..');

function countDirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch { return []; }
}

function countFiles(dir: string, pattern: RegExp): number {
  let count = 0;
  try {
    const walk = (d: string) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next') continue;
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (pattern.test(entry.name)) count++;
      }
    };
    walk(dir);
  } catch { /* ignore */ }
  return count;
}

const STACK = {
  frontend: ['Next.js 15', 'React 19', 'TypeScript', 'Tailwind CSS'],
  backend: ['Node.js', 'TypeScript', 'Next.js API Routes'],
  shared: ['Custom modules (zero external deps)', 'node:test'],
  cli: ['Commander.js', 'Node.js'],
  infra: ['GitHub Actions CI', 'Docker-ready'],
};

export async function GET() {
  const sharedModules = countDirs(path.join(ROOT, 'shared'));
  const webPages = countFiles(path.join(ROOT, 'web', 'app'), /^page\.tsx$/);
  const apiRoutes = countFiles(path.join(ROOT, 'web', 'app', 'api'), /^route\.ts$/);
  const testFiles = countFiles(ROOT, /\.test\.ts$/);
  const cliCommands = countDirs(path.join(ROOT, 'cli', 'src', 'commands')).length
    || countFiles(path.join(ROOT, 'cli', 'src', 'commands'), /\.js$|\.ts$/);

  let version = '0.0.0';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'web', 'package.json'), 'utf-8'));
    version = pkg.version || version;
  } catch { /* default */ }

  return NextResponse.json({
    name: 'Job Hunter Team',
    version,
    description: 'Piattaforma multi-agente per la ricerca lavoro automatizzata',
    stats: {
      sharedModules: sharedModules.length,
      webPages,
      apiRoutes,
      testFiles,
      cliCommands,
    },
    modules: sharedModules,
    stack: STACK,
    builtWith: 'Claude Code + Team multi-agente',
  });
}
