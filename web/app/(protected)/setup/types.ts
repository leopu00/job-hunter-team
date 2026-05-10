import type { ProviderDef } from './providers'

export interface FormState {
  provider:    ProviderDef | null
  authMethod:  'api_key' | 'subscription'
  apiKey:      string
  email:       string
  model:       string
  useTelegram: boolean
  botToken:    string
  chatId:      string
}

export const INITIAL_FORM: FormState = {
  provider: null, authMethod: 'api_key', apiKey: '', email: '',
  model: '', useTelegram: false, botToken: '', chatId: '',
}
