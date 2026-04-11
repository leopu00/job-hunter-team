import { randomBytes, createHash } from 'node:crypto'

const TOKEN_PREFIX = 'jht_sync_'
const TOKEN_RANDOM_BYTES = 24

export interface GeneratedSyncToken {
  token: string
  prefix: string
  hash: string
}

export function generateSyncToken(): GeneratedSyncToken {
  const random = randomBytes(TOKEN_RANDOM_BYTES).toString('base64url')
  const token = `${TOKEN_PREFIX}${random}`
  const prefix = token.slice(0, TOKEN_PREFIX.length + 4)
  return { token, prefix, hash: hashSyncToken(token) }
}

export function hashSyncToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
