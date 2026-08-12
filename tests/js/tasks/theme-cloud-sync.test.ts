import { describe, expect, it } from "vitest";

import {
  PENDING_THEME_STORAGE_KEY,
  THEME_STORAGE_KEY,
  initializeThemeSync,
  persistThemeChange,
  type StorageLike,
  type Theme,
  type ThemeCloudBackend,
} from "@/lib/theme-cloud-sync";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class SharedCloud {
  readonly rows = new Map<string, Theme>();
  reads = 0;
  creates = 0;
  writes = 0;
  failRead = false;
  failWrite = false;

  backend(userId: string | null): ThemeCloudBackend {
    return {
      currentUserId: async () => userId,
      readTheme: async (requestedUserId) => {
        this.reads += 1;
        if (this.failRead) throw new Error("cloud read unavailable");
        return this.rows.get(requestedUserId) ?? null;
      },
      createTheme: async (requestedUserId, theme) => {
        this.creates += 1;
        if (this.failWrite) throw new Error("cloud write unavailable");
        if (this.rows.has(requestedUserId)) return "conflict";
        this.rows.set(requestedUserId, theme);
        return "created";
      },
      writeTheme: async (requestedUserId, theme) => {
        this.writes += 1;
        if (this.failWrite) throw new Error("cloud write unavailable");
        this.rows.set(requestedUserId, theme);
        return theme;
      },
    };
  }
}

function cache(storage: MemoryStorage, theme: Theme) {
  storage.setItem(THEME_STORAGE_KEY, theme);
}

describe("theme cloud sync v1", () => {
  it("porta su browser B il tema confermato dal browser A", async () => {
    const cloud = new SharedCloud();
    const browserA = new MemoryStorage();
    const browserB = new MemoryStorage();

    await initializeThemeSync(browserA, cloud.backend("user-1"));
    await persistThemeChange("dark", browserA, cloud.backend("user-1"));
    const resultB = await initializeThemeSync(
      browserB,
      cloud.backend("user-1"),
    );

    expect(resultB).toMatchObject({ theme: "dark", status: "synced" });
    expect(browserB.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("inizializza una riga assente una sola volta dalla cache valida", async () => {
    const cloud = new SharedCloud();
    const storage = new MemoryStorage();
    cache(storage, "light");

    const result = await initializeThemeSync(
      storage,
      cloud.backend("user-1"),
    );

    expect(result).toMatchObject({ theme: "light", status: "synced" });
    expect(cloud.rows.get("user-1")).toBe("light");
    expect(cloud.creates).toBe(1);
    expect(cloud.writes).toBe(0);
  });

  it("su errore di lettura conserva la cache e non inizializza il cloud", async () => {
    const cloud = new SharedCloud();
    cloud.failRead = true;
    const storage = new MemoryStorage();
    cache(storage, "dark");

    const result = await initializeThemeSync(
      storage,
      cloud.backend("user-1"),
    );

    expect(result).toMatchObject({ theme: "dark", status: "pending" });
    expect(cloud.creates).toBe(0);
    expect(cloud.writes).toBe(0);
  });

  it("mantiene pending una modifica offline e lo cancella solo al retry riuscito", async () => {
    const cloud = new SharedCloud();
    cloud.rows.set("user-1", "dark");
    cloud.failWrite = true;
    const storage = new MemoryStorage();
    cache(storage, "dark");

    const offline = await persistThemeChange(
      "light",
      storage,
      cloud.backend("user-1"),
    );

    expect(offline).toMatchObject({ theme: "light", status: "pending" });
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(storage.getItem(PENDING_THEME_STORAGE_KEY)).not.toBeNull();
    expect(cloud.rows.get("user-1")).toBe("dark");

    cloud.failWrite = false;
    const retried = await initializeThemeSync(
      storage,
      cloud.backend("user-1"),
    );

    expect(retried).toMatchObject({ theme: "light", status: "synced" });
    expect(storage.getItem(PENDING_THEME_STORAGE_KEY)).toBeNull();
    expect(cloud.rows.get("user-1")).toBe("light");
  });

  it("fa prevalere il cloud su una cache stale quando non c'e pending", async () => {
    const cloud = new SharedCloud();
    cloud.rows.set("user-1", "dark");
    const storage = new MemoryStorage();
    cache(storage, "light");

    const result = await initializeThemeSync(
      storage,
      cloud.backend("user-1"),
    );

    expect(result).toMatchObject({ theme: "dark", status: "synced" });
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(cloud.writes).toBe(0);
  });

  it("un anonimo resta solo locale e non crea pending", async () => {
    const cloud = new SharedCloud();
    const storage = new MemoryStorage();

    const result = await persistThemeChange(
      "light",
      storage,
      cloud.backend(null),
    );

    expect(result).toMatchObject({ theme: "light", status: "anonymous" });
    expect(storage.getItem(PENDING_THEME_STORAGE_KEY)).toBeNull();
    expect(cloud.reads + cloud.creates + cloud.writes).toBe(0);
  });

  it("non invia a B il pending di A e adotta il cloud di B", async () => {
    const cloud = new SharedCloud();
    cloud.rows.set("user-b", "dark");
    const storage = new MemoryStorage();
    cache(storage, "light");
    storage.setItem(
      PENDING_THEME_STORAGE_KEY,
      JSON.stringify({ userId: "user-a", theme: "light" }),
    );

    const result = await initializeThemeSync(
      storage,
      cloud.backend("user-b"),
    );

    expect(result).toMatchObject({ theme: "dark", status: "synced" });
    expect(cloud.writes).toBe(0);
    expect(storage.getItem(PENDING_THEME_STORAGE_KEY)).toContain("user-a");
  });
});
