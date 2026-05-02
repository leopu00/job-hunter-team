import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getJhtHome } from './local'

export interface SyncSummary {
  positions: { upserted: number; payload: number }
  scores: { upserted: number; payload: number }
  applications: { upserted: number; payload: number }
}

export interface SyncState {
  last_synced_at: string // ISO 8601
  last_user_id: string
  last_sync_summary: SyncSummary
}

function getStatePath(): string {
  return join(getJhtHome(), 'cloud-sync-state.json')
}

export async function readSyncState(): Promise<SyncState | null> {
  try {
    const raw = await readFile(getStatePath(), 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const s = parsed as Partial<SyncState>
    if (typeof s.last_synced_at !== 'string' || typeof s.last_user_id !== 'string') return null
    return s as SyncState
  } catch {
    // ENOENT (mai sync) o JSON corrotto: trattati uguali, no state.
    return null
  }
}

export async function writeSyncState(state: SyncState): Promise<void> {
  await writeFile(getStatePath(), JSON.stringify(state, null, 2), 'utf-8')
}
