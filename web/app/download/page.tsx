'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CopyButton } from '../components/CopyButton'
import { LandingI18nProvider, useLandingI18n } from '../components/landing/LandingI18n'
import LandingNav from '../components/landing/LandingNav'
import { LandingFooter } from '../components/landing/LandingCTA'
import ScrollToTop from '../components/landing/ScrollToTop'

type PlatformId = 'mac' | 'linux' | 'windows'
type TerminalMode = 'source' | 'cli'
type InstallMode = 'desktop' | 'terminal'

interface PlatformData {
  id: PlatformId
  label: string
  file: string
  size: string | null
  requirements: string
  instructions: string[]
  downloadUrl: string
  available: boolean
  format: string
}

interface ReleaseData {
  version: string
  platforms: PlatformData[]
  releasesUrl: string
}

const ICONS: Record<PlatformId, () => React.ReactNode> = {
  mac: AppleIcon,
  linux: LinuxIcon,
  windows: WindowsIcon,
}

const PLATFORM_ORDER: Record<PlatformId, number> = {
  windows: 0,
  mac: 1,
  linux: 2,
}

const FALLBACK_VERSION = '0.1.0'
const FALLBACK_REPO = 'leopu00/job-hunter-team'
const FALLBACK_RELEASES_URL = `https://github.com/${FALLBACK_REPO}/releases`

// One-liner installer: scarica, installa dipendenze e lancia il wizard.
// Target: utenti tech su macOS / Linux / WSL.
const CLI_SETUP_CMD = `curl -fsSL https://raw.githubusercontent.com/leopu00/job-hunter-team/main/scripts/install.sh | bash`

// Build da sorgente: per chi vuole sviluppare o contribuire.
const SOURCE_SETUP_CMD = `git clone https://github.com/leopu00/job-hunter-team.git
cd job-hunter-team
npm --prefix tui install && npm --prefix tui run build
npm --prefix cli install
node cli/bin/jht.js`

const FALLBACK_PLATFORMS: PlatformData[] = [
  {
    id: 'mac', label: 'macOS', file: `job-hunter-team-${FALLBACK_VERSION}-mac.dmg`, size: null,
    requirements: 'macOS 12+',
    instructions: [],
    downloadUrl: `https://github.com/${FALLBACK_REPO}/releases/latest/download/job-hunter-team-${FALLBACK_VERSION}-mac.dmg`,
    available: true,
    format: 'dmg',
  },
  {
    id: 'linux', label: 'Linux', file: `job-hunter-team-${FALLBACK_VERSION}-linux.AppImage`, size: null,
    requirements: 'Ubuntu 22.04+ / Debian 12+ / Fedora 39+ (x64)',
    instructions: [],
    downloadUrl: `https://github.com/${FALLBACK_REPO}/releases/latest/download/job-hunter-team-${FALLBACK_VERSION}-linux.AppImage`,
    available: true,
    format: 'AppImage',
  },
  {
    id: 'windows', label: 'Windows', file: 'jht-launcher.exe', size: '306 KB',
    requirements: 'Windows 10/11 (x64) + Node.js + Git',
    instructions: [],
    downloadUrl: '/downloads/jht-launcher.exe',
    available: true,
    format: 'exe',
  },
]

function DownloadContent() {
  const { t } = useLandingI18n()
  const [installMode, setInstallMode] = useState<InstallMode>('desktop')
  const [terminalMode, setTerminalMode] = useState<TerminalMode>('cli')
  const [release, setRelease] = useState<ReleaseData>({
    version: FALLBACK_VERSION,
    platforms: FALLBACK_PLATFORMS,
    releasesUrl: FALLBACK_RELEASES_URL,
  })

  useEffect(() => {
    fetch('/api/download')
      .then(r => r.json())
      .then((data: ReleaseData) => setRelease(data))
      .catch(() => {})
  }, [])

  const { version, platforms, releasesUrl } = release
  const orderedPlatforms = [...platforms].sort((a, b) => PLATFORM_ORDER[a.id] - PLATFORM_ORDER[b.id])

  const terminalCommand = terminalMode === 'source' ? SOURCE_SETUP_CMD : CLI_SETUP_CMD

  return (
    <>
      <LandingNav />
      <main style={{ position: 'relative', zIndex: 1 }} className="min-h-screen flex flex-col items-center px-5 py-12 pt-24">
        <div className="w-full max-w-2xl" style={{ animation: 'fade-in 0.5s ease both' }}>

          {/* Header */}
          <div className="mb-12 text-center">
            <h1 className="text-2xl md:text-4xl font-bold tracking-tight text-[var(--color-white)] leading-none mb-3">
              Configura il tuo team <span className="text-[var(--color-green)]">sul tuo PC</span>
            </h1>
            <p className="text-[var(--color-muted)] text-[12px] md:text-[13px] leading-relaxed max-w-4xl mx-auto mb-2">
              {t('dl_desc')}
            </p>
            <span className="text-[10px] text-[var(--color-dim)]">v{version} &middot; open source</span>
          </div>

          <div className="mb-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={() => setInstallMode('desktop')}
                className="px-4 py-4 text-left transition-colors"
                style={{
                  background: installMode === 'desktop' ? 'var(--color-card)' : 'transparent',
                  color: installMode === 'desktop' ? 'var(--color-bright)' : 'var(--color-muted)',
                  border: `1px solid ${installMode === 'desktop' ? 'var(--color-green)' : 'var(--color-border)'}`,
                  cursor: 'pointer',
                }}
              >
                <div className="text-[12px] font-semibold tracking-wide">{t('dl_mode_desktop_title')}</div>
              </button>
              <button
                onClick={() => setInstallMode('terminal')}
                className="px-4 py-4 text-left transition-colors"
                style={{
                  background: installMode === 'terminal' ? 'var(--color-card)' : 'transparent',
                  color: installMode === 'terminal' ? 'var(--color-bright)' : 'var(--color-muted)',
                  border: `1px solid ${installMode === 'terminal' ? 'var(--color-green)' : 'var(--color-border)'}`,
                  cursor: 'pointer',
                }}
              >
                <div className="text-[12px] font-semibold tracking-wide">{t('dl_mode_terminal_title')}</div>
              </button>
            </div>
          </div>

          {installMode === 'desktop' ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
                {orderedPlatforms.map((platform, i) => {
                  const Icon = ICONS[platform.id] || (() => null)
                  const ctaHref = platform.available ? platform.downloadUrl : releasesUrl

                  return (
                    <div key={platform.id} className="border overflow-hidden transition-all duration-200 h-full"
                      style={{
                        borderColor: 'var(--color-border)',
                        background: 'var(--color-panel)',
                        animation: `fade-in 0.4s ease ${i * 0.12}s both`,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-border-glow)' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}>
                      <div className="px-4 sm:px-5 py-4 h-full flex flex-col">
                        <div className="flex items-center gap-3 sm:gap-4">
                          <div className="w-10 h-10 flex items-center justify-center flex-shrink-0"
                            style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
                            <Icon />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[14px] font-bold text-[var(--color-white)]">{platform.label}</span>
                            </div>
                            <span className="text-[9px] sm:text-[10px] text-[var(--color-dim)] break-all">
                              {platform.file}
                              {platform.size && <> &middot; {platform.size}</>}
                            </span>
                          </div>
                        </div>
                        <div className="mt-auto pt-4">
                          <a href={ctaHref}
                            className="block w-full text-center px-5 py-2 text-[12px] font-bold tracking-wide transition-all no-underline hover:no-underline"
                            style={{
                              background: 'var(--color-card)',
                              color: 'var(--color-green)',
                              border: '1px solid var(--color-green)',
                              cursor: 'pointer',
                            }}>
                            {platform.available ? t('dl_download') : t('dl_view_release')}
                          </a>
                        </div>
                        {!platform.available && (
                          <p className="mt-2 text-[10px] text-[var(--color-yellow)]">
                            {t('dl_asset_pending')}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            <div className="border border-[var(--color-border)] bg-[var(--color-panel)] p-5 mb-8">
              <div className="mb-4">
                <p className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)] mb-2">
                  {t('dl_terminal_title')}
                </p>
                <p className="text-[11px] text-[var(--color-muted)] leading-relaxed">
                  {t('dl_terminal_desc')}
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 mb-4">
                <button
                  onClick={() => setTerminalMode('source')}
                  className="px-3 py-2 text-[11px] font-semibold transition-colors text-left"
                  style={{
                    background: terminalMode === 'source' ? 'var(--color-card)' : 'transparent',
                    color: terminalMode === 'source' ? 'var(--color-bright)' : 'var(--color-muted)',
                    border: `1px solid ${terminalMode === 'source' ? 'var(--color-green)' : 'var(--color-border)'}`,
                    cursor: 'pointer',
                  }}
                >
                  {t('dl_terminal_source_tab')}
                </button>
                <button
                  onClick={() => setTerminalMode('cli')}
                  className="px-3 py-2 text-[11px] font-semibold transition-colors text-left"
                  style={{
                    background: terminalMode === 'cli' ? 'var(--color-card)' : 'transparent',
                    color: terminalMode === 'cli' ? 'var(--color-bright)' : 'var(--color-muted)',
                    border: `1px solid ${terminalMode === 'cli' ? 'var(--color-green)' : 'var(--color-border)'}`,
                    cursor: 'pointer',
                  }}
                >
                  {t('dl_terminal_cli_tab')}
                </button>
              </div>

              <div className="border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}>
                <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <div>
                    <p className="text-[11px] font-semibold text-[var(--color-bright)]">
                      {terminalMode === 'source' ? t('dl_terminal_source_title') : t('dl_terminal_cli_title')}
                    </p>
                    <p className="text-[10px] text-[var(--color-dim)] mt-1">
                      {terminalMode === 'source' ? t('dl_terminal_source_desc') : t('dl_terminal_cli_desc')}
                    </p>
                  </div>
                  <CopyButton text={terminalCommand} size="sm" className="rounded-none">Copia comando</CopyButton>
                </div>

                <pre className="px-4 py-4 overflow-x-auto text-[11px] leading-relaxed font-mono text-[var(--color-bright)]">
                  {terminalCommand}
                </pre>
              </div>

              <p className="text-[10px] text-[var(--color-dim)] leading-relaxed mt-3">
                {terminalMode === 'source' ? t('dl_terminal_source_note') : t('dl_terminal_cli_note')}
              </p>
            </div>
          )}


        </div>
      </main>
      <ScrollToTop />
    </>
  )
}

export default function DownloadPage() {
  return (
    <LandingI18nProvider>
      <DownloadContent />
    </LandingI18nProvider>
  )
}

/* ── OS Icons (SVG inline) ── */

function AppleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ color: 'var(--color-muted)' }}>
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
    </svg>
  )
}

function LinuxIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 15 15" fill="none" aria-hidden="true" style={{ color: 'var(--color-muted)' }}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4.53918 2.40715C4.82145 1.0075 6.06066 0 7.49996 0C8.93926 0 10.1785 1.0075 10.4607 2.40715L10.798 4.07944C10.9743 4.9539 11.3217 5.78562 11.8205 6.52763L12.4009 7.39103C12.7631 7.92978 12.9999 8.5385 13.0979 9.17323C13.6747 9.22167 14.1803 9.58851 14.398 10.1283L14.8897 11.3474C15.1376 11.962 14.9583 12.665 14.4455 13.0887L12.5614 14.6458C12.0128 15.0992 11.2219 15.1193 10.6506 14.6944L9.89192 14.1301C9.88189 14.1227 9.87197 14.1151 9.86216 14.1074C9.48973 14.2075 9.09793 14.261 8.69355 14.261H6.30637C5.90201 14.261 5.51023 14.2076 5.13782 14.1074C5.12802 14.1151 5.11811 14.1227 5.10808 14.1301L4.34942 14.6944C3.77811 15.1193 2.98725 15.0992 2.43863 14.6458L0.55446 13.0887C0.0417175 12.665 -0.1376 11.962 0.110281 11.3474L0.602025 10.1283C0.819715 9.58854 1.32527 9.2217 1.90198 9.17324C2 8.5385 2.2368 7.92978 2.59897 7.39103L3.17938 6.52763C3.67818 5.78562 4.02557 4.9539 4.20193 4.07944L4.53918 2.40715ZM10.8445 9.47585C10.6345 9.63293 10.4642 9.84382 10.3561 10.0938L9.58799 11.8713C9.20026 12.0979 8.75209 12.2237 8.28465 12.2237H6.7153C6.24789 12.2237 5.79975 12.0979 5.41203 11.8714L4.64386 10.0938C4.53581 9.8438 4.36552 9.6329 4.15546 9.47582C4.18121 9.15355 4.2689 8.83503 4.41853 8.53826L5.67678 6.04259L5.68433 6.05007C6.68715 7.04458 8.31304 7.04458 9.31585 6.05007L9.32324 6.04274L10.5814 8.53825C10.7311 8.83504 10.8187 9.15357 10.8445 9.47585ZM9.04068 4.26906V3.05592H8.01353V3.85713C8.23151 3.90123 8.44506 3.97371 8.64848 4.07458L9.04068 4.26906ZM6.98638 3.85718V3.05592H5.95923V4.26919L6.3517 4.07458C6.55504 3.97375 6.7685 3.90129 6.98638 3.85718ZM2.03255 10.1864C1.82255 10.1864 1.6337 10.3132 1.55571 10.5066L1.06397 11.7257C0.981339 11.9306 1.04111 12.1649 1.21203 12.3062L3.0962 13.8633C3.27907 14.0144 3.54269 14.0211 3.73313 13.8795L4.49179 13.3152C4.6813 13.1743 4.74901 12.923 4.6557 12.7071L3.69976 10.4951C3.61884 10.3078 3.43316 10.1864 3.22771 10.1864H2.03255ZM13.4443 10.5066C13.3663 10.3132 13.1775 10.1864 12.9674 10.1864H11.7723C11.5668 10.1864 11.3812 10.3078 11.3002 10.4951L10.3443 12.7071C10.251 12.923 10.3187 13.1743 10.5082 13.3152L11.2669 13.8795C11.4573 14.0211 11.7209 14.0144 11.9038 13.8633L13.788 12.3062C13.9589 12.1649 14.0187 11.9306 13.936 11.7257L13.4443 10.5066ZM6.81106 4.98568C7.24481 4.7706 7.75537 4.7706 8.18912 4.98568L8.68739 5.23275L8.58955 5.32978C7.98786 5.92649 7.01232 5.92649 6.41063 5.32978L6.31279 5.23275L6.81106 4.98568Z"
        fill="currentColor"
      />
    </svg>
  )
}

function WindowsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ color: 'var(--color-muted)' }}>
      <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/>
    </svg>
  )
}
