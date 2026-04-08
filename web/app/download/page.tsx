'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CopyButton } from '../components/CopyButton'
import { LandingI18nProvider, useLandingI18n } from '../components/landing/LandingI18n'
import LandingNav from '../components/landing/LandingNav'
import { LandingFooter } from '../components/landing/LandingCTA'
import ScrollToTop from '../components/landing/ScrollToTop'

type PlatformId = 'mac' | 'linux' | 'windows'
type OS = PlatformId | null
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

function detectOS(): OS {
  if (typeof navigator === 'undefined') return null
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('mac')) return 'mac'
  if (ua.includes('win')) return 'windows'
  if (ua.includes('linux')) return 'linux'
  return null
}

const FALLBACK_VERSION = '0.1.0'
const FALLBACK_REPO = 'leopu00/job-hunter-team'
const FALLBACK_RELEASES_URL = `https://github.com/${FALLBACK_REPO}/releases`
const SOURCE_SETUP_CMD = `git clone https://github.com/leopu00/job-hunter-team.git
cd job-hunter-team
npm install
cd web && npm install && npm run dev`

const CLI_SETUP_CMD = `git clone https://github.com/leopu00/job-hunter-team.git
cd job-hunter-team
npm install
npm install --prefix shared/cron
npm install --prefix cli
node cli/bin/jht.js setup`

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
    id: 'windows', label: 'Windows', file: `job-hunter-team-${FALLBACK_VERSION}-windows.exe`, size: null,
    requirements: 'Windows 10/11 (x64)',
    instructions: [],
    downloadUrl: `https://github.com/${FALLBACK_REPO}/releases/latest/download/job-hunter-team-${FALLBACK_VERSION}-windows.exe`,
    available: true,
    format: 'exe',
  },
]

function DownloadContent() {
  const { t } = useLandingI18n()
  const [detectedOS, setDetectedOS] = useState<OS>(null)
  const [installMode, setInstallMode] = useState<InstallMode>('desktop')
  const [terminalMode, setTerminalMode] = useState<TerminalMode>('source')
  const [release, setRelease] = useState<ReleaseData>({
    version: FALLBACK_VERSION,
    platforms: FALLBACK_PLATFORMS,
    releasesUrl: FALLBACK_RELEASES_URL,
  })

  useEffect(() => {
    setDetectedOS(detectOS())
  }, [])

  useEffect(() => {
    fetch('/api/download')
      .then(r => r.json())
      .then((data: ReleaseData) => setRelease(data))
      .catch(() => {})
  }, [])

  const { version, platforms, releasesUrl } = release

  const sorted = [...platforms].sort((a, b) => {
    if (a.id === detectedOS) return -1
    if (b.id === detectedOS) return 1
    return 0
  })
  const terminalCommand = terminalMode === 'source' ? SOURCE_SETUP_CMD : CLI_SETUP_CMD

  return (
    <>
      <LandingNav />
      <main style={{ position: 'relative', zIndex: 1 }} className="min-h-screen flex flex-col items-center px-5 py-12 pt-24">
        <div className="w-full max-w-2xl" style={{ animation: 'fade-in 0.5s ease both' }}>

          {/* Header */}
          <div className="mb-12 text-center">
            <div className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[var(--color-green)] mb-6">
              download
            </div>
            <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-[var(--color-white)] leading-none mb-3">
              Job Hunter <span className="text-[var(--color-green)]">Team</span>
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
              <div className="flex flex-col gap-4 mb-10">
                {sorted.map((platform, i) => {
                  const isDetected = platform.id === detectedOS
                  const Icon = ICONS[platform.id] || (() => null)
                  const ctaHref = platform.available ? platform.downloadUrl : releasesUrl

                  return (
                    <div key={platform.id} className="border overflow-hidden transition-all duration-200"
                      style={{
                        borderColor: isDetected ? 'var(--color-green)' : 'var(--color-border)',
                        background: 'var(--color-panel)',
                        boxShadow: isDetected ? '0 0 20px rgba(0,232,122,0.07)' : 'none',
                        animation: `fade-in 0.4s ease ${i * 0.12}s both`,
                      }}
                      onMouseEnter={e => { if (!isDetected) e.currentTarget.style.borderColor = 'var(--color-border-glow)' }}
                      onMouseLeave={e => { if (!isDetected) e.currentTarget.style.borderColor = 'var(--color-border)' }}>
                      <div className="px-4 sm:px-5 py-4">
                        <div className="flex items-center gap-3 sm:gap-4">
                          <div className="w-10 h-10 flex items-center justify-center flex-shrink-0"
                            style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
                            <Icon />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[14px] font-bold text-[var(--color-white)]">{platform.label}</span>
                              {isDetected && (
                                <span className="text-[9px] font-semibold tracking-widest uppercase px-2 py-0.5"
                                  style={{ background: 'rgba(0,232,122,0.12)', color: 'var(--color-green)', border: '1px solid rgba(0,232,122,0.25)' }}>
                                  {t('dl_detected')}
                                </span>
                              )}
                            </div>
                            <span className="text-[9px] sm:text-[10px] text-[var(--color-dim)] break-all">
                              {platform.file}
                              {platform.size && <> &middot; {platform.size}</>}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-3">
                          <a href={ctaHref}
                            className="w-full sm:w-auto text-center px-5 py-2 text-[12px] font-bold tracking-wide transition-all no-underline hover:no-underline"
                            style={{
                              background: platform.available && isDetected ? 'var(--color-green)' : 'var(--color-card)',
                              color: platform.available && isDetected ? '#000' : 'var(--color-green)',
                              border: platform.available && isDetected ? 'none' : '1px solid var(--color-green)',
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

          {/* Demo CTA */}
          <div className="border border-[var(--color-border)] bg-[var(--color-panel)] p-5 mb-8 text-center">
            <p className="text-[12px] text-[var(--color-muted)] mb-3">
              {t('dl_demo_question')}
            </p>
            <Link href="/demo"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-[12px] font-semibold tracking-wide transition-all no-underline"
              style={{ border: '1px solid var(--color-green)', color: 'var(--color-green)' }}>
              {t('dl_demo_cta')} &rarr;
            </Link>
          </div>

          {/* Footer */}
          <div className="text-center">
            <p className="text-[10px] text-[var(--color-dim)]">
              v{version} &middot; Job Hunter Team &middot;{' '}
              <Link href="/" className="text-[var(--color-green)] hover:underline">{t('dl_home')}</Link>
              {' '}&middot;{' '}
              <a href={releasesUrl} target="_blank" rel="noopener noreferrer"
                className="text-[var(--color-green)] hover:underline">{t('dl_all_releases')}</a>
            </p>
          </div>
        </div>
      </main>
      <LandingFooter />
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
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ color: 'var(--color-muted)' }}>
      <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.368 1.884 1.43.199.023.4-.002.64-.092.66-.26.869-.6.778-1.2-.046-.268-.177-.533-.301-.67-.124-.201-.17-.401-.24-.7-.064-.334-.163-.469-.16-.867.266-.073.536-.267.735-.467.227-.2.418-.468.576-.77.318-.601.465-1.33.377-2.099-.039-.4-.123-.467-.2-.868-.082-.465.008-.533.022-1.07 0-.068.005-.2-.023-.335a.622.622 0 00-.105-.197c-.133-.2-.333-.395-.6-.464-.273-.067-.56-.066-.846-.067-.283 0-.518-.133-.666-.267-.15-.132-.28-.267-.453-.267-.166 0-.367.133-.467.267l-.235.268a.73.73 0 01-.65.333c-.347 0-.467-.2-.532-.401a.963.963 0 01-.043-.199v-.133c0-.1.024-.2.067-.301.167-.467.5-.867.867-1.067.367-.197.8-.133 1.067.133.167.168.267.4.333.667.067.267.126.533.126.802 0 .267-.059.533-.192.733-.133.2-.333.401-.534.534a2.098 2.098 0 01-.733.267c-.267.066-.533.066-.733-.067a.844.844 0 01-.313-.412L12.71 18.3c.133-.266.28-.47.413-.668.27-.4.54-.734.665-1.134.135-.4.2-.867.127-1.333a.844.844 0 00-.106-.333c-.159-.267-.4-.467-.667-.6l-.1-.067c.07-.333.12-.667.12-1 0-.534-.107-1.067-.334-1.534-.226-.466-.6-.866-1.066-1.066-.467-.2-1-.267-1.534-.134-.133.034-.267.1-.4.2 0-.868.134-1.734.534-2.401.4-.667 1.067-1.133 2-1.133h.133c.534.067.934.4 1.334.734.4.333.8.733 1.266.733.134 0 .267-.034.4-.1.534-.267.734-.8.734-1.334 0-.266-.067-.533-.2-.733a1.06 1.06 0 00-.534-.4 1.773 1.773 0 00-.467-.066z"/>
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
