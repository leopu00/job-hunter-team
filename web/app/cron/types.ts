export type ScheduleKind = 'cron' | 'every' | 'at'

export interface ScheduleCron  { kind: 'cron';  expr: string; tz?: string }
export interface ScheduleEvery { kind: 'every'; everyMs: number; anchorMs?: number }
export interface ScheduleAt    { kind: 'at';    at: string }
export type CronSchedule = ScheduleCron | ScheduleEvery | ScheduleAt

export interface CronPayload { kind: 'command'; command: string; timeoutSeconds?: number }

export interface CronJobState {
  nextRunAtMs?:      number
  lastRunAtMs?:      number
  lastRunStatus?:    'ok' | 'error' | 'skipped'
  lastError?:        string
  lastDurationMs?:   number
  consecutiveErrors?: number
}

export interface CronJob {
  id:            string
  name:          string
  description?:  string
  enabled:       boolean
  deleteAfterRun?: boolean
  createdAtMs:   number
  updatedAtMs:   number
  schedule:      CronSchedule
  payload:       CronPayload
  state:         CronJobState
}

/** Ritornato dall'API GET /api/cron */
export interface CronListResponse { jobs: CronJob[] }

/** Input per la creazione di un nuovo job */
export interface CronJobCreateInput {
  name:          string
  description?:  string
  enabled:       boolean
  schedule:      CronSchedule
  payload:       CronPayload
  deleteAfterRun?: boolean
}

/** Formato leggibile della schedule per la UI */
export function scheduleLabel(s: CronSchedule): string {
  if (s.kind === 'cron')  return `cron: ${s.expr}`
  if (s.kind === 'every') return `ogni ${Math.round(s.everyMs / 60_000)} min`
  if (s.kind === 'at')    return `una volta: ${s.at}`
  return '?'
}

/** Formato leggibile della prossima esecuzione */
export function nextRunLabel(ms: number | undefined): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const now = Date.now()
  const diff = ms - now
  if (diff < 0) return 'in esecuzione'
  if (diff < 60_000) return `tra ${Math.round(diff / 1000)}s`
  if (diff < 3_600_000) return `tra ${Math.round(diff / 60_000)} min`
  return d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
