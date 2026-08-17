// [JHT-WEB-NOTIFICATIONS] Motore delle notifiche browser (solo web cloud).
//
// Le preferenze vivono in `notification_prefs.prefs` (JSONB, mig 058) e il
// browser le legge/scrive DIRETTAMENTE su Supabase con la sessione utente
// (RLS) — zero route Vercel. Questo modulo definisce lo schema del JSON,
// la normalizzazione difensiva (il DB non valida) e il matching delle
// regole sulle righe `positions` arrivate via Realtime.
//
// Regola = trigger (posizione VALUTATA o NUOVA) + condizioni in AND:
// soglia score, location (substring, OR interno), paesi (codici, OR),
// keyword su titolo+azienda (OR), work mode. `minCount` trasforma la
// regola in digest: notifica una volta ogni N match accumulati.

export type RuleTrigger = "scored" | "new";
export type RuleWorkMode = "any" | "remote" | "hybrid" | "onsite";

export interface NotificationRule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: RuleTrigger;
  /** Solo per trigger "scored": score minimo (null = qualsiasi score). */
  minScore: number | null;
  /** Substring case-insensitive su location/città (OR fra loro). */
  locations: string[];
  /** Codici paese ISO-2 (OR fra loro), es. ["IT","DE"]. */
  countries: string[];
  /** Substring case-insensitive su titolo+azienda (OR fra loro). */
  keywords: string[];
  workMode: RuleWorkMode;
  /** 1 = notifica subito ogni match; N>1 = digest ogni N match. */
  minCount: number;
}

export interface WebNotificationPrefs {
  /** Master switch (implica permesso browser concesso). */
  enabled: boolean;
  /** Notifica all'arrivo di un messaggio agente. */
  messages: boolean;
  /** Notifica solo quando la scheda NON è in primo piano. */
  onlyWhenHidden: boolean;
  rules: NotificationRule[];
}

export const DEFAULT_PREFS: WebNotificationPrefs = {
  enabled: false,
  messages: true,
  onlyWhenHidden: true,
  rules: [],
};

/** Riga `positions` come arriva dal payload Realtime (campi usati qui). */
export interface PositionEventRow {
  id?: string;
  legacy_id?: number | null;
  title?: string | null;
  company?: string | null;
  location?: string | null;
  loc_city?: string | null;
  loc_country_code?: string | null;
  work_country_code?: string | null;
  work_mode?: string | null;
  is_remote?: boolean | null;
  score?: number | null;
  status?: string | null;
  deleted_at?: string | null;
  user_excluded_at?: string | null;
}

// ── Normalizzazione difensiva del JSONB ────────────────────────────────

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function asRule(v: unknown): NotificationRule | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  const trigger: RuleTrigger = r.trigger === "new" ? "new" : "scored";
  const workMode: RuleWorkMode =
    r.workMode === "remote" ||
    r.workMode === "hybrid" ||
    r.workMode === "onsite"
      ? r.workMode
      : "any";
  const minScoreRaw = typeof r.minScore === "number" ? r.minScore : null;
  const minCountRaw = typeof r.minCount === "number" ? r.minCount : 1;
  return {
    id: r.id,
    name:
      typeof r.name === "string" && r.name.trim() ? r.name.trim() : "Regola",
    enabled: r.enabled !== false,
    trigger,
    minScore:
      minScoreRaw == null
        ? null
        : Math.min(100, Math.max(0, Math.round(minScoreRaw))),
    locations: asStringArray(r.locations),
    countries: asStringArray(r.countries).map((c) => c.toUpperCase()),
    keywords: asStringArray(r.keywords),
    workMode,
    minCount: Math.min(50, Math.max(1, Math.round(minCountRaw))),
  };
}

export function normalizePrefs(raw: unknown): WebNotificationPrefs {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_PREFS };
  const p = raw as Record<string, unknown>;
  const rules = Array.isArray(p.rules)
    ? p.rules
        .map(asRule)
        .filter((r): r is NotificationRule => r !== null)
        .slice(0, 30)
    : [];
  return {
    enabled: p.enabled === true,
    messages: p.messages !== false,
    onlyWhenHidden: p.onlyWhenHidden !== false,
    rules,
  };
}

// ── Matching ───────────────────────────────────────────────────────────

function containsAny(haystack: string, needles: string[]): boolean {
  if (needles.length === 0) return true; // condizione vuota = non filtra
  const h = haystack.toLowerCase();
  return needles.some((n) => h.includes(n.toLowerCase()));
}

function matchesWorkMode(
  rule: NotificationRule,
  row: PositionEventRow,
): boolean {
  if (rule.workMode === "any") return true;
  const wm = (row.work_mode ?? "").toLowerCase().replace("-", "");
  if (wm) {
    if (rule.workMode === "onsite") return wm === "onsite";
    return wm === rule.workMode;
  }
  // Fallback sul booleano quando work_mode manca.
  if (rule.workMode === "remote") return row.is_remote === true;
  if (rule.workMode === "onsite") return row.is_remote === false;
  return false; // hybrid non deducibile da is_remote
}

/**
 * Una riga posizione (evento Realtime) soddisfa la regola?
 * `event` distingue il trigger "new" (INSERT) da "scored" (score presente).
 */
export function matchesRule(
  rule: NotificationRule,
  row: PositionEventRow,
  event: "INSERT" | "UPDATE",
): boolean {
  if (!rule.enabled) return false;
  if (row.deleted_at || row.user_excluded_at || row.status === "excluded") {
    return false;
  }
  if (rule.trigger === "new") {
    if (event !== "INSERT") return false;
  } else {
    // "scored": serve uno score, sopra soglia se impostata. Vale anche su
    // INSERT (posizione che arriva al cloud già valutata).
    if (typeof row.score !== "number") return false;
    if (rule.minScore != null && row.score < rule.minScore) return false;
  }
  const locHay = `${row.location ?? ""} ${row.loc_city ?? ""}`;
  if (!containsAny(locHay, rule.locations)) return false;
  if (rule.countries.length > 0) {
    const codes = [row.loc_country_code, row.work_country_code]
      .filter((c): c is string => typeof c === "string" && c.length > 0)
      .map((c) => c.toUpperCase());
    if (!codes.some((c) => rule.countries.includes(c))) return false;
  }
  const kwHay = `${row.title ?? ""} ${row.company ?? ""}`;
  if (!containsAny(kwHay, rule.keywords)) return false;
  return matchesWorkMode(rule, row);
}

// ── Persistenza browser-side (cache + dedupe + digest) ────────────────

export const PREFS_CACHE_KEY = "jht.webnotif.prefs";
const SEEN_KEY = "jht.webnotif.seen";
const PENDING_KEY_PREFIX = "jht.webnotif.pending.";
const SEEN_CAP = 800;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota/privacy mode: il dedupe degrada, non rompe */
  }
}

/** Già notificato (o contato nel digest) per questa regola+posizione? */
export function alreadySeen(ruleId: string, positionId: string): boolean {
  return readJson<string[]>(SEEN_KEY, []).includes(`${ruleId}:${positionId}`);
}

export function markSeen(ruleId: string, positionId: string): void {
  const seen = readJson<string[]>(SEEN_KEY, []);
  seen.push(`${ruleId}:${positionId}`);
  writeJson(SEEN_KEY, seen.slice(-SEEN_CAP));
}

/**
 * Accumula un match per una regola-digest e ritorna il numero di match in
 * attesa. Il chiamante svuota con clearPending quando notifica.
 */
export function addPending(ruleId: string, title: string): string[] {
  const key = PENDING_KEY_PREFIX + ruleId;
  const list = readJson<string[]>(key, []);
  list.push(title);
  writeJson(key, list.slice(-100));
  return list;
}

export function clearPending(ruleId: string): void {
  try {
    window.localStorage.removeItem(PENDING_KEY_PREFIX + ruleId);
  } catch {
    /* no-op */
  }
}

export function cachePrefs(prefs: WebNotificationPrefs): void {
  writeJson(PREFS_CACHE_KEY, prefs);
}

export function readCachedPrefs(): WebNotificationPrefs | null {
  const raw = readJson<unknown>(PREFS_CACHE_KEY, null);
  return raw === null ? null : normalizePrefs(raw);
}
