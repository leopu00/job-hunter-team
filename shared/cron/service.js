/**
 * JHT Cron — CronService: CRUD job + timer scheduling loop
 */
import { loadCronStore, saveCronStore, resolveCronStorePath } from './store.js';
import { createJob, applyJobPatch, isJobDue, recomputeNextRuns, nextWakeAtMs } from './jobs.js';

export class CronService {
  #storePath;
  #store = null;
  #timer = null;
  #running = false;
  #onEvent;
  #onExecute;

  /**
   * @param {Object} deps
   * @param {string} [deps.storePath] — path custom per jobs.json
   * @param {function(import('./types.js').CronEvent): void} [deps.onEvent]
   * @param {function(import('./types.js').CronJob): Promise<{status: string, error?: string}>} deps.onExecute
   */
  constructor(deps) {
    this.#storePath = resolveCronStorePath(deps.storePath);
    this.#onEvent = deps.onEvent;
    this.#onExecute = deps.onExecute;
  }

  async #ensureLoaded() {
    if (!this.#store) {
      this.#store = await loadCronStore(this.#storePath);
    }
  }

  async #persist() {
    if (this.#store) await saveCronStore(this.#storePath, this.#store);
  }

  #emit(event) {
    if (this.#onEvent) this.#onEvent(event);
  }

  #armTimer() {
    if (this.#timer) { clearTimeout(this.#timer); this.#timer = null; }
    if (!this.#store) return;
    const wake = nextWakeAtMs(this.#store.jobs);
    if (wake === null) return;
    const delay = Math.max(100, wake - Date.now());
    this.#timer = setTimeout(() => this.#tick(), delay);
    if (this.#timer.unref) this.#timer.unref();
  }

  async #tick() {
    if (this.#running) return;
    this.#running = true;
    try {
      await this.#ensureLoaded();
      const now = Date.now();
      const dueJobs = this.#store.jobs.filter((j) => isJobDue(j, now));

      for (const job of dueJobs) {
        job.state.runningAtMs = now;
        this.#emit({ jobId: job.id, action: 'started', runAtMs: now });

        let result;
        try {
          result = await this.#onExecute(job);
        } catch (err) {
          result = { status: 'error', error: err.message || String(err) };
        }

        const endMs = Date.now();
        job.state.runningAtMs = undefined;
        job.state.lastRunAtMs = now;
        job.state.lastRunStatus = result.status;
        job.state.lastDurationMs = endMs - now;
        job.state.lastError = result.error;

        if (result.status === 'ok') {
          job.state.consecutiveErrors = 0;
        } else {
          job.state.consecutiveErrors = (job.state.consecutiveErrors || 0) + 1;
        }

        // One-shot: elimina dopo esecuzione
        if (job.deleteAfterRun) {
          this.#store.jobs = this.#store.jobs.filter((j) => j.id !== job.id);
          this.#emit({ jobId: job.id, action: 'removed' });
        }

        this.#emit({
          jobId: job.id, action: 'finished', status: result.status,
          error: result.error, durationMs: job.state.lastDurationMs,
        });
      }

      recomputeNextRuns(this.#store.jobs);
      await this.#persist();
    } finally {
      this.#running = false;
      this.#armTimer();
    }
  }

  async start() {
    await this.#ensureLoaded();
    recomputeNextRuns(this.#store.jobs);
    await this.#persist();
    this.#armTimer();
  }

  stop() {
    if (this.#timer) { clearTimeout(this.#timer); this.#timer = null; }
  }

  async status() {
    await this.#ensureLoaded();
    return {
      storePath: this.#storePath,
      jobs: this.#store.jobs.length,
      nextWakeAtMs: nextWakeAtMs(this.#store.jobs),
    };
  }

  async list({ includeDisabled = false } = {}) {
    await this.#ensureLoaded();
    const jobs = includeDisabled
      ? this.#store.jobs
      : this.#store.jobs.filter((j) => j.enabled);
    return jobs.toSorted((a, b) => (a.state.nextRunAtMs ?? 0) - (b.state.nextRunAtMs ?? 0));
  }

  async add(input) {
    await this.#ensureLoaded();
    const job = createJob(input);
    this.#store.jobs.push(job);
    await this.#persist();
    this.#armTimer();
    this.#emit({ jobId: job.id, action: 'added', nextRunAtMs: job.state.nextRunAtMs });
    return job;
  }

  async update(id, patch) {
    await this.#ensureLoaded();
    const job = this.#store.jobs.find((j) => j.id === id);
    if (!job) throw new Error(`Job non trovato: ${id}`);
    applyJobPatch(job, patch);
    await this.#persist();
    this.#armTimer();
    this.#emit({ jobId: id, action: 'updated', nextRunAtMs: job.state.nextRunAtMs });
    return job;
  }

  async remove(id) {
    await this.#ensureLoaded();
    const before = this.#store.jobs.length;
    this.#store.jobs = this.#store.jobs.filter((j) => j.id !== id);
    const removed = this.#store.jobs.length !== before;
    if (removed) {
      await this.#persist();
      this.#armTimer();
      this.#emit({ jobId: id, action: 'removed' });
    }
    return { removed };
  }

  async run(id, mode = 'due') {
    await this.#ensureLoaded();
    const job = this.#store.jobs.find((j) => j.id === id);
    if (!job) throw new Error(`Job non trovato: ${id}`);
    if (!isJobDue(job, Date.now(), { forced: mode === 'force' })) {
      return { ran: false, reason: mode === 'force' ? 'already-running' : 'not-due' };
    }
    // Esegui inline nel prossimo tick
    await this.#tick();
    return { ran: true };
  }
}
