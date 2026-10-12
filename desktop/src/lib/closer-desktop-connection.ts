import { invoke } from "@tauri-apps/api/core";
import type { ExecutionHost } from "./onboarding";

export type AssistanceHost = Extract<ExecutionHost, { kind: "vps" }>;
export type Registration = { ok: true; registered: true; assistance_ready: false }
  | { ok: false; error: string };

/** Registration saves the selected connection; it neither provisions nor grants a runtime. */
export async function registerAssistanceHost(host: AssistanceHost): Promise<Registration> {
  try {
    const value: unknown = await invoke("closer_desktop_register_host", { host });
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const r = value as Record<string, unknown>;
      if (r.ok === true && r.registered === true && r.assistance_ready === false)
        return { ok: true, registered: true, assistance_ready: false };
      if (r.ok === false && typeof r.error === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(r.error))
        return { ok: false, error: r.error };
    }
    return { ok: false, error: "desktop_bad_reply" };
  } catch {
    return { ok: false, error: "desktop_transport_unavailable" };
  }
}
