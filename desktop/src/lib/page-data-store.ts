/** Successful data survives navigation; failures remain a separate, visible state. */
import type { PageDataPersistence } from "./page-data-persistence";
export type PageDataTopic = "profile" | "agents" | "positions";
export type PageDataFailure = { code: string };
export type PageDataSnapshot<T> = {
  data: T | undefined;
  at: number | null;
  error: PageDataFailure | null;
  errorAt: number | null;
  diskError: PageDataFailure | null;
  diskErrorAt: number | null;
  fromDisk: boolean;
  refreshing: boolean;
  stale: boolean;
};
type Entry = {
  topic: PageDataTopic;
  value: PageDataSnapshot<unknown>;
  generation: number;
  dirty: boolean;
  listeners: Set<() => void>;
  load?: () => Promise<unknown>;
  running?: Promise<void>;
  hydration?: Promise<void>;
  hydrationGeneration?: number;
};
const EMPTY: PageDataSnapshot<never> = { data: undefined, at: null, error: null, errorAt: null,
  diskError: null, diskErrorAt: null, fromDisk: false, refreshing: false, stale: true };

function failure(error: unknown): PageDataFailure {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  return { code: typeof code === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(code) ? code : "existing_team_unavailable" };
}

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)]));
  return value;
}

export class PageDataStore {
  private entries = new Map<string, Entry>();
  private context = 0;
  private blocked = 0;
  private contextListeners = new Set<() => void>();
  private topics = new Map<PageDataTopic, { revision: number; listeners: Set<() => void> }>();
  constructor(private report: (error: PageDataFailure) => void = () => undefined, private clock = () => Date.now(),
    private persistence?: PageDataPersistence) {}

  key(topic: PageDataTopic, operation: string, params: unknown = {}): string {
    return JSON.stringify([this.context, topic, operation, ordered(params)]);
  }

  private entry(key: string, topic: PageDataTopic): Entry {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { topic, value: EMPTY, generation: 0, dirty: true, listeners: new Set() };
      if (!key.startsWith(`[${this.context},`)) return entry;
      this.entries.set(key, entry);
      this.trim(key);
    }
    return entry;
  }

  private trim(keep: string): void {
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= 256) break;
      if (key !== keep && entry.listeners.size === 0 && !entry.running) this.entries.delete(key);
    }
  }

  snapshot<T>(key: string, topic: PageDataTopic): PageDataSnapshot<T> {
    return this.entry(key, topic).value as PageDataSnapshot<T>;
  }

  subscribe(key: string, topic: PageDataTopic, listener: () => void): () => void {
    const entry = this.entry(key, topic);
    entry.listeners.add(listener);
    return () => { entry.listeners.delete(listener); };
  }

  private topic(topic: PageDataTopic) {
    let state = this.topics.get(topic);
    if (!state) { state = { revision: 0, listeners: new Set() }; this.topics.set(topic, state); }
    return state;
  }

  revision = (topic: PageDataTopic): number => this.topic(topic).revision;
  subscribeTopic(topic: PageDataTopic, listener: () => void): () => void {
    const state = this.topic(topic);
    state.listeners.add(listener);
    return () => { state.listeners.delete(listener); };
  }

  private emit(entry: Entry): void {
    entry.listeners.forEach((listener) => listener());
    const state = this.topic(entry.topic);
    state.revision++;
    state.listeners.forEach((listener) => listener());
  }

  private commit(key: string, entry: Entry, generation: number, value: Partial<PageDataSnapshot<unknown>>): void {
    if (this.entries.get(key) !== entry || entry.generation !== generation) return;
    entry.value = { ...entry.value, ...value };
    this.emit(entry);
  }

  private diskFailure(key: string, entry: Entry, generation: number, reason: unknown): void {
    if (this.entries.get(key) !== entry || entry.generation !== generation) return;
    const error = failure(reason);
    try { this.report(error); }
    catch { console.error("runtime_log_failed: the data error could not be recorded"); }
    this.commit(key, entry, generation, { diskError: error, diskErrorAt: this.clock() });
  }

  private hydrate(key: string, entry: Entry, generation: number): void {
    if (!this.persistence || entry.hydrationGeneration === generation || entry.value.data !== undefined) return;
    entry.hydrationGeneration = generation;
    const hydration = this.persistence.read(key).then((copy) => {
      if (copy && entry.value.data === undefined) this.commit(key, entry, generation,
        { data: copy.data, at: copy.at, fromDisk: true });
    }).catch((reason) => this.diskFailure(key, entry, generation, reason)).finally(() => {
      if (entry.hydration === hydration) entry.hydration = undefined;
    });
    entry.hydration = hydration;
  }

  private save(key: string, entry: Entry, generation: number): void {
    if (!this.persistence || entry.value.data === undefined || entry.value.at === null) return;
    const current = () => this.entries.get(key) === entry && entry.generation === generation;
    void this.persistence.write(key, { data: entry.value.data, at: entry.value.at }, current).then((written) => {
      if (written && entry.value.diskError !== null) this.commit(key, entry, generation, { diskError: null, diskErrorAt: null });
    }).catch((reason) => this.diskFailure(key, entry, generation, reason));
  }

  revalidate<T>(key: string, topic: PageDataTopic, load: () => Promise<T>): Promise<void> {
    if (!key.startsWith(`[${this.context},`)) return Promise.resolve();
    const entry = this.entry(key, topic);
    entry.load = load;
    if (this.blocked) {
      entry.value = { ...EMPTY, error: { code: "account_scope_changed" }, errorAt: this.clock() };
      this.emit(entry);
      return Promise.resolve();
    }
    if (entry.running) return entry.running;
    entry.dirty = false;
    const generation = entry.generation;
    this.hydrate(key, entry, generation);
    entry.value = { ...entry.value, refreshing: true, stale: true };
    const work = Promise.resolve().then(() => {
      if (this.entries.get(key) !== entry || entry.generation !== generation) throw { code: "account_scope_changed" };
      return load();
    }).then((data) => {
      if (data === undefined) throw { code: "desktop_bad_reply" };
      this.commit(key, entry, generation, { data, at: this.clock(), error: null, errorAt: null, fromDisk: false, stale: false });
      if (this.entries.get(key) === entry && entry.generation === generation) this.save(key, entry, generation);
    }).catch((error: unknown) => {
      if (this.entries.get(key) !== entry || entry.generation !== generation) return;
      const reason = failure(error);
      try { this.report(reason); }
      catch { console.error("runtime_log_failed: the data error could not be recorded"); }
      this.commit(key, entry, generation, { error: reason, errorAt: this.clock(), stale: true });
    }).finally(() => {
      if (entry.running !== work) return;
      entry.running = undefined;
      if (this.entries.get(key) !== entry) return;
      entry.value = { ...entry.value, refreshing: false };
      this.emit(entry);
    });
    entry.running = work;
    this.emit(entry);
    return work;
  }

  async read<T>(key: string, topic: PageDataTopic, load: () => Promise<T>, current = () => true): Promise<T> {
    if (!current()) throw { code: "account_scope_changed" };
    const entry = this.entry(key, topic);
    entry.load = load;
    if (entry.value.data !== undefined) {
      if (entry.value.stale && entry.dirty) void this.revalidate(key, topic, load);
      return entry.value.data as T;
    }
    if (entry.value.error && !entry.dirty) throw entry.value.error;
    do {
      const work = this.revalidate(key, topic, load);
      if (entry.hydration) await Promise.race([work, entry.hydration]);
      if (!current()) throw { code: "account_scope_changed" };
      if (entry.value.data !== undefined) break;
      await work;
      if (!current()) throw { code: "account_scope_changed" };
    }
    while (this.entries.get(key) === entry && (entry.running ||
      (entry.value.data === undefined && entry.value.error === null && entry.value.stale)));
    if (this.entries.get(key) !== entry) throw { code: "account_scope_changed" };
    if (entry.value.data === undefined) throw entry.value.error ?? { code: "existing_team_unavailable" };
    return entry.value.data as T;
  }

  invalidate(topic?: PageDataTopic): void {
    for (const [key, entry] of this.entries) {
      if (topic && entry.topic !== topic) continue;
      entry.generation++;
      entry.dirty = true;
      entry.running = undefined;
      entry.value = { ...entry.value, stale: true };
      this.emit(entry);
      if (entry.load && entry.listeners.size) {
        void this.revalidate(key, entry.topic, entry.load);
      }
    }
  }

  reset = (): void => {
    this.entries.clear();
    this.context++;
    queueMicrotask(() => {
      this.contextListeners.forEach((listener) => listener());
      for (const state of this.topics.values()) { state.revision++; state.listeners.forEach((listener) => listener()); }
    });
  };
  suspend = (): (() => void) => {
    this.blocked++;
    this.reset();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.blocked--;
      this.reset();
    };
  };
  epoch = (): number => this.context;
  subscribeContext = (listener: () => void): (() => void) => {
    this.contextListeners.add(listener);
    return () => { this.contextListeners.delete(listener); };
  };

  last(topic: PageDataTopic, keys?: ReadonlySet<string>): { at: number | null; error: PageDataFailure | null } {
    let at: number | null = null;
    let error: PageDataFailure | null = null;
    for (const [key, entry] of this.entries) {
      if (entry.topic !== topic || (keys && !keys.has(key))) continue;
      if (entry.value.at !== null) at = Math.max(at ?? 0, entry.value.at);
      error ??= entry.value.error ?? entry.value.diskError;
    }
    return { at, error };
  }
}
