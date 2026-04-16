import { headers } from 'next/headers'
import DownloadClient, { type DownloadVariant, type PlatformId, type Arch } from './DownloadClient'

const REPO = 'leopu00/job-hunter-team'
const GITHUB_LATEST_RELEASE = `https://api.github.com/repos/${REPO}/releases/latest`
const FALLBACK_RELEASES_URL = `https://github.com/${REPO}/releases`
const FALLBACK_VERSION = '0.1.0'

interface GitHubAsset {
  name: string
  size: number
  browser_download_url: string
}

interface GitHubRelease {
  tag_name: string
  html_url: string
  assets: GitHubAsset[]
}

interface ResolvedRelease {
  version: string
  releasesUrl: string
  assets: GitHubAsset[]
  available: boolean
}

const PLATFORM_LABEL: Record<PlatformId, string> = {
  mac: 'macOS',
  linux: 'Linux',
  windows: 'Windows',
}

const ARCH_LABEL: Record<Arch, string> = {
  x64: 'x64',
  arm64: 'ARM64',
}

// Order matters: each entry produces a CTA card; the server picks one as
// "primary" based on the UA, the rest collapse into "Altre opzioni".
const CATALOG: Array<{ id: PlatformId; arch: Arch; ext: string }> = [
  { id: 'windows', arch: 'x64', ext: 'exe' },
  { id: 'windows', arch: 'arm64', ext: 'exe' },
  { id: 'mac', arch: 'arm64', ext: 'dmg' },
  { id: 'mac', arch: 'x64', ext: 'dmg' },
  { id: 'linux', arch: 'x64', ext: 'AppImage' },
]

function formatBytes(bytes: number | null | undefined): string | null {
  if (!Number.isFinite(bytes) || !bytes || bytes <= 0) return null
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`
}

function stripTag(tag: string | null | undefined): string {
  return String(tag || '').replace(/^v/i, '')
}

async function getLatestRelease(): Promise<ResolvedRelease> {
  try {
    const res = await fetch(GITHUB_LATEST_RELEASE, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'job-hunter-team-download-page',
      },
      next: { revalidate: 300 },
    })
    if (!res.ok) throw new Error(`github ${res.status}`)
    const payload = (await res.json()) as GitHubRelease
    if (!payload?.tag_name || !Array.isArray(payload.assets)) throw new Error('malformed')
    return {
      version: stripTag(payload.tag_name) || FALLBACK_VERSION,
      releasesUrl: payload.html_url || FALLBACK_RELEASES_URL,
      assets: payload.assets,
      available: true,
    }
  } catch {
    return {
      version: FALLBACK_VERSION,
      releasesUrl: FALLBACK_RELEASES_URL,
      assets: [],
      available: false,
    }
  }
}

function matchAsset(assets: GitHubAsset[], id: PlatformId, arch: Arch, ext: string, version: string): GitHubAsset | null {
  const primary = `job-hunter-team-${version}-${id}-${arch}.${ext}`.toLowerCase()
  const legacyX64 = arch === 'x64' ? `job-hunter-team-${version}-${id}.${ext}`.toLowerCase() : null
  const extLower = `.${ext.toLowerCase()}`

  const exact = assets.find((a) => a.name.toLowerCase() === primary)
  if (exact) return exact

  if (legacyX64) {
    const legacy = assets.find((a) => a.name.toLowerCase() === legacyX64)
    if (legacy) return legacy
  }

  // Loose fallback: same platform, arch somewhere in the name, correct extension.
  return (
    assets.find(
      (a) =>
        a.name.toLowerCase().includes(`-${id}`) &&
        a.name.toLowerCase().includes(arch) &&
        a.name.toLowerCase().endsWith(extLower),
    ) || null
  )
}

function buildVariants(release: ResolvedRelease): DownloadVariant[] {
  return CATALOG.map(({ id, arch, ext }) => {
    const asset = matchAsset(release.assets, id, arch, ext, release.version)
    const label = `${PLATFORM_LABEL[id]} (${ARCH_LABEL[arch]})`
    if (asset) {
      return {
        id,
        arch,
        label,
        file: asset.name,
        size: formatBytes(asset.size),
        downloadUrl: asset.browser_download_url,
        available: true,
        format: ext,
      }
    }
    const fallbackFile = `job-hunter-team-${release.version}-${id}-${arch}.${ext}`
    return {
      id,
      arch,
      label,
      file: fallbackFile,
      size: null,
      downloadUrl: release.releasesUrl,
      available: false,
      format: ext,
    }
  })
}

// Pick the variant matching the visitor's OS + architecture from User-Agent.
// Mobile (Android / iOS) returns null — no mobile installer is shipped.
// When the UA does not match any desktop OS we return null and let the UI
// pick a sensible default ("Altre opzioni" becomes the only choice).
export function detectPrimary(ua: string): { id: PlatformId; arch: Arch } | null {
  const u = ua.toLowerCase()
  if (!u) return null
  if (u.includes('android')) return null
  if (u.includes('iphone') || u.includes('ipad') || u.includes('ipod')) return null

  if (u.includes('windows')) {
    if (u.includes('arm64') || u.includes('aarch64')) return { id: 'windows', arch: 'arm64' }
    return { id: 'windows', arch: 'x64' }
  }
  if (u.includes('mac os x') || u.includes('macintosh')) {
    // UAs from Safari/Chrome on Apple Silicon still report Intel for
    // compatibility. Default to arm64 since all current Macs (and all
    // still-sold models) ship Apple Silicon; users on older Intel Macs
    // can reach x64 from "Altre opzioni".
    return { id: 'mac', arch: 'arm64' }
  }
  if (u.includes('linux')) {
    if (u.includes('aarch64') || u.includes('arm64')) return { id: 'linux', arch: 'arm64' }
    return { id: 'linux', arch: 'x64' }
  }
  return null
}

export default async function DownloadPage() {
  const h = await headers()
  const ua = h.get('user-agent') || ''
  const detected = detectPrimary(ua)

  const release = await getLatestRelease()
  const variants = buildVariants(release)

  const primary =
    (detected && variants.find((v) => v.id === detected.id && v.arch === detected.arch)) ||
    variants.find((v) => v.available) ||
    null

  const others = primary ? variants.filter((v) => v !== primary) : variants

  return (
    <DownloadClient
      version={release.version}
      releasesUrl={release.releasesUrl}
      primary={primary}
      others={others}
      releaseAvailable={release.available}
    />
  )
}
