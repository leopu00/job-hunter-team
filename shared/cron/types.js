/**
 * JHT Cron — Tipi per job, schedule, store
 */

/**
 * @typedef {'cron' | 'every' | 'at'} ScheduleKind
 */

/**
 * Schedule con espressione cron (es. "0 9 * * 1-5" = ogni mattina lun-ven).
 * @typedef {Object} CronScheduleCron
 * @property {'cron'} kind
 * @property {string} expr — espressione cron (5 o 6 campi)
 * @property {string} [tz] — timezone IANA (default: locale)
 */

/**
 * Schedule a intervallo fisso (es. ogni 30 minuti).
 * @typedef {Object} CronScheduleEvery
 * @property {'every'} kind
 * @property {number} everyMs — intervallo in millisecondi
 * @property {number} [anchorMs] — timestamp di riferimento (default: now)
 */

/**
 * Schedule one-shot a un timestamp specifico.
 * @typedef {Object} CronScheduleAt
 * @property {'at'} kind
 * @property {string} at — ISO 8601 timestamp o "YYYY-MM-DD HH:mm"
 */

/**
 * @typedef {CronScheduleCron | CronScheduleEvery | CronScheduleAt} CronSchedule
 */

/**
 * Stato runtime di un job.
 * @typedef {Object} CronJobState
 * @property {number} [nextRunAtMs]
 * @property {number} [runningAtMs]
 * @property {number} [lastRunAtMs]
 * @property {'ok' | 'error' | 'skipped'} [lastRunStatus]
 * @property {string} [lastError]
 * @property {number} [lastDurationMs]
 * @property {number} [consecutiveErrors]
 */

/**
 * Payload del job: cosa eseguire.
 * @typedef {Object} CronPayload
 * @property {'command'} kind — tipo di esecuzione
 * @property {string} command — comando o task da eseguire
 * @property {number} [timeoutSeconds] — timeout esecuzione
 */

/**
 * Definizione di un cron job.
 * @typedef {Object} CronJob
 * @property {string} id
 * @property {string} name
 * @property {string} [description]
 * @property {boolean} enabled
 * @property {boolean} [deleteAfterRun] — elimina dopo prima esecuzione (per "at")
 * @property {number} createdAtMs
 * @property {number} updatedAtMs
 * @property {CronSchedule} schedule
 * @property {CronPayload} payload
 * @property {CronJobState} state
 */

/**
 * Input per creare un nuovo job (senza id, timestamp, state).
 * @typedef {Omit<CronJob, 'id' | 'createdAtMs' | 'updatedAtMs' | 'state'>} CronJobCreate
 */

/**
 * Patch parziale per aggiornare un job.
 * @typedef {Partial<Omit<CronJob, 'id' | 'createdAtMs' | 'state'>>} CronJobPatch
 */

/**
 * File store con versione e lista job.
 * @typedef {Object} CronStoreFile
 * @property {1} version
 * @property {CronJob[]} jobs
 */

/**
 * Evento emesso dal cron service.
 * @typedef {Object} CronEvent
 * @property {string} jobId
 * @property {'added' | 'updated' | 'removed' | 'started' | 'finished'} action
 * @property {number} [runAtMs]
 * @property {number} [durationMs]
 * @property {'ok' | 'error' | 'skipped'} [status]
 * @property {string} [error]
 * @property {number} [nextRunAtMs]
 */

export {};
