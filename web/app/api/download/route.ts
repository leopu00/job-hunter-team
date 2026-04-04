/**
 * API Download — Metadati release, versione, piattaforme, requisiti
 * Restituisce info dinamiche per la pagina /download
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';

const ROOT = path.resolve(process.cwd(), '..');
const REPO = 'leopu00/job-hunter-team';

interface PlatformInfo {
  id: string;
  label: string;
  file: string;
  size: string | null;
  requirements: string;
  instructions: string[];
}

function getVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'web', 'package.json'), 'utf-8'));
    return pkg.version || '0.1.0';
  } catch {
    return '0.1.0';
  }
}

function getFileSize(filePath: string): string | null {
  try {
    const stats = fs.statSync(filePath);
    const mb = stats.size / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(stats.size / 1024).toFixed(0)} KB`;
  } catch {
    return null;
  }
}

function checkLauncherExists(name: string): boolean {
  return fs.existsSync(path.join(ROOT, 'scripts', 'launchers', name));
}

export async function GET() {
  const version = getVersion();
  const distDir = path.join(ROOT, 'dist');

  const platforms: PlatformInfo[] = [
    {
      id: 'mac',
      label: 'macOS',
      file: `job-hunter-team-${version}-mac.tar.gz`,
      size: getFileSize(path.join(distDir, `job-hunter-team-${version}-mac.tar.gz`)),
      requirements: 'macOS 12+, Node.js 18+',
      instructions: [
        "Estrai l'archivio: tar -xzf job-hunter-team-*.tar.gz",
        'Entra nella cartella: cd job-hunter-team',
        'Avvia: ./start.sh',
      ],
    },
    {
      id: 'linux',
      label: 'Linux',
      file: `job-hunter-team-${version}-linux.tar.gz`,
      size: getFileSize(path.join(distDir, `job-hunter-team-${version}-linux.tar.gz`)),
      requirements: 'Ubuntu 20.04+ / Fedora 36+ / Debian 11+, Node.js 18+',
      instructions: [
        "Estrai l'archivio: tar -xzf job-hunter-team-*.tar.gz",
        'Entra nella cartella: cd job-hunter-team',
        'Avvia: ./start.sh',
      ],
    },
    {
      id: 'windows',
      label: 'Windows',
      file: `job-hunter-team-${version}-windows.zip`,
      size: getFileSize(path.join(distDir, `job-hunter-team-${version}-windows.zip`)),
      requirements: 'Windows 10+, Node.js 18+, PowerShell 5.1+',
      instructions: [
        'Estrai lo ZIP in una cartella',
        'Doppio click su start.bat',
        'Oppure: PowerShell > .\\start.ps1',
      ],
    },
  ];

  const launchers = {
    mac: checkLauncherExists('start-mac.sh'),
    linux: checkLauncherExists('start-linux.sh'),
    windows: checkLauncherExists('start-windows.bat') && checkLauncherExists('start-windows.ps1'),
  };

  const buildReady = fs.existsSync(path.join(ROOT, 'scripts', 'build-release.sh'));

  return NextResponse.json({
    version,
    repo: REPO,
    downloadBaseUrl: `https://github.com/${REPO}/releases/latest/download`,
    platforms,
    launchers,
    buildReady,
    releasesUrl: `https://github.com/${REPO}/releases`,
  });
}
