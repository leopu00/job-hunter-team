export type Theme = "dark" | "light" | "system";

export const THEME_STORAGE_KEY = "jht-theme";
export const PENDING_THEME_STORAGE_KEY = "jht-theme-pending.v1";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type ThemeCloudBackend = {
  currentUserId(): Promise<string | null>;
  readTheme(userId: string): Promise<Theme | null>;
  createTheme(userId: string, theme: Theme): Promise<"created" | "conflict">;
  writeTheme(userId: string, theme: Theme): Promise<Theme>;
};

export type ThemeSyncResult = {
  theme: Theme;
  status: "anonymous" | "pending" | "synced";
};

type PendingTheme = {
  userId: string;
  theme: Theme;
};

export function isTheme(value: unknown): value is Theme {
  return value === "dark" || value === "light" || value === "system";
}

function safeGet(storage: StorageLike, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: StorageLike, key: string, value: string): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemove(storage: StorageLike, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Una cache non scrivibile non deve trasformare un successo cloud in errore.
  }
}

export function readLocalTheme(storage: StorageLike): Theme {
  const value = safeGet(storage, THEME_STORAGE_KEY);
  return isTheme(value) ? value : "system";
}

function cacheTheme(storage: StorageLike, theme: Theme): void {
  safeSet(storage, THEME_STORAGE_KEY, theme);
}

function readPendingTheme(storage: StorageLike): PendingTheme | null {
  const raw = safeGet(storage, PENDING_THEME_STORAGE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingTheme>;
    return typeof value.userId === "string" && isTheme(value.theme)
      ? { userId: value.userId, theme: value.theme }
      : null;
  } catch {
    return null;
  }
}

function writePendingTheme(
  storage: StorageLike,
  userId: string,
  theme: Theme,
): void {
  safeSet(
    storage,
    PENDING_THEME_STORAGE_KEY,
    JSON.stringify({ userId, theme } satisfies PendingTheme),
  );
}

function samePending(left: PendingTheme | null, right: PendingTheme): boolean {
  return left?.userId === right.userId && left.theme === right.theme;
}

function confirmPendingTheme(
  storage: StorageLike,
  expected: PendingTheme,
  theme: Theme,
): ThemeSyncResult {
  // Una seconda scelta puo' essere gia' pending mentre la prima risposta e'
  // ancora in volo. La risposta vecchia e' valida per il cloud, ma non deve
  // cancellare o ricoprire lo stato locale piu' recente.
  if (!samePending(readPendingTheme(storage), expected)) {
    return { theme, status: "synced" };
  }
  cacheTheme(storage, theme);
  safeRemove(storage, PENDING_THEME_STORAGE_KEY);
  return { theme, status: "synced" };
}

/**
 * Riconcilia la cache di un browser con il cloud.
 *
 * Un pending dello stesso utente e' una modifica esplicita non confermata e
 * viene ritentato prima della lettura. Senza pending, una riga cloud esistente
 * prevale; il bootstrap locale e' permesso solo dopo una lettura riuscita che
 * ha accertato l'assenza della riga.
 */
export async function initializeThemeSync(
  storage: StorageLike,
  backend: ThemeCloudBackend,
): Promise<ThemeSyncResult> {
  const localTheme = readLocalTheme(storage);

  let userId: string | null;
  try {
    userId = await backend.currentUserId();
  } catch {
    return { theme: localTheme, status: "pending" };
  }
  if (!userId) return { theme: localTheme, status: "anonymous" };

  const pending = readPendingTheme(storage);
  if (pending?.userId === userId) {
    try {
      const confirmed = await backend.writeTheme(userId, pending.theme);
      if (!isTheme(confirmed)) throw new Error("invalid cloud theme");
      return confirmPendingTheme(storage, pending, confirmed);
    } catch {
      return { theme: localTheme, status: "pending" };
    }
  }

  let cloudTheme: Theme | null;
  try {
    cloudTheme = await backend.readTheme(userId);
    if (cloudTheme !== null && !isTheme(cloudTheme)) {
      throw new Error("invalid cloud theme");
    }
  } catch {
    return { theme: localTheme, status: "pending" };
  }

  if (cloudTheme !== null) {
    cacheTheme(storage, cloudTheme);
    return { theme: cloudTheme, status: "synced" };
  }

  try {
    const created = await backend.createTheme(userId, localTheme);
    if (created === "created") {
      cacheTheme(storage, localTheme);
      return { theme: localTheme, status: "synced" };
    }

    // Un altro browser ha vinto il bootstrap: non sovrascriverlo.
    const winner = await backend.readTheme(userId);
    if (!isTheme(winner)) throw new Error("missing bootstrap winner");
    cacheTheme(storage, winner);
    return { theme: winner, status: "synced" };
  } catch {
    return { theme: localTheme, status: "pending" };
  }
}

/** Applica localmente una scelta esplicita e tenta di confermarla nel cloud. */
export async function persistThemeChange(
  theme: Theme,
  storage: StorageLike,
  backend: ThemeCloudBackend,
): Promise<ThemeSyncResult> {
  cacheTheme(storage, theme);

  let userId: string | null;
  try {
    userId = await backend.currentUserId();
  } catch {
    return { theme, status: "pending" };
  }
  if (!userId) return { theme, status: "anonymous" };

  // Il pending precede la rete: un crash o un errore non perde la modifica.
  writePendingTheme(storage, userId, theme);
  try {
    const confirmed = await backend.writeTheme(userId, theme);
    if (!isTheme(confirmed)) throw new Error("invalid cloud theme");
    return confirmPendingTheme(storage, { userId, theme }, confirmed);
  } catch {
    return { theme, status: "pending" };
  }
}
