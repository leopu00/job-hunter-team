/**
 * API Download — release metadata (version, per-platform + per-arch assets)
 * Drives the landing `/download` page. Fetches the latest GitHub release
 * server-side with a short revalidate window, then maps release assets to
 * the (platform, arch) variants produced by our electron-builder matrix.
 */
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';

const ROOT = path.resolve(process.cwd(), '..');
const REPO = 'leopu00/job-hunter-team';
const GITHUB_API_RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

type PlatformId = 'mac' | 'linux' | 'windows';
type Arch = 'x64' | 'arm64';

interface PlatformVariant {
  id: PlatformId;
  arch: Arch;
  label: string;
  file: string;
  size: string | null;
  requirements: string;
  instructions: string[];
  downloadUrl: string;
  available: boolean;
  format: string;
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

function getRustLauncherInfo(): { exists: boolean; size: string | null } {
  const launcherPath = path.join(process.cwd(), 'public', 'downloads', 'jht-launcher.exe');
  const exists = fs.existsSync(launcherPath);
  return { exists, size: exists ? getFileSize(launcherPath) : null };
}

function getRustDmgInfo(): { exists: boolean; size: string | null } {
  const dmgPath = path.join(process.cwd(), 'public', 'downloads', 'jht-launcher.dmg');
  const exists = fs.existsSync(dmgPath);
  return { exists, size: exists ? getFileSize(dmgPath) : null };
}

function formatBytes(bytes: number | null | undefined): string | null {
  if (!Number.isFinite(bytes) || !bytes || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

function stripTagPrefix(tag: string | null | undefined): string {
  return String(tag || '').replace(/^v/i, '') || '0.1.0';
}

const VARIANT_LABEL: Record<PlatformId, string> = {
  mac: 'macOS',
  linux: 'Linux',
  windows: 'Windows',
};

const ARCH_LABEL: Record<Arch, string> = {
  x64: 'x64',
  arm64: 'ARM64',
};

const REQUIREMENTS: Record<PlatformId, string> = {
  mac: 'macOS 12+',
  linux: 'Ubuntu 22.04+ / Debian 12+ / Fedora 39+',
  windows: 'Windows 10/11',
};

function variantLabel(id: PlatformId, arch: Arch): string {
  return `${VARIANT_LABEL[id]} (${ARCH_LABEL[arch]})`;
}

function getPlatformInstructions(platformId: PlatformId, format: string, available: boolean): string[] {
  if (!available) {
    return [
      'Apri la pagina GitHub Releases',
      'Verifica che la release piu recente includa l installer per il tuo sistema',
      'Se l artefatto manca, pubblica una nuova release desktop prima di condividere il link',
    ];
  }

  if (platformId === 'mac') {
    return [
      'Apri il file .dmg scaricato',
      'Trascina JHT Desktop nella cartella Applicazioni',
      'Avvia JHT Desktop: il launcher apre la dashboard nel browser',
    ];
  }

  if (platformId === 'linux') {
    if (format === 'deb') {
      return [
        'Scarica il file .deb',
        'Aprilo con il gestore pacchetti della tua distribuzione e completa l installazione',
        'Avvia JHT Desktop dal menu applicazioni: apre la dashboard locale nel browser',
      ];
    }

    return [
      'Scarica il file .AppImage',
      'Rendilo eseguibile e avvialo: chmod +x job-hunter-team-*.AppImage && ./job-hunter-team-*.AppImage',
      'JHT Desktop apre la dashboard locale nel browser',
    ];
  }

  return [
    'Scarica l installer .exe',
    'Esegui l installer: crea il collegamento desktop e installa JHT Desktop',
    'Avvia JHT Desktop: apre la dashboard locale nel browser',
  ];
}

// Electron-builder artifact names we emit (see desktop/package.json "artifactName").
// Keep both the new arch-suffixed name and the legacy un-suffixed one so the API
// keeps working while older releases are still on GitHub.
function expectedAssetName(
  id: PlatformId,
  arch: Arch,
  ext: string,
  version: string,
): { primary: string; legacy: string | null } {
  if (id === 'windows') {
    return {
      primary: `job-hunter-team-${version}-windows-${arch}.${ext}`,
      legacy: arch === 'x64' ? `job-hunter-team-${version}-windows.${ext}` : null,
    };
  }
  if (id === 'mac') {
    return {
      primary: `job-hunter-team-${version}-mac-${arch}.${ext}`,
      legacy: `job-hunter-team-${version}-mac.${ext}`,
    };
  }
  return {
    primary: `job-hunter-team-${version}-linux-${arch}.${ext}`,
    legacy: `job-hunter-team-${version}-linux.${ext}`,
  };
}

function findReleaseAsset(
  assets: GitHubReleaseAsset[],
  id: PlatformId,
  arch: Arch,
  extensions: string[],
  version: string,
): { asset: GitHubReleaseAsset; format: string } | null {
  const lowerAssets = assets.map((a) => ({ asset: a, name: a.name.toLowerCase() }));

  for (const ext of extensions) {
    const { primary, legacy } = expectedAssetName(id, arch, ext, version);
    const primaryLower = primary.toLowerCase();
    const legacyLower = legacy?.toLowerCase();

    let hit = lowerAssets.find((e) => e.name === primaryLower);
    if (!hit && legacyLower) hit = lowerAssets.find((e) => e.name === legacyLower);

    if (hit) return { asset: hit.asset, format: ext };

    // Loose fallback: any asset that contains the platform id, the arch, and the ext
    const loose = lowerAssets.find(
      (e) => e.name.includes(`-${id}`) && e.name.includes(arch) && e.name.endsWith(`.${ext}`),
    );
    if (loose) return { asset: loose.asset, format: ext };
  }
  return null;
}

function localArtifactSize(fileName: string): string | null {
  for (const candidate of [
    path.join(ROOT, 'desktop', 'dist', fileName),
    path.join(ROOT, 'dist', fileName),
  ]) {
    if (fs.existsSync(candidate)) return getFileSize(candidate);
  }
  return null;
}

function buildDefaultVariants(version: string): PlatformVariant[] {
  const macDmg = `job-hunter-team-${version}-mac.dmg`;
  const linuxAppImage = `job-hunter-team-${version}-linux.AppImage`;
  const winX64 = `job-hunter-team-${version}-windows-x64.exe`;
  const winArm64 = `job-hunter-team-${version}-windows-arm64.exe`;

  return [
    {
      id: 'mac',
      arch: 'arm64',
      label: variantLabel('mac', 'arm64'),
      file: macDmg,
      size: localArtifactSize(macDmg),
      requirements: REQUIREMENTS.mac,
      instructions: getPlatformInstructions('mac', 'dmg', true),
      downloadUrl: `https://github.com/${REPO}/releases/latest/download/${macDmg}`,
      available: true,
      format: 'dmg',
    },
    {
      id: 'linux',
      arch: 'x64',
      label: variantLabel('linux', 'x64'),
      file: linuxAppImage,
      size: localArtifactSize(linuxAppImage),
      requirements: REQUIREMENTS.linux,
      instructions: getPlatformInstructions('linux', 'AppImage', true),
      downloadUrl: `https://github.com/${REPO}/releases/latest/download/${linuxAppImage}`,
      available: true,
      format: 'AppImage',
    },
    {
      id: 'windows',
      arch: 'x64',
      label: variantLabel('windows', 'x64'),
      file: winX64,
      size: localArtifactSize(winX64),
      requirements: REQUIREMENTS.windows,
      instructions: getPlatformInstructions('windows', 'exe', true),
      downloadUrl: `https://github.com/${REPO}/releases/latest/download/${winX64}`,
      available: true,
      format: 'exe',
    },
    {
      id: 'windows',
      arch: 'arm64',
      label: variantLabel('windows', 'arm64'),
      file: winArm64,
      size: localArtifactSize(winArm64),
      requirements: `${REQUIREMENTS.windows} (ARM64: Surface Pro, Snapdragon, Parallels on Apple Silicon)`,
      instructions: getPlatformInstructions('windows', 'exe', true),
      downloadUrl: `https://github.com/${REPO}/releases/latest/download/${winArm64}`,
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
    const payload = (await response.json()) as GitHubReleasePayload;
    if (!payload || !Array.isArray(payload.assets)) return null;
    return payload;
  } catch {
    return null;
  }
}

const EXTENSIONS: Record<PlatformId, string[]> = {
  mac: ['dmg'],
  linux: ['AppImage', 'deb'],
  windows: ['exe'],
};

export async function GET() {
  const fallbackVersion = getVersion();
  const fallbackReleasesUrl = `https://github.com/${REPO}/releases`;
  const release = await getLatestRelease();
  const version = stripTagPrefix(release?.tag_name) || fallbackVersion;
  const releasesUrl = release?.html_url || fallbackReleasesUrl;

  const defaults = buildDefaultVariants(version || fallbackVersion);
  const releaseAssets = release?.assets || [];

  const variants: PlatformVariant[] = defaults.map((variant) => {
    const match = findReleaseAsset(releaseAssets, variant.id, variant.arch, EXTENSIONS[variant.id], version);

    if (match) {
      return {
        ...variant,
        file: match.asset.name,
        size: formatBytes(match.asset.size),
        instructions: getPlatformInstructions(variant.id, match.format, true),
        downloadUrl: match.asset.browser_download_url,
        available: true,
        format: match.format,
      };
    }

    // Windows x64 fallback to the locally-bundled Rust launcher (small bootstrap),
    // so the page stays useful even before the first Electron release is cut.
    if (variant.id === 'windows' && variant.arch === 'x64') {
      const local = getRustLauncherInfo();
      if (local.exists) {
        return {
          ...variant,
          file: 'jht-launcher.exe',
          size: local.size,
          requirements: 'Windows 10/11 (x64) + Node.js + Git',
          instructions: [
            'Scarica jht-launcher.exe (< 1 MB)',
            'Avvia: clona la repo, installa le dipendenze e apre il browser',
            'Richiede Node.js e Git installati',
          ],
          downloadUrl: '/downloads/jht-launcher.exe',
          available: true,
          format: 'exe',
        };
      }
    }

    // macOS arm64 fallback to the locally-bundled Rust launcher DMG when present.
    if (variant.id === 'mac' && variant.arch === 'arm64') {
      const localDmg = getRustDmgInfo();
      if (localDmg.exists) {
        return {
          ...variant,
          file: 'jht-launcher.dmg',
          size: localDmg.size,
          instructions: getPlatformInstructions('mac', 'dmg', true),
          downloadUrl: '/downloads/jht-launcher.dmg',
          available: true,
          format: 'dmg',
        };
      }
    }

    return {
      ...variant,
      instructions: getPlatformInstructions(variant.id, variant.format, false),
      downloadUrl: releasesUrl,
      available: false,
    };
  });

  // Backward-compatible "platforms" shape: one entry per PlatformId,
  // preferring the available variant (arm64 for mac, x64 for the rest).
  const platformPreference: Record<PlatformId, Arch[]> = {
    mac: ['arm64', 'x64'],
    linux: ['x64', 'arm64'],
    windows: ['x64', 'arm64'],
  };
  const platforms = (Object.keys(platformPreference) as PlatformId[]).map((id) => {
    for (const arch of platformPreference[id]) {
      const match = variants.find((v) => v.id === id && v.arch === arch && v.available);
      if (match) return match;
    }
    return variants.find((v) => v.id === id) as PlatformVariant;
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
    variants,
    launchers,
    buildReady,
    desktopBuildReady,
    releasesUrl,
  });
}
