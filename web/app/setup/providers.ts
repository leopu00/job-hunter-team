export type ProviderName = 'claude' | 'openai' | 'minimax'
export type AuthMethod = 'api_key' | 'subscription'

export interface ModelOption {
  value: string
  label: string
  hint: string
}

export interface ProviderDef {
  value: ProviderName
  label: string
  hint: string
  keyPrefix: string
  keyPlaceholder: string
  authMethods: AuthMethod[]
  models: ModelOption[]
}

export const PROVIDERS: ProviderDef[] = [
  {
    value: 'claude',
    label: 'Anthropic — Claude',
    hint: 'consigliato',
    keyPrefix: 'sk-ant-',
    keyPlaceholder: 'sk-ant-api03-...',
    authMethods: ['api_key'],
    models: [
      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', hint: 'veloce e capace — consigliato' },
      { value: 'claude-opus-4-6',   label: 'Claude Opus 4.6',   hint: 'massima qualità' },
      { value: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5',  hint: 'economico e veloce' },
    ],
  },
  {
    value: 'openai',
    label: 'OpenAI — GPT',
    hint: 'GPT-4o, o3, o4-mini',
    keyPrefix: 'sk-',
    keyPlaceholder: 'sk-proj-...',
    authMethods: ['api_key'],
    models: [
      { value: 'gpt-4o',   label: 'GPT-4o',   hint: 'veloce e capace — consigliato' },
      { value: 'o3',       label: 'o3',        hint: 'ragionamento avanzato' },
      { value: 'o4-mini',  label: 'o4-mini',   hint: 'economico' },
    ],
  },
  {
    value: 'minimax',
    label: 'MiniMax',
    hint: 'alternativa economica',
    keyPrefix: '',
    keyPlaceholder: 'eyJ...',
    authMethods: ['api_key', 'subscription'],
    models: [
      { value: 'minimax-01', label: 'MiniMax-01',  hint: 'modello principale' },
      { value: 'abab6.5s',   label: 'ABAB 6.5s',   hint: 'economico' },
    ],
  },
]

export function validateApiKey(provider: ProviderDef, value: string): string | undefined {
  const v = value.trim()
  if (!v) return 'La API key non può essere vuota'
  if (v.length < 10) return 'La API key sembra troppo corta'
  if (provider.keyPrefix && !v.startsWith(provider.keyPrefix))
    return `La key per ${provider.label} dovrebbe iniziare con "${provider.keyPrefix}"`
  return undefined
}

export function validateEmail(value: string): string | undefined {
  const v = value.trim()
  if (!v) return "L'email non può essere vuota"
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Email non valida'
  return undefined
}

export function validateTelegramToken(value: string): string | undefined {
  const v = value.trim()
  if (!v) return 'Il token non può essere vuoto'
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(v)) return 'Formato non valido (es. 123456:ABCdef...)'
  return undefined
}

export function validateChatId(value: string): string | undefined {
  if (value.trim() && !/^-?\d+$/.test(value.trim())) return 'Il chat ID deve essere un numero'
  return undefined
}
