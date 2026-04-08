'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { LandingI18nProvider, useLandingI18n } from '../components/landing/LandingI18n'
import LandingNav from '../components/landing/LandingNav'
import { LandingFooter } from '../components/landing/LandingCTA'
import ScrollToTop from '../components/landing/ScrollToTop'

type PlatformId = 'mac' | 'linux' | 'windows'

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

const INSTR_KEYS: Record<PlatformId, 'dl_mac_instr' | 'dl_linux_instr' | 'dl_windows_instr'> = {
  mac: 'dl_mac_instr',
  linux: 'dl_linux_instr',
  windows: 'dl_windows_instr',
}

const FALLBACK_VERSION = '0.1.0'
const FALLBACK_REPO = 'leopu00/job-hunter-team'
const FALLBACK_RELEASES_URL = `https://github.com/${FALLBACK_REPO}/releases`

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
  const { t, ta } = useLandingI18n()
  const [expanded, setExpanded] = useState<PlatformId | null>(null)
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

  return (
    <>
      <LandingNav />
      <main style={{ position: 'relative', zIndex: 1 }} className="min-h-screen flex flex-col items-center px-5 py-12 pt-24">
        <div className="w-full max-w-2xl" style={{ animation: 'fade-in 0.5s ease both' }}>

          {/* Header */}
          <div className="mb-12 text-center">
            <Link href="/" className="inline-flex items-center mb-6 no-underline hover:no-underline">
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
            {platforms.map((platform, i) => {
              const isExpanded = expanded === platform.id
              const Icon = ICONS[platform.id] || (() => null)
              const instrKey = INSTR_KEYS[platform.id]
              const instructions = platform.instructions.length > 0
                ? platform.instructions
                : instrKey ? ta(instrKey) : []
              const ctaHref = platform.available ? platform.downloadUrl : releasesUrl

              return (
                <div key={platform.id} className="border rounded-lg overflow-hidden transition-all duration-200"
                  style={{
                    borderColor: 'var(--color-border)',
                    background: 'var(--color-panel)',
                    animation: `fade-in 0.4s ease ${i * 0.12}s both`,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-border-glow)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}>
                  {/* Card header */}
                  <div className="px-4 sm:px-5 py-4">
                    <div className="flex items-center gap-3 sm:gap-4">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
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
                    <div className="flex items-center gap-2 mt-3">
                      <button
                        onClick={() => setExpanded(isExpanded ? null : platform.id)}
                        aria-expanded={isExpanded}
                        aria-controls={`dl-instr-${platform.id}`}
                        className="flex-1 sm:flex-none px-3 py-2 rounded text-[11px] font-semibold transition-colors"
                        style={{
                          background: 'var(--color-card)',
                          color: 'var(--color-muted)',
                          border: '1px solid var(--color-border)',
                          cursor: 'pointer',
                        }}>
                        {isExpanded ? t('dl_close') : t('dl_instructions')}
                      </button>
                      <a href={ctaHref}
                        className="flex-1 sm:flex-none text-center px-5 py-2 rounded text-[12px] font-bold tracking-wide transition-all no-underline hover:no-underline"
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

                  {/* Expandable instructions */}
                  {isExpanded && (
                    <div id={`dl-instr-${platform.id}`} role="region" aria-label={`${platform.label} ${t('dl_instructions')}`} className="px-5 pb-4 pt-0" style={{ animation: 'fade-in 0.15s ease both' }}>
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

          {/* Install note */}
          <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] px-5 py-4 mb-8">
            <div className="flex items-start gap-3">
              <span className="text-[var(--color-yellow)] text-[16px] flex-shrink-0" aria-hidden="true">!</span>
              <div>
                <p className="text-[11px] text-[var(--color-bright)] font-semibold mb-1">{t('dl_setup_title')}</p>
                <p className="text-[10px] text-[var(--color-muted)] leading-relaxed">
                  {t('dl_setup_desc')}
                </p>
              </div>
            </div>
          </div>

          {/* Mac detailed guide */}
          <MacGuide />

          {/* Demo CTA */}
          <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-panel)] p-5 mb-8 text-center">
            <p className="text-[12px] text-[var(--color-muted)] mb-3">
              {t('dl_demo_question')}
            </p>
            <Link href="/demo"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[12px] font-semibold tracking-wide transition-all no-underline"
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

/* ── Mac Installation Guide ── */

function MacGuide() {
  const { t, ta } = useLandingI18n()
  const [open, setOpen] = useState(false)

  return (
    <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-panel)] overflow-hidden mb-8">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="dl-mac-guide-panel"
        className="w-full px-5 py-4 flex items-center justify-between text-left transition-colors"
        style={{ cursor: 'pointer', background: 'transparent', border: 'none' }}>
        <div className="flex items-center gap-3">
          <AppleIcon />
          <span className="text-[13px] font-bold text-[var(--color-white)]">{t('dl_mac_guide_title')}</span>
        </div>
        <span className="text-[var(--color-dim)] text-[14px]" aria-hidden="true">{open ? '\u25B2' : '\u25BC'}</span>
      </button>

      {open && (
        <div id="dl-mac-guide-panel" role="region" aria-label={t('dl_mac_guide_title')} className="px-5 pb-5 space-y-5" style={{ animation: 'fade-in 0.15s ease both' }}>
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
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ color: 'var(--color-muted)' }}>
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
    </svg>
  )
}

function LinuxIcon() {
  return (
    <img
      src="/tux.svg"
      alt=""
      aria-hidden="true"
      width={22}
      height={22}
      style={{ display: 'block', width: 22, height: 22, objectFit: 'contain' }}
    />
  )
}

function WindowsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ color: 'var(--color-muted)' }}>
      <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/>
    </svg>
  )
}
