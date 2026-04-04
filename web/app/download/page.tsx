'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { LandingI18nProvider, useLandingI18n } from '../components/landing/LandingI18n'
import LandingNav from '../components/landing/LandingNav'

type OS = 'mac' | 'linux' | 'windows' | null

interface PlatformData {
  id: string
  label: string
  file: string
  size: string | null
  requirements: string
  instructions: string[]
}

interface ReleaseData {
  version: string
  downloadBaseUrl: string
  platforms: PlatformData[]
  releasesUrl: string
}

const ICONS: Record<string, () => React.ReactNode> = {
  mac: AppleIcon,
  linux: LinuxIcon,
  windows: WindowsIcon,
}

const INSTR_KEYS: Record<string, 'dl_mac_instr' | 'dl_linux_instr' | 'dl_windows_instr'> = {
  mac: 'dl_mac_instr',
  linux: 'dl_linux_instr',
  windows: 'dl_windows_instr',
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
const FALLBACK_BASE_URL = `https://github.com/${FALLBACK_REPO}/releases/latest/download`

const FALLBACK_PLATFORMS: PlatformData[] = [
  {
    id: 'mac', label: 'macOS', file: `job-hunter-team-${FALLBACK_VERSION}-mac.tar.gz`, size: null,
    requirements: 'macOS 12+, Node.js 18+',
    instructions: [],
  },
  {
    id: 'linux', label: 'Linux', file: `job-hunter-team-${FALLBACK_VERSION}-linux.tar.gz`, size: null,
    requirements: 'Ubuntu 20.04+ / Fedora 36+ / Debian 11+, Node.js 18+',
    instructions: [],
  },
  {
    id: 'windows', label: 'Windows', file: `job-hunter-team-${FALLBACK_VERSION}-windows.zip`, size: null,
    requirements: 'Windows 10+, Node.js 18+, PowerShell 5.1+',
    instructions: [],
  },
]

function DownloadContent() {
  const { t, ta } = useLandingI18n()
  const [detectedOS, setDetectedOS] = useState<OS>(null)
  const [expanded, setExpanded] = useState<OS>(null)
  const [release, setRelease] = useState<ReleaseData>({
    version: FALLBACK_VERSION,
    downloadBaseUrl: FALLBACK_BASE_URL,
    platforms: FALLBACK_PLATFORMS,
    releasesUrl: `https://github.com/${FALLBACK_REPO}/releases`,
  })

  useEffect(() => {
    setDetectedOS(detectOS())
    fetch('/api/download')
      .then(r => r.json())
      .then((data: ReleaseData) => setRelease(data))
      .catch(() => {})
  }, [])

  const { version, downloadBaseUrl, platforms, releasesUrl } = release

  const sorted = [...platforms].sort((a, b) => {
    if (a.id === detectedOS) return -1
    if (b.id === detectedOS) return 1
    return 0
  })

  return (
    <>
      <LandingNav />
      <main style={{ position: 'relative', zIndex: 1 }} className="min-h-screen flex flex-col items-center px-5 py-12 pt-24">
        <div className="w-full max-w-2xl" style={{ animation: 'fade-in 0.5s ease both' }}>

          {/* Header */}
          <div className="mb-12 text-center">
            <Link href="/" className="inline-flex items-center gap-2 mb-6 no-underline hover:no-underline">
              <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-green)]" style={{ animation: 'pulse-dot 2s ease-in-out infinite' }} />
              <span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[var(--color-green)]">download</span>
            </Link>
            <h1 className="text-3xl font-bold tracking-tight text-[var(--color-white)] leading-none mb-3">
              Job Hunter<br /><span className="text-[var(--color-green)]">Team</span>
            </h1>
            <p className="text-[var(--color-muted)] text-[12px] leading-relaxed max-w-md mx-auto mb-2">
              {t('dl_desc')}
            </p>
            <span className="text-[10px] text-[var(--color-dim)]">v{version} &middot; open source</span>
          </div>

          {/* OS Cards */}
          <div className="flex flex-col gap-4 mb-10">
            {sorted.map((platform) => {
              const isDetected = platform.id === detectedOS
              const isExpanded = expanded === platform.id as OS
              const Icon = ICONS[platform.id] || (() => null)
              const instrKey = INSTR_KEYS[platform.id]
              const instructions = instrKey ? ta(instrKey) : platform.instructions

              return (
                <div key={platform.id} className="border rounded-lg overflow-hidden transition-colors"
                  style={{
                    borderColor: isDetected ? 'var(--color-green)' : 'var(--color-border)',
                    background: 'var(--color-panel)',
                    boxShadow: isDetected ? '0 0 20px rgba(0,232,122,0.07)' : 'none',
                  }}>
                  {/* Card header */}
                  <div className="px-5 py-4 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
                      <Icon />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-bold text-[var(--color-white)]">{platform.label}</span>
                        {isDetected && (
                          <span className="text-[9px] font-semibold tracking-widest uppercase px-2 py-0.5 rounded"
                            style={{ background: 'rgba(0,232,122,0.12)', color: 'var(--color-green)', border: '1px solid rgba(0,232,122,0.25)' }}>
                            {t('dl_detected')}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-[var(--color-dim)]">
                        {platform.file}
                        {platform.size && <> &middot; {platform.size}</>}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => setExpanded(isExpanded ? null : platform.id as OS)}
                        className="px-3 py-2 rounded text-[11px] font-semibold transition-colors"
                        style={{
                          background: 'var(--color-card)',
                          color: 'var(--color-muted)',
                          border: '1px solid var(--color-border)',
                          cursor: 'pointer',
                        }}>
                        {isExpanded ? t('dl_close') : t('dl_instructions')}
                      </button>
                      <a href={`${downloadBaseUrl}/${platform.file}`}
                        className="px-5 py-2 rounded text-[12px] font-bold tracking-wide transition-all no-underline hover:no-underline"
                        style={{
                          background: isDetected ? 'var(--color-green)' : 'var(--color-card)',
                          color: isDetected ? '#000' : 'var(--color-green)',
                          border: isDetected ? 'none' : '1px solid var(--color-green)',
                          cursor: 'pointer',
                        }}>
                        {t('dl_download')}
                      </a>
                    </div>
                  </div>

                  {/* Expandable instructions */}
                  {isExpanded && (
                    <div className="px-5 pb-4 pt-0" style={{ animation: 'fade-in 0.15s ease both' }}>
                      <div className="border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
                        <p className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)] mb-3">{t('dl_instructions')}</p>
                        <ol className="space-y-2 mb-4">
                          {instructions.map((step, i) => (
                            <li key={i} className="flex gap-2 text-[11px]">
                              <span className="text-[var(--color-green)] font-bold flex-shrink-0">{i + 1}.</span>
                              <code className="text-[var(--color-bright)] font-mono">{step}</code>
                            </li>
                          ))}
                        </ol>
                        <p className="text-[10px] text-[var(--color-dim)]">
                          <span className="font-semibold">Requirements:</span> {platform.requirements}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* How it works */}
          <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-panel)] p-5 mb-8">
            <p className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)] mb-4">{t('dl_how_title')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {([
                { step: '01', titleKey: 'dl_step1_title', descKey: 'dl_step1_desc' },
                { step: '02', titleKey: 'dl_step2_title', descKey: 'dl_step2_desc' },
                { step: '03', titleKey: 'dl_step3_title', descKey: 'dl_step3_desc' },
              ] as const).map(({ step, titleKey, descKey }) => (
                <div key={step} className="text-center">
                  <div className="text-[20px] font-bold text-[var(--color-green)] mb-1">{step}</div>
                  <div className="text-[12px] font-bold text-[var(--color-white)] mb-1">{t(titleKey)}</div>
                  <div className="text-[10px] text-[var(--color-muted)] leading-relaxed">{t(descKey)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Node.js requirement note */}
          <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] px-5 py-4 mb-8">
            <div className="flex items-start gap-3">
              <span className="text-[var(--color-yellow)] text-[16px] flex-shrink-0">!</span>
              <div>
                <p className="text-[11px] text-[var(--color-bright)] font-semibold mb-1">{t('dl_node_title')}</p>
                <p className="text-[10px] text-[var(--color-muted)] leading-relaxed">
                  {t('dl_node_desc')}{' '}
                  {t('dl_node_link')}{' '}
                  <a href="https://nodejs.org" target="_blank" rel="noopener noreferrer"
                    className="text-[var(--color-green)] hover:underline">nodejs.org</a>.
                </p>
              </div>
            </div>
          </div>

          {/* Mac detailed guide */}
          <MacGuide />

          {/* Footer */}
          <div className="text-center">
            <p className="text-[10px] text-[var(--color-dim)]">
              v{version}-alpha &middot; Job Hunter Team &middot;{' '}
              <Link href="/" className="text-[var(--color-green)] hover:underline">{t('dl_home')}</Link>
              {' '}&middot;{' '}
              <a href={releasesUrl} target="_blank" rel="noopener noreferrer"
                className="text-[var(--color-green)] hover:underline">{t('dl_all_releases')}</a>
            </p>
          </div>
        </div>
      </main>
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

/* ── Mac Installation Guide ── */

function MacGuide() {
  const { t, ta } = useLandingI18n()
  const [open, setOpen] = useState(false)

  return (
    <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-panel)] overflow-hidden mb-8">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-4 flex items-center justify-between text-left transition-colors"
        style={{ cursor: 'pointer', background: 'transparent', border: 'none' }}>
        <div className="flex items-center gap-3">
          <AppleIcon />
          <span className="text-[13px] font-bold text-[var(--color-white)]">{t('dl_mac_guide_title')}</span>
        </div>
        <span className="text-[var(--color-dim)] text-[14px]">{open ? '\u25B2' : '\u25BC'}</span>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-5" style={{ animation: 'fade-in 0.15s ease both' }}>
          <div className="border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>

            {/* Requisiti */}
            <GuideSection title={t('dl_mac_prereq_title')}>
              <ul className="space-y-1.5">
                {ta('dl_mac_prereq').map((item, i) => (
                  <li key={i} className="flex gap-2 text-[11px]">
                    <span className="text-[var(--color-green)] flex-shrink-0">{'\u2713'}</span>
                    <span className="text-[var(--color-bright)]">{item}</span>
                  </li>
                ))}
              </ul>
            </GuideSection>

            {/* Passo 1: Node.js */}
            <GuideSection title={t('dl_mac_node_title')}>
              <p className="text-[10px] text-[var(--color-muted)] mb-3">{t('dl_mac_node_desc')}</p>
              <ol className="space-y-2 mb-3">
                {ta('dl_mac_node_steps').map((step, i) => (
                  <li key={i} className="flex gap-2 text-[11px]">
                    <span className="text-[var(--color-green)] font-bold flex-shrink-0">{i + 1}.</span>
                    <code className="text-[var(--color-bright)] font-mono text-[10px] leading-relaxed">{step}</code>
                  </li>
                ))}
              </ol>
              <p className="text-[10px] text-[var(--color-dim)] italic">{t('dl_mac_node_alt')}</p>
            </GuideSection>

            {/* Passo 2: Download e avvio */}
            <GuideSection title={t('dl_mac_install_title')}>
              <ol className="space-y-2">
                {ta('dl_mac_install_steps').map((step, i) => (
                  <li key={i} className="flex gap-2 text-[11px]">
                    <span className="text-[var(--color-green)] font-bold flex-shrink-0">{i + 1}.</span>
                    <code className="text-[var(--color-bright)] font-mono text-[10px] leading-relaxed">{step}</code>
                  </li>
                ))}
              </ol>
            </GuideSection>

            {/* Cosa succede */}
            <GuideSection title={t('dl_mac_expect_title')} last>
              <ol className="space-y-1.5">
                {ta('dl_mac_expect_steps').map((step, i) => (
                  <li key={i} className="flex gap-2 text-[11px]">
                    <span className="text-[var(--color-dim)] flex-shrink-0">{'\u25B8'}</span>
                    <span className="text-[var(--color-muted)]">{step}</span>
                  </li>
                ))}
              </ol>
            </GuideSection>
          </div>
        </div>
      )}
    </div>
  )
}

function GuideSection({ title, children, last }: { title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={last ? '' : 'mb-5'}>
      <p className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-green)] mb-2">{title}</p>
      {children}
    </div>
  )
}

/* ── OS Icons (SVG inline) ── */

function AppleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ color: 'var(--color-muted)' }}>
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
    </svg>
  )
}

function LinuxIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ color: 'var(--color-muted)' }}>
      <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.368 1.884 1.43.199.023.4-.002.64-.092.66-.26.869-.6.778-1.2-.046-.268-.177-.533-.301-.67-.124-.201-.17-.401-.24-.7-.064-.334-.163-.469-.16-.867.266-.073.536-.267.735-.467.227-.2.418-.468.576-.77.318-.601.465-1.33.377-2.099-.039-.4-.123-.467-.2-.868-.082-.465.008-.533.022-1.07 0-.068.005-.2-.023-.335a.622.622 0 00-.105-.197c-.133-.2-.333-.395-.6-.464-.273-.067-.56-.066-.846-.067-.283 0-.518-.133-.666-.267-.15-.132-.28-.267-.453-.267-.166 0-.367.133-.467.267l-.235.268a.73.73 0 01-.65.333c-.347 0-.467-.2-.532-.401a.963.963 0 01-.043-.199v-.133c0-.1.024-.2.067-.301.167-.467.5-.867.867-1.067.367-.197.8-.133 1.067.133.167.168.267.4.333.667.067.267.126.533.126.802 0 .267-.059.533-.192.733-.133.2-.333.401-.534.534a2.098 2.098 0 01-.733.267c-.267.066-.533.066-.733-.067a.844.844 0 01-.313-.412L12.71 18.3c.133-.266.28-.47.413-.668.27-.4.54-.734.665-1.134.135-.4.2-.867.127-1.333a.844.844 0 00-.106-.333c-.159-.267-.4-.467-.667-.6l-.1-.067c.07-.333.12-.667.12-1 0-.534-.107-1.067-.334-1.534-.226-.466-.6-.866-1.066-1.066-.467-.2-1-.267-1.534-.134-.133.034-.267.1-.4.2 0-.868.134-1.734.534-2.401.4-.667 1.067-1.133 2-1.133h.133c.534.067.934.4 1.334.734.4.333.8.733 1.266.733.134 0 .267-.034.4-.1.534-.267.734-.8.734-1.334 0-.266-.067-.533-.2-.733a1.06 1.06 0 00-.534-.4 1.773 1.773 0 00-.467-.066z"/>
    </svg>
  )
}

function WindowsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ color: 'var(--color-muted)' }}>
      <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/>
    </svg>
  )
}
