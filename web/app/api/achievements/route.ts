import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

type Category = 'applications' | 'networking' | 'skills' | 'streak' | 'profile'

interface Achievement {
  id: string
  title: string
  description: string
  icon: string
  category: Category
  current: number
  target: number
  unlocked: boolean
  unlockedAt?: number
}

const CAT_LABEL: Record<Category, string> = {
  applications: 'Candidature', networking: 'Networking', skills: 'Competenze', streak: 'Costanza', profile: 'Profilo',
}

function buildAchievements(): Achievement[] {
  const now = Date.now(), DAY = 86_400_000
  return [
    { id: 'a1', title: 'Prima Candidatura', description: 'Invia la tua prima candidatura', icon: '🚀', category: 'applications', current: 1, target: 1, unlocked: true, unlockedAt: now - 20 * DAY },
    { id: 'a2', title: 'Candidato Attivo', description: 'Invia 10 candidature', icon: '📨', category: 'applications', current: 10, target: 10, unlocked: true, unlockedAt: now - 12 * DAY },
    { id: 'a3', title: 'Maratoneta', description: 'Invia 50 candidature', icon: '🏃', category: 'applications', current: 23, target: 50, unlocked: false },
    { id: 'a4', title: 'Instancabile', description: 'Invia 100 candidature', icon: '💯', category: 'applications', current: 23, target: 100, unlocked: false },
    { id: 'a5', title: 'Primo Contatto', description: 'Aggiungi il tuo primo contatto', icon: '🤝', category: 'networking', current: 1, target: 1, unlocked: true, unlockedAt: now - 18 * DAY },
    { id: 'a6', title: 'Networker', description: 'Aggiungi 5 contatti', icon: '🌐', category: 'networking', current: 5, target: 5, unlocked: true, unlockedAt: now - 8 * DAY },
    { id: 'a7', title: 'Connettore', description: 'Aggiungi 20 contatti', icon: '🔗', category: 'networking', current: 9, target: 20, unlocked: false },
    { id: 'a8', title: 'Skillato', description: 'Aggiungi 5 competenze', icon: '⚡', category: 'skills', current: 5, target: 5, unlocked: true, unlockedAt: now - 10 * DAY },
    { id: 'a9', title: 'Tuttofare', description: 'Aggiungi 10 competenze', icon: '🎯', category: 'skills', current: 8, target: 10, unlocked: false },
    { id: 'a10', title: 'Esperto', description: 'Raggiungi livello "expert" in una competenza', icon: '👑', category: 'skills', current: 1, target: 1, unlocked: true, unlockedAt: now - 5 * DAY },
    { id: 'a11', title: 'Costante', description: 'Usa la piattaforma per 3 giorni consecutivi', icon: '🔥', category: 'streak', current: 3, target: 3, unlocked: true, unlockedAt: now - 7 * DAY },
    { id: 'a12', title: 'Settimana Perfetta', description: '7 giorni consecutivi di attività', icon: '📅', category: 'streak', current: 5, target: 7, unlocked: false },
    { id: 'a13', title: 'Mese d\'Oro', description: '30 giorni consecutivi di attività', icon: '🏆', category: 'streak', current: 5, target: 30, unlocked: false },
    { id: 'a14', title: 'Profilo Completo', description: 'Compila tutti i campi del profilo', icon: '✅', category: 'profile', current: 6, target: 8, unlocked: false },
    { id: 'a15', title: 'CV Caricato', description: 'Carica il tuo primo CV', icon: '📄', category: 'profile', current: 1, target: 1, unlocked: true, unlockedAt: now - 15 * DAY },
  ]
}

/** GET — lista achievements: ?category=applications */
export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get('category') as Category | null
  let items = buildAchievements()
  if (category) items = items.filter(a => a.category === category)

  const unlocked = items.filter(a => a.unlocked).length
  const total = items.length
  const byCategory: Record<string, { total: number; unlocked: number; label: string }> = {}
  for (const a of buildAchievements()) {
    if (!byCategory[a.category]) byCategory[a.category] = { total: 0, unlocked: 0, label: CAT_LABEL[a.category] }
    byCategory[a.category].total++
    if (a.unlocked) byCategory[a.category].unlocked++
  }

  return NextResponse.json({ achievements: items, unlocked, total, byCategory, categories: Object.keys(CAT_LABEL) })
}
