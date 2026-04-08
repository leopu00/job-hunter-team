export type AssistantChatMessage = {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export type AssistantSuggestion = {
  label: string
  prompt: string
}

export const AI_ASSISTANT_STORAGE_KEY = 'jht.ai-assistant.history'

export const AI_ASSISTANT_SUGGESTIONS: AssistantSuggestion[] = [
  { label: 'Da dove inizio?', prompt: 'Sono nuovo qui: da dove mi consigli di iniziare sulla piattaforma?' },
  { label: 'Configura provider AI', prompt: 'Come configuro il provider AI e la relativa API key?' },
  { label: 'Completa il profilo', prompt: 'Come completo il mio profilo per usare bene Job Hunter Team?' },
  { label: 'Capire le sezioni', prompt: 'Mi spieghi in modo semplice a cosa servono dashboard, jobs, applications e agents?' },
]

const MAX_LOCAL_HISTORY = 24

function isAssistantMessage(value: unknown): value is AssistantChatMessage {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<AssistantChatMessage>
  return (candidate.role === 'user' || candidate.role === 'assistant')
    && typeof candidate.content === 'string'
    && typeof candidate.timestamp === 'number'
}

export function normalizeAssistantHistory(value: unknown): AssistantChatMessage[] {
  if (!Array.isArray(value)) return []
  return value.filter(isAssistantMessage).map(msg => ({
    role: msg.role,
    content: msg.content.trim(),
    timestamp: msg.timestamp,
  })).filter(msg => msg.content.length > 0)
}

export function trimAssistantHistory(history: AssistantChatMessage[], max = MAX_LOCAL_HISTORY): AssistantChatMessage[] {
  return normalizeAssistantHistory(history).slice(-max)
}

export function loadStoredAssistantHistory(): AssistantChatMessage[] {
  if (typeof window === 'undefined') return []
  try {
    return trimAssistantHistory(JSON.parse(window.localStorage.getItem(AI_ASSISTANT_STORAGE_KEY) ?? '[]'))
  } catch {
    return []
  }
}

export function saveStoredAssistantHistory(history: AssistantChatMessage[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(AI_ASSISTANT_STORAGE_KEY, JSON.stringify(trimAssistantHistory(history)))
  } catch {
    // Ignore storage errors: the assistant should still work for the current tab.
  }
}

function describeCurrentPage(pathname?: string): string {
  if (!pathname || pathname === '/') return "L'utente si trova nella landing page pubblica."

  const sections: Array<[string, string]> = [
    ['/setup', 'Configurazione iniziale dei provider AI e delle API key.'],
    ['/guide', 'Guida rapida al funzionamento della piattaforma.'],
    ['/docs', 'Documentazione generale.'],
    ['/dashboard', 'Vista riepilogativa del lavoro in corso.'],
    ['/overview', 'Panoramica sintetica delle sezioni principali.'],
    ['/profile', 'Profilo candidato e dati personali/professionali.'],
    ['/jobs', 'Elenco offerte di lavoro.'],
    ['/applications', 'Tracciamento candidature inviate.'],
    ['/agents', 'Vista degli agenti AI disponibili.'],
    ['/credentials', 'Gestione credenziali e provider.'],
    ['/secrets', 'Secrets e token salvati localmente.'],
    ['/assistant', 'Assistente operativo interno della piattaforma.'],
    ['/ai-assistant', 'Pagina dedicata alla chat di onboarding.'],
  ]

  for (const [prefix, description] of sections) {
    if (pathname.startsWith(prefix)) return `L'utente si trova su ${pathname}. ${description}`
  }

  return `L'utente si trova su ${pathname}. Se la pagina non e nel contesto noto, dichiaralo e guida verso una sezione rilevante.`
}

export function buildAssistantSystemPrompt(pathname?: string): string {
  return [
    'Sei il chatbot di onboarding di Job Hunter Team.',
    'Aiuti utenti nuovi a capire cosa fa la piattaforma, come orientarsi e quale prossimo passo eseguire.',
    "Rispondi nella lingua dell'utente; se non e chiara, usa italiano.",
    "Mantieni le risposte brevi, pratiche e orientate all'azione.",
    'Quando utile, cita percorsi reali della web app come /setup, /guide, /docs, /dashboard, /profile, /jobs, /applications, /agents, /credentials e /secrets.',
    'Non inventare feature, prezzi, integrazioni o stati che non conosci.',
    "Se l'utente chiede qualcosa fuori contesto, chiarisci il limite e reindirizza alla sezione piu adatta della piattaforma.",
    'Contesto prodotto:',
    '- Job Hunter Team e una piattaforma con agenti AI per supportare job search, setup del profilo, monitoraggio candidature e automazioni.',
    '- /setup serve a configurare provider AI e chiavi API.',
    '- /profile contiene il profilo candidato.',
    '- /jobs e /applications coprono offerte e candidature.',
    '- /guide e /docs sono i riferimenti principali per capire il prodotto.',
    describeCurrentPage(pathname),
  ].join('\n')
}
