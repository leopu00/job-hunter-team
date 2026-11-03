import { invoke, isTauri } from "@tauri-apps/api/core";
import type { WebActionLogClient } from "@/lib/web-action-log";

/**
 * The action log of a profile with no cloud account: what the app did on the team of this computer for the person
 * (src-tauri/src/local_action_log.rs). The Agents panel's list reads the site's log through a client shaped like
 * Supabase's (`from(table).select(columns).order(column, options).limit(n)`); this one answers that call from the native
 * command instead, so the list, the sentences and the clean-up of the rows are the site log's own.
 *
 * The native side writes only closed lines and closes them again when it reads; the list cleans every text it draws
 * once more. A failure is a reason for the list to say, never the native side's message.
 */
const READ = "local_action_log_read";

type Answer = { data: unknown; error: { code: string } | null };

async function readRows(): Promise<Answer> {
  if (!isTauri()) return { data: null, error: { code: "desktop_transport_unavailable" } };
  let answer: unknown;
  try {
    answer = await invoke<unknown>(READ);
  } catch {
    return { data: null, error: { code: "desktop_transport_unavailable" } };
  }
  const record = typeof answer === "object" && answer !== null && !Array.isArray(answer) ? (answer as Record<string, unknown>) : null;
  if (!record || record.ok !== true || !Array.isArray(record.rows)) return { data: null, error: { code: "desktop_bad_reply" } };
  return { data: record.rows, error: null };
}

/** The native log as the list's client. The call keeps the shape the site's read has; the native side decides what a read brings. */
export function localActionLogClient(): WebActionLogClient {
  return {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => readRows(),
        }),
      }),
    }),
  };
}
