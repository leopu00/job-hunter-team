import type { Theme, ThemeCloudBackend } from "@/lib/theme-cloud-sync";
import { isTheme } from "@/lib/theme-cloud-sync";

type QueryError = { code?: string; message?: string } | null;
type ThemeResult = {
  data: { theme?: unknown } | null;
  error: QueryError;
};

type ThemeQuery = {
  select(columns: string): ThemeQuery;
  insert(values: { user_id: string; theme: Theme }): ThemeQuery;
  upsert(
    values: { user_id: string; theme: Theme },
    options: { onConflict: string },
  ): ThemeQuery;
  eq(column: string, value: string): ThemeQuery;
  maybeSingle(): Promise<ThemeResult>;
  single(): Promise<ThemeResult>;
};

export type ThemeSupabaseClient = {
  auth: {
    getSession(): Promise<{
      data: { session: { user: { id: string } } | null };
      error: QueryError;
    }>;
  };
  from(table: "user_settings"): ThemeQuery;
};

function errorMessage(error: Exclude<QueryError, null>): string {
  return error.message || error.code || "theme cloud request failed";
}

function themeFromResult(result: ThemeResult): Theme {
  if (result.error) throw new Error(errorMessage(result.error));
  const theme = result.data?.theme;
  if (!isTheme(theme)) throw new Error("theme cloud returned an invalid value");
  return theme;
}

/** Adapter browser→PostgREST. RLS resta l'unica autorità di ownership. */
export function createSupabaseThemeBackend(
  supabase: ThemeSupabaseClient,
): ThemeCloudBackend {
  return {
    async currentUserId() {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw new Error(errorMessage(error));
      return data.session?.user.id ?? null;
    },

    async readTheme(userId) {
      const result = await supabase
        .from("user_settings")
        .select("theme")
        .eq("user_id", userId)
        .maybeSingle();
      if (result.error) throw new Error(errorMessage(result.error));
      if (!result.data) return null;
      return themeFromResult(result);
    },

    async createTheme(userId, theme) {
      const result = await supabase
        .from("user_settings")
        .insert({ user_id: userId, theme })
        .select("theme")
        .single();
      if (result.error?.code === "23505") return "conflict";
      themeFromResult(result);
      return "created";
    },

    async writeTheme(userId, theme) {
      const result = await supabase
        .from("user_settings")
        .upsert(
          { user_id: userId, theme },
          { onConflict: "user_id" },
        )
        .select("theme")
        .single();
      return themeFromResult(result);
    },
  };
}
