import { NextResponse } from 'next/server'

// Manifest statico degli schema Zod registrati in shared/validators/
const VALIDATORS = [
  {
    module: 'common',
    schemas: [
      { name: 'nonEmptyString',    type: 'string',  fields: [],                          description: 'Stringa non vuota dopo trim' },
      { name: 'emailSchema',       type: 'string',  fields: [],                          description: 'Email valida' },
      { name: 'urlSchema',         type: 'string',  fields: [],                          description: 'URL valido' },
      { name: 'timestampMs',       type: 'number',  fields: [],                          description: 'Timestamp in millisecondi (intero positivo)' },
      { name: 'uuid',              type: 'string',  fields: [],                          description: 'UUID v4' },
    ],
  },
  {
    module: 'credentials',
    schemas: [
      { name: 'ApiKeyCredentialSchema',  type: 'object', fields: ['provider', 'api_key', 'created_at'],                   description: 'Credenziale API key' },
      { name: 'OAuthCredentialSchema',   type: 'object', fields: ['provider', 'access_token', 'refresh_token', 'expiry'], description: 'Credenziale OAuth' },
      { name: 'EncryptedPayloadSchema',  type: 'object', fields: ['iv', 'ciphertext', 'tag'],                             description: 'Payload cifrato AES-GCM' },
      { name: 'SaveApiKeyInput',         type: 'object', fields: ['provider', 'api_key'],                                 description: 'Input salvataggio API key' },
      { name: 'ResolveCredentialInput',  type: 'object', fields: ['provider', 'source'],                                  description: 'Input risoluzione credenziale' },
    ],
  },
  {
    module: 'tasks',
    schemas: [
      { name: 'TaskRuntimeSchema',        type: 'enum',   fields: ['subagent', 'cli', 'cron'],                                          description: 'Runtime di esecuzione task' },
      { name: 'TaskStatusSchema',         type: 'enum',   fields: ['queued', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled', 'lost'], description: 'Stato task' },
      { name: 'TaskRecordSchema',         type: 'object', fields: ['id', 'runtime', 'status', 'created_at', 'updated_at', 'scope'],     description: 'Record task completo' },
      { name: 'CreateTaskInput',          type: 'object', fields: ['runtime', 'scope', 'notify_policy'],                                description: 'Input creazione task' },
      { name: 'UpdateTaskInput',          type: 'object', fields: ['status', 'result', 'error'],                                        description: 'Input aggiornamento task' },
      { name: 'TaskRegistrySummarySchema',type: 'object', fields: ['total', 'by_status', 'by_runtime'],                                 description: 'Sommario registro task' },
    ],
  },
  {
    module: 'config',
    schemas: [
      { name: 'AIProviderSchema',      type: 'object', fields: ['name', 'auth_method', 'api_key'],                      description: 'Configurazione provider AI' },
      { name: 'TelegramChannelSchema', type: 'object', fields: ['bot_token', 'chat_id'],                                description: 'Canale Telegram' },
      { name: 'JHTConfigSchema',       type: 'object', fields: ['version', 'active_provider', 'providers', 'channels'], description: 'Schema configurazione JHT completa' },
    ],
  },
]

export async function GET() {
  const total = VALIDATORS.reduce((n, m) => n + m.schemas.length, 0)
  return NextResponse.json({ validators: VALIDATORS, total, modules: VALIDATORS.length })
}
