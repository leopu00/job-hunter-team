'use client'

import { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react'
import { useRouter } from 'next/navigation'
import { useShortcuts } from '../app/components/KeyboardShortcuts'
import { useLocale } from '@/lib/use-locale'

const T: Record<string, Record<string, string>> = {
  placeholder: {
    it: 'Cerca pagine, azioni, comandi…',
    en: 'Search pages, actions, commands…',
    hu: 'Oldalak, műveletek, parancsok keresése…',
    es: 'Buscar páginas, acciones, comandos…',
    de: 'Seiten, Aktionen, Befehle suchen…',
    fr: 'Rechercher pages, actions, commandes…',
    pt: 'Pesquisar páginas, ações, comandos…',
  },
  aria_search: {
    it: 'Cerca comandi', en: 'Search commands', hu: 'Parancsok keresése',
    es: 'Buscar comandos', de: 'Befehle suchen', fr: 'Rechercher des commandes', pt: 'Pesquisar comandos',
  },
  no_results: {
    it: 'Nessun risultato', en: 'No results', hu: 'Nincs találat',
    es: 'Sin resultados', de: 'Keine Ergebnisse', fr: 'Aucun résultat', pt: 'Nenhum resultado',
  },
  cat_pages: { it: 'Pagine', en: 'Pages', hu: 'Oldalak', es: 'Páginas', de: 'Seiten', fr: 'Pages', pt: 'Páginas' },
  cat_config: { it: 'Config', en: 'Config', hu: 'Beállítás', es: 'Config', de: 'Config', fr: 'Config', pt: 'Config' },
  cat_actions: { it: 'Azioni', en: 'Actions', hu: 'Műveletek', es: 'Acciones', de: 'Aktionen', fr: 'Actions', pt: 'Ações' },
  cat_results: { it: 'Risultati', en: 'Results', hu: 'Találatok', es: 'Resultados', de: 'Ergebnisse', fr: 'Résultats', pt: 'Resultados' },
  dashboard_label: { it: 'Dashboard', en: 'Dashboard', hu: 'Irányítópult', es: 'Panel', de: 'Dashboard', fr: 'Tableau de bord', pt: 'Painel' },
  dashboard_detail: {
    it: 'Vista riepilogativa lavoro in corso', en: 'Summary view of work in progress', hu: 'A folyamatban lévő munka áttekintése',
    es: 'Vista resumen del trabajo en curso', de: 'Übersicht der laufenden Arbeit', fr: 'Vue récapitulative du travail en cours', pt: 'Visão geral do trabalho em andamento',
  },
  positions_label: { it: 'Offerte', en: 'Jobs', hu: 'Állások', es: 'Ofertas', de: 'Stellen', fr: 'Offres', pt: 'Vagas' },
  positions_detail: {
    it: 'Job trovati dagli agenti', en: 'Jobs found by the agents', hu: 'Az ügynökök által talált állások',
    es: 'Empleos encontrados por los agentes', de: 'Von den Agenten gefundene Jobs', fr: 'Offres trouvées par les agents', pt: 'Vagas encontradas pelos agentes',
  },
  team_label: { it: 'Team', en: 'Team', hu: 'Csapat', es: 'Equipo', de: 'Team', fr: 'Équipe', pt: 'Equipe' },
  team_detail: {
    it: 'Stato agenti AI + chat', en: 'AI agents status + chat', hu: 'AI-ügynökök állapota + chat',
    es: 'Estado de agentes IA + chat', de: 'KI-Agenten-Status + Chat', fr: 'État des agents IA + chat', pt: 'Status dos agentes de IA + chat',
  },
  profile_label: { it: 'Profilo', en: 'Profile', hu: 'Profil', es: 'Perfil', de: 'Profil', fr: 'Profil', pt: 'Perfil' },
  profile_detail: {
    it: 'Candidato e dati personali', en: 'Candidate and personal data', hu: 'Jelölt és személyes adatok',
    es: 'Candidato y datos personales', de: 'Kandidat und persönliche Daten', fr: 'Candidat et données personnelles', pt: 'Candidato e dados pessoais',
  },
  settings_label: { it: 'Impostazioni', en: 'Settings', hu: 'Beállítások', es: 'Ajustes', de: 'Einstellungen', fr: 'Paramètres', pt: 'Configurações' },
  settings_detail: {
    it: 'Provider AI, Telegram, cron', en: 'AI provider, Telegram, cron', hu: 'AI-szolgáltató, Telegram, cron',
    es: 'Proveedor de IA, Telegram, cron', de: 'KI-Anbieter, Telegram, Cron', fr: 'Fournisseur IA, Telegram, cron', pt: 'Provedor de IA, Telegram, cron',
  },
  providers_label: { it: 'Provider LLM', en: 'LLM Providers', hu: 'LLM-szolgáltatók', es: 'Proveedores LLM', de: 'LLM-Anbieter', fr: 'Fournisseurs LLM', pt: 'Provedores LLM' },
  providers_detail: {
    it: 'Claude / Kimi / Codex', en: 'Claude / Kimi / Codex', hu: 'Claude / Kimi / Codex',
    es: 'Claude / Kimi / Codex', de: 'Claude / Kimi / Codex', fr: 'Claude / Kimi / Codex', pt: 'Claude / Kimi / Codex',
  },
  credentials_label: { it: 'Credenziali', en: 'Credentials', hu: 'Hitelesítő adatok', es: 'Credenciales', de: 'Anmeldedaten', fr: 'Identifiants', pt: 'Credenciais' },
  credentials_detail: {
    it: 'API key e OAuth', en: 'API key and OAuth', hu: 'API-kulcs és OAuth',
    es: 'Clave API y OAuth', de: 'API-Schlüssel und OAuth', fr: 'Clé API et OAuth', pt: 'Chave de API e OAuth',
  },
  cron_label: { it: 'Cron Jobs', en: 'Cron Jobs', hu: 'Cron-feladatok', es: 'Tareas Cron', de: 'Cron-Jobs', fr: 'Tâches Cron', pt: 'Tarefas Cron' },
  cron_detail: {
    it: 'Task schedulati', en: 'Scheduled tasks', hu: 'Ütemezett feladatok',
    es: 'Tareas programadas', de: 'Geplante Aufgaben', fr: 'Tâches planifiées', pt: 'Tarefas agendadas',
  },
  cloud_sync_label: { it: 'Cloud sync', en: 'Cloud sync', hu: 'Felhő-szinkron', es: 'Sincronización en la nube', de: 'Cloud-Sync', fr: 'Synchro cloud', pt: 'Sincronização na nuvem' },
  cloud_sync_detail: {
    it: 'Sync dati locale → cloud', en: 'Sync local data → cloud', hu: 'Helyi adatok szinkronizálása → felhő',
    es: 'Sincronizar datos locales → nube', de: 'Lokale Daten synchronisieren → Cloud', fr: 'Synchroniser données locales → cloud', pt: 'Sincronizar dados locais → nuvem',
  },
  cli_link_label: { it: 'Collega CLI/VPS', en: 'Link CLI/VPS', hu: 'CLI/VPS összekapcsolása', es: 'Vincular CLI/VPS', de: 'CLI/VPS verbinden', fr: 'Lier CLI/VPS', pt: 'Vincular CLI/VPS' },
  cli_link_detail: {
    it: 'Pairing browser-based', en: 'Browser-based pairing', hu: 'Böngészőalapú párosítás',
    es: 'Emparejamiento desde el navegador', de: 'Browserbasiertes Pairing', fr: 'Appairage via le navigateur', pt: 'Emparelhamento via navegador',
  },
}

// --- Context per coordinamento con SearchBar ---
type PaletteCtx = { isOpen: boolean }
export const CommandPaletteContext = createContext<PaletteCtx>({ isOpen: false })
export const useCommandPalette = () => useContext(CommandPaletteContext)

// --- Comandi statici ---
// labelKey/detailKey → chiavi i18n; categoryKey identifica colore e gruppo
// (stabile, indipendente dalla lingua); categoryLabelKey → testo badge.
type Cmd = { id: string; label: string; detail: string; category: string; categoryLabel: string; href?: string; action?: () => void }
type StaticCmd = { id: string; labelKey: string; detailKey: string; category: 'pages' | 'config'; href?: string }

const STATIC_COMMANDS: StaticCmd[] = [
  { id: 'dashboard',    labelKey: 'dashboard_label',   detailKey: 'dashboard_detail',   category: 'pages',  href: '/dashboard' },
  { id: 'positions',    labelKey: 'positions_label',   detailKey: 'positions_detail',   category: 'pages',  href: '/positions' },
  { id: 'team',         labelKey: 'team_label',        detailKey: 'team_detail',        category: 'pages',  href: '/team' },
  { id: 'profile',      labelKey: 'profile_label',     detailKey: 'profile_detail',     category: 'pages',  href: '/profile' },
  { id: 'settings',     labelKey: 'settings_label',    detailKey: 'settings_detail',    category: 'config', href: '/settings' },
  { id: 'providers',    labelKey: 'providers_label',   detailKey: 'providers_detail',   category: 'config', href: '/providers' },
  { id: 'credentials',  labelKey: 'credentials_label', detailKey: 'credentials_detail', category: 'config', href: '/credentials' },
  { id: 'cron',         labelKey: 'cron_label',        detailKey: 'cron_detail',        category: 'config', href: '/cron' },
  { id: 'cloud-sync',   labelKey: 'cloud_sync_label',  detailKey: 'cloud_sync_detail',  category: 'config', href: '/settings/cloud-sync' },
  { id: 'cli-link',     labelKey: 'cli_link_label',    detailKey: 'cli_link_detail',    category: 'config', href: '/cli-link' },
]

const CATEGORY_COLORS: Record<string, string> = {
  pages: 'var(--color-blue)',
  actions: 'var(--color-green)',
  results: 'var(--color-cyan)',
}
const CATEGORY_LABEL_KEYS: Record<string, string> = {
  pages: 'cat_pages', config: 'cat_config', actions: 'cat_actions', results: 'cat_results',
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [extra, setExtra] = useState<Cmd[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const { registerEscape } = useShortcuts()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const locale = useLocale()
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k

  const staticCommands: Cmd[] = STATIC_COMMANDS.map(c => ({
    id: c.id,
    label: tr(c.labelKey),
    detail: tr(c.detailKey),
    category: c.category,
    categoryLabel: tr(CATEGORY_LABEL_KEYS[c.category] ?? c.category),
    href: c.href,
  }))

  const close = useCallback(() => { setOpen(false); setQuery(''); setExtra([]) }, [])

  useEffect(() => {
    if (!open) return
    const unreg = registerEscape(close)
    inputRef.current?.focus()
    return unreg
  }, [open, close, registerEscape])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setOpen(o => !o) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Ricerca dinamica via /api/search
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (query.length < 2) { setExtra([]); return }
    timerRef.current = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`).catch(() => null)
      if (!res?.ok) return
      const data = await res.json()
      setExtra((data.results ?? []).map((r: { id: string; title: string; detail: string; href: string }) => ({
        id: `search-${r.id}`, label: r.title, detail: r.detail, category: 'results', categoryLabel: tr('cat_results'), href: r.href,
      })))
    }, 180)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [query])

  const filtered = [
    ...(query ? staticCommands.filter(c =>
      c.label.toLowerCase().includes(query.toLowerCase()) ||
      c.detail.toLowerCase().includes(query.toLowerCase())
    ) : staticCommands),
    ...extra,
  ]

  const execute = useCallback((cmd: Cmd) => {
    close()
    if (cmd.action) cmd.action()
    else if (cmd.href) router.push(cmd.href)
  }, [close, router])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter' && filtered[selected]) { e.preventDefault(); execute(filtered[selected]) }
  }

  if (!open) return (
    <CommandPaletteContext.Provider value={{ isOpen: false }}>
      <></>
    </CommandPaletteContext.Provider>
  )

  return (
    <CommandPaletteContext.Provider value={{ isOpen: true }}>
      <div className="fixed inset-0 flex items-start justify-center pt-[10vh] px-4 z-[9990]"
        style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
        onClick={e => { if (e.target === e.currentTarget) close() }}>
        <div className="w-full max-w-xl rounded-xl overflow-hidden"
          style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)', boxShadow: '0 16px 48px rgba(0,0,0,0.6)', animation: 'fade-in 0.15s ease both' }}>
          <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
            <svg aria-hidden="true" className="w-4 h-4 shrink-0" fill="none" stroke="var(--color-dim)" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
            </svg>
            <input ref={inputRef} value={query} onChange={e => { setQuery(e.target.value); setSelected(0) }}
              onKeyDown={onKeyDown} placeholder={tr('placeholder')}
              aria-label={tr('aria_search')}
              className="flex-1 bg-transparent outline-none text-[13px]"
              style={{ color: 'var(--color-bright)' }} />
            <kbd className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-border)', color: 'var(--color-dim)' }}>esc</kbd>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: '55vh' }}>
            {filtered.length === 0 && (
              <p className="px-4 py-6 text-center text-[11px]" style={{ color: 'var(--color-dim)' }}>{tr('no_results')}</p>
            )}
            {filtered.map((cmd, i) => {
              const color = CATEGORY_COLORS[cmd.category] ?? 'var(--color-dim)'
              return (
                <button key={cmd.id} onClick={() => execute(cmd)} onMouseEnter={() => setSelected(i)}
                  className="flex items-center gap-3 w-full px-4 py-2.5 text-left cursor-pointer transition-colors"
                  style={{ background: selected === i ? 'var(--color-row)' : 'transparent' }}>
                  <span className="text-[8px] px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold shrink-0 w-16 text-center"
                    style={{ background: `${color}22`, color }}>{cmd.categoryLabel}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold truncate" style={{ color: 'var(--color-bright)' }}>{cmd.label}</p>
                    <p className="text-[10px] truncate" style={{ color: 'var(--color-dim)' }}>{cmd.detail}</p>
                  </div>
                  {cmd.href && <span className="text-[10px] shrink-0" style={{ color: 'var(--color-dim)' }}>↵</span>}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </CommandPaletteContext.Provider>
  )
}
