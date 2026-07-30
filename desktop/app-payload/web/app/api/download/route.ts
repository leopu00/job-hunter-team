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

function findArtifactPath(...relativeCandidates: string[]): string | null {
  for (const candidate of relativeCandidates) {
    const absolutePath = path.join(ROOT, candidate);
    if (fs.existsSync(absolutePath)) return absolutePath;
  }
  return null;
}

function checkLauncherExists(name: string): boolean {
  return fs.existsSync(path.join(ROOT, 'scripts', 'launchers', name));
}

export async function GET() {
  const version = getVersion();

  const platforms: PlatformInfo[] = [
    {
      id: 'mac',
      label: 'macOS',
      file: `job-hunter-team-${version}-mac.dmg`,
      size: getFileSize(
        findArtifactPath(
          path.join('desktop', 'dist', `job-hunter-team-${version}-mac.dmg`),
          path.join('dist', `job-hunter-team-${version}-mac.dmg`)
        ) ?? ''
      ),
      requirements: 'macOS 12+',
      instructions: [
        'Apri il file .dmg scaricato',
        'Trascina JHT Desktop nella cartella Applicazioni',
        'Avvia JHT Desktop: il launcher aprira la dashboard nel browser',
      ],
    },
    {
      id: 'linux',
      label: 'Linux',
      file: `job-hunter-team-${version}-linux.AppImage`,
      size: getFileSize(
        findArtifactPath(
          path.join('desktop', 'dist', `job-hunter-team-${version}-linux.AppImage`),
          path.join('dist', `job-hunter-team-${version}-linux.AppImage`)
        ) ?? ''
      ),
      requirements: 'Ubuntu 22.04+ / Debian 12+ / Fedora 39+ (x64)',
      instructions: [
        'Scarica il file .AppImage e rendilo eseguibile',
        'Avvialo con doppio click oppure: chmod +x job-hunter-team-*.AppImage && ./job-hunter-team-*.AppImage',
        'Il launcher apre la dashboard locale nel browser',
      ],
    },
    {
      id: 'windows',
      label: 'Windows',
      file: `job-hunter-team-${version}-windows.exe`,
      size: getFileSize(
        findArtifactPath(
          path.join('desktop', 'dist', `job-hunter-team-${version}-windows.exe`),
          path.join('dist', `job-hunter-team-${version}-windows.exe`)
        ) ?? ''
      ),
      requirements: 'Windows 10/11 (x64)',
      instructions: [
        'Apri il file .exe scaricato',
        'Segui il wizard NSIS e installa JHT Desktop',
        'Avvia JHT Desktop dal menu Start: il launcher apre la dashboard nel browser',
      ],
    },
  ];

  const launchers = {
    mac: checkLauncherExists('start-mac.sh'),
    linux: checkLauncherExists('start-linux.sh'),
    windows: checkLauncherExists('start-windows.bat') && checkLauncherExists('start-windows.ps1'),
  };

  const buildReady = fs.existsSync(path.join(ROOT, 'scripts', 'build-release.sh'));
  const desktopBuildReady = fs.existsSync(path.join(ROOT, 'desktop', 'package.json'));

  return NextResponse.json({
    version,
    repo: REPO,
    downloadBaseUrl: `https://github.com/${REPO}/releases/latest/download`,
    platforms,
    launchers,
    buildReady,
    desktopBuildReady,
    releasesUrl: `https://github.com/${REPO}/releases`,
  });
}
