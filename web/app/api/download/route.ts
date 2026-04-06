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
const GITHUB_API_RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

type PlatformId = 'mac' | 'linux' | 'windows';

interface PlatformInfo {
  id: PlatformId;
  label: string;
  file: string;
  size: string | null;
  requirements: string;
  instructions: string[];
  downloadUrl: string;
  available: boolean;
  format: string;
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

function formatBytes(bytes: number | null | undefined): string | null {
  if (!Number.isFinite(bytes) || !bytes || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

function stripTagPrefix(tag: string | null | undefined): string {
  return String(tag || '').replace(/^v/i, '') || '0.1.0';
}

interface GitHubReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

interface GitHubReleasePayload {
  tag_name: string;
  html_url: string;
  assets: GitHubReleaseAsset[];
}

function findReleaseAsset(
  assets: GitHubReleaseAsset[],
  platformId: PlatformId,
  extensions: string[]
): GitHubReleaseAsset | null {
  const normalizedAssets = assets.filter((asset) => asset.name.toLowerCase().includes(`-${platformId}`));
  for (const extension of extensions) {
    const match = normalizedAssets.find((asset) => asset.name.toLowerCase().endsWith(extension.toLowerCase()));
    if (match) return match;
  }
  return null;
}

function getPlatformInstructions(platformId: PlatformId, format: string, available: boolean): string[] {
  if (!available) {
    return [
      'Apri la pagina GitHub Releases',
      'Verifica che la release piu recente includa l installer corretto per il tuo sistema',
      'Se l artefatto manca, pubblica una nuova release desktop prima di condividere il link',
    ];
  }

  if (platformId === 'mac') {
    return [
      'Apri il file .dmg scaricato',
      'Trascina JHT Desktop nella cartella Applicazioni',
      'Avvia JHT Desktop: il launcher aprira la dashboard nel browser',
    ];
  }

  if (platformId === 'linux') {
    if (format === 'deb') {
      return [
        'Scarica il file .deb',
        'Aprilo con il gestore pacchetti della tua distribuzione e completa l installazione',
        'Avvia JHT Desktop dal menu applicazioni: il launcher apre la dashboard locale nel browser',
      ];
    }

    return [
      'Scarica il file .AppImage',
      'Rendilo eseguibile e avvialo: chmod +x job-hunter-team-*.AppImage && ./job-hunter-team-*.AppImage',
      'JHT Desktop apre la dashboard locale nel browser',
    ];
  }

  return [
    'Apri il file .exe scaricato',
    'Segui il wizard NSIS e installa JHT Desktop',
    'Avvia JHT Desktop dal menu Start: il launcher apre la dashboard nel browser',
  ];
}

function getDefaultPlatformInfo(version: string): PlatformInfo[] {
  const localArtifactSize = (fileName: string) => getFileSize(
    findArtifactPath(
      path.join('desktop', 'dist', fileName),
      path.join('dist', fileName)
    ) ?? ''
  );

  const macFile = `job-hunter-team-${version}-mac.dmg`;
  const linuxFile = `job-hunter-team-${version}-linux.AppImage`;
  const windowsFile = `job-hunter-team-${version}-windows.exe`;

  return [
    {
      id: 'mac',
      label: 'macOS',
      file: macFile,
      size: localArtifactSize(macFile),
      requirements: 'macOS 12+',
      instructions: getPlatformInstructions('mac', 'dmg', true),
      downloadUrl: `https://github.com/${REPO}/releases/latest/download/${macFile}`,
      available: true,
      format: 'dmg',
    },
    {
      id: 'linux',
      label: 'Linux',
      file: linuxFile,
      size: localArtifactSize(linuxFile),
      requirements: 'Ubuntu 22.04+ / Debian 12+ / Fedora 39+ (x64)',
      instructions: getPlatformInstructions('linux', 'AppImage', true),
      downloadUrl: `https://github.com/${REPO}/releases/latest/download/${linuxFile}`,
      available: true,
      format: 'AppImage',
    },
    {
      id: 'windows',
      label: 'Windows',
      file: windowsFile,
      size: localArtifactSize(windowsFile),
      requirements: 'Windows 10/11 (x64)',
      instructions: getPlatformInstructions('windows', 'exe', true),
      downloadUrl: `https://github.com/${REPO}/releases/latest/download/${windowsFile}`,
      available: true,
      format: 'exe',
    },
  ];
}

async function getLatestRelease(): Promise<GitHubReleasePayload | null> {
  try {
    const response = await fetch(GITHUB_API_RELEASE_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'job-hunter-team-download-api',
      },
      next: { revalidate: 300 },
    });

    if (!response.ok) return null;
    const payload = await response.json() as GitHubReleasePayload;
    if (!payload || !Array.isArray(payload.assets)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function GET() {
  const fallbackVersion = getVersion();
  const fallbackReleasesUrl = `https://github.com/${REPO}/releases`;
  const release = await getLatestRelease();
  const version = stripTagPrefix(release?.tag_name) || fallbackVersion;
  const releasesUrl = release?.html_url || fallbackReleasesUrl;

  const defaults = getDefaultPlatformInfo(version || fallbackVersion);
  const releaseAssets = release?.assets || [];
  const platforms: PlatformInfo[] = defaults.map((platform) => {
    const extensions = platform.id === 'mac'
      ? ['.dmg']
      : platform.id === 'linux'
        ? ['.appimage', '.deb']
        : ['.exe'];
    const asset = findReleaseAsset(releaseAssets, platform.id, extensions);
    const format = asset?.name.split('.').pop() || platform.format;
    const available = !!asset;

    return {
      ...platform,
      file: asset?.name || platform.file,
      size: asset ? formatBytes(asset.size) : platform.size,
      instructions: getPlatformInstructions(platform.id, format, available),
      downloadUrl: asset?.browser_download_url || releasesUrl,
      available,
      format,
    };
  });

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
    platforms,
    launchers,
    buildReady,
    desktopBuildReady,
    releasesUrl,
  });
}
