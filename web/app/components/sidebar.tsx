'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import LanguageSwitcher from './LanguageSwitcher'
import { ThemeToggle } from '../theme-provider'
import { isMarketingRoute } from '../marketing-routes'

// ── Nav data: [group, [[href, label, badge?][]]] ───────────────────────────

const NAV: [string, [string, string, number?][]][] = [
  ['SISTEMA',     [['/dashboard','Dashboard'],['/deploy','Deploy'],['/gateway','Gateway'],['/status','Stato'],['/download','Download']]],
  ['JOB HUNTING', [['/jobs','Offerte'],['/applications','Candidature',3],['/interviews','Colloqui',1],['/companies','Aziende'],['/cover-letters','Cover Letter'],['/profiles','Profili'],['/alerts','Alert',5]]],
  ['AGENTI',      [['/agents','Agenti'],['/assistant','Assistente'],['/tasks','Task'],['/queue','Queue'],['/workers','Workers']]],
  ['DATI',        [['/events','Events'],['/history','History'],['/analytics','Analytics'],['/logs','Logs'],['/database','Database']]],
  ['TOOLS',       [['/api-explorer','API Explorer'],['/automations','Automazioni'],['/scheduler','Scheduler'],['/monitoring','Monitoring'],['/errors','Errori'],['/performance','Performance'],['/git','Git']]],
  ['CONFIG',      [['/providers','Provider'],['/rate-limiter','Rate Limiter'],['/credentials','Credenziali'],['/channels','Canali'],['/plugins','Plugin'],['/templates','Template'],['/memory','Memory'],['/notifications','Notifiche'],['/settings','Impostazioni'],['/cron','Cron']]],
]

const APP_CHROME_HIDDEN = ['/dashboard','/profile','/capitano','/scout','/analista','/scorer','/scrittore','/critico','/sentinella','/team','/applications','/positions','/ready','/risposte','/crescita','/assistente','/setup']

export default function Sidebar() {
  const pathname    = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isMobile,   setIsMobile]   = useState(false)
  const [collapsed,  setCollapsed]  = useState(false)
  const [favs,       setFavs]       = useState<string[]>([])
  const [hovered,    setHovered]    = useState<string | null>(null)

  const isProtected = isMarketingRoute(pathname) || APP_CHROME_HIDDEN.some(p => pathname === p || pathname.startsWith(p + '/'))

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check(); window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => { setMobileOpen(false) }, [pathname])

  useEffect(() => {
    try {
      setFavs(JSON.parse(localStorage.getItem('jht:sb-favs') ?? '[]'))
      setCollapsed(localStorage.getItem('jht:sb-coll') === 'true')
    } catch {}
  }, [])

  const w = collapsed ? 48 : 200

  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', `${w}px`)
  }, [w])

  if (isProtected) return null

  const toggleCollapse = () => {
    const next = !collapsed; setCollapsed(next)
    localStorage.setItem('jht:sb-coll', String(next))
  }
  const toggleFav = (href: string) => {
    const next = favs.includes(href) ? favs.filter(f => f !== href) : [...favs, href]
    setFavs(next); localStorage.setItem('jht:sb-favs', JSON.stringify(next))
  }

  const allLinks   = NAV.flatMap(([, ls]) => ls)
  const favLinks   = allLinks.filter(([h]) => favs.includes(h))

  const renderLink = ([href, label, badge]: [string, string, number?]) => {
    const active = pathname === href || pathname.startsWith(href + '/')
    const isFav  = favs.includes(href)
    return (
      <li key={href} className="relative" onMouseEnter={() => setHovered(href)} onMouseLeave={() => setHovered(null)}>
        <Link href={href} aria-current={active ? 'page' : undefined}
          className="flex items-center gap-2 px-2 py-1.5 rounded text-[11px] no-underline transition-colors"
          style={{ color: active ? 'var(--color-green)' : 'var(--color-muted)', background: active ? 'rgba(0,232,122,0.08)' : 'transparent', borderLeft: active ? '2px solid var(--color-green)' : '2px solid transparent' }}>
          {collapsed
            ? <span className="w-full text-center text-[10px] font-semibold" title={label}>{label[0]}</span>
            : <><span className="flex-1 truncate">{label}</span>
               {badge ? <span className="text-[8px] font-bold px-1 rounded-full" style={{ background: 'var(--color-red)22', color: 'var(--color-red)' }}>{badge}</span> : null}</>
          }
        </Link>
        {!collapsed && hovered === href && (
          <button onClick={() => toggleFav(href)}
            aria-label={isFav ? `Rimuovi ${label} dai preferiti` : `Aggiungi ${label} ai preferiti`}
            className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] transition-opacity"
            style={{ color: isFav ? 'var(--color-yellow)' : 'var(--color-dim)', background: 'none', border: 'none', cursor: 'pointer' }}>
            {isFav ? '★' : '☆'}
          </button>
        )}
      </li>
    )
  }

  const sidebarContent = (
    <aside role="navigation" aria-label="Navigazione principale"
      className="flex flex-col h-full overflow-y-auto"
      style={{ width: w, minWidth: w, background: 'var(--color-deep)', borderRight: '1px solid var(--color-border)', transition: 'width 0.2s ease, min-width 0.2s ease' }}>

      {/* Header */}
      <div className="px-3 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
        {!collapsed && <div><p className="text-[11px] font-bold tracking-widest" style={{ color: 'var(--color-white)' }}>JHT</p><p className="text-[9px]" style={{ color: 'var(--color-dim)' }}>Job Hunter Team</p></div>}
        <div className="flex items-center gap-1 ml-auto">
          {isMobile  && <button onClick={() => setMobileOpen(false)} aria-label="Chiudi menu" style={{ background: 'none', border: 'none', color: 'var(--color-dim)', cursor: 'pointer', fontSize: 18 }}>×</button>}
          {!isMobile && <button onClick={toggleCollapse} aria-label={collapsed ? 'Espandi sidebar' : 'Comprimi sidebar'} style={{ background: 'none', border: 'none', color: 'var(--color-dim)', cursor: 'pointer', fontSize: 13, padding: '2px 4px' }}>{collapsed ? '→' : '←'}</button>}
        </div>
      </div>

      {/* Nav */}
      <nav aria-label="Menu dashboard" className="flex-1 px-2 py-3 flex flex-col gap-3 overflow-y-auto">
        {!collapsed && favLinks.length > 0 && (
          <div>
            <p className="text-[8px] font-bold tracking-widest px-2 mb-1" style={{ color: 'var(--color-yellow)' }}>★ PREFERITI</p>
            <ul className="flex flex-col gap-0.5">{favLinks.map(renderLink)}</ul>
          </div>
        )}
        {NAV.map(([group, links]) => (
          <div key={group}>
            {!collapsed && <p className="text-[8px] font-bold tracking-widest px-2 mb-1" style={{ color: 'var(--color-dim)' }}>{group}</p>}
            <ul className="flex flex-col gap-0.5">{links.map(renderLink)}</ul>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t flex flex-col gap-2" style={{ borderColor: 'var(--color-border)' }}>
        {!collapsed && (
          <div className="flex items-center justify-between">
            <span className="text-[8px] font-mono" style={{ color: 'var(--color-dim)' }}>v1.0.0</span>
            <a href="https://github.com/leopu00/job-hunter-team" target="_blank" rel="noreferrer"
              className="text-[8px] hover:opacity-80 transition-opacity" style={{ color: 'var(--color-dim)' }}>docs →</a>
          </div>
        )}
        {!collapsed && <div className="flex items-center justify-between"><LanguageSwitcher /><ThemeToggle /></div>}
      </div>
    </aside>
  )

  if (isMobile) return (
    <>
      <button onClick={() => setMobileOpen(true)} aria-label="Apri menu"
        style={{ position: 'fixed', top: 12, left: 12, zIndex: 60, background: 'var(--color-panel)', border: '1px solid var(--color-border)', borderRadius: 6, padding: '6px 8px', cursor: 'pointer', color: 'var(--color-muted)', lineHeight: 1 }}>☰</button>
      {mobileOpen && (
        <>
          <div onClick={() => setMobileOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 55, animation: 'fade-in 0.15s ease both' }} />
          <div style={{ position: 'fixed', left: 0, top: 0, height: '100vh', zIndex: 60, animation: 'fade-in 0.2s ease both' }}>{sidebarContent}</div>
        </>
      )}
    </>
  )

  return <div style={{ position: 'fixed', left: 0, top: 0, height: '100vh', zIndex: 50 }}>{sidebarContent}</div>
}
