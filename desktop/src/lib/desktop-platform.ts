import { invoke } from "@tauri-apps/api/core";

export type DesktopPlatform = "windows" | "macos" | "linux" | "other";

const PLATFORMS = new Set<DesktopPlatform>(["windows", "macos", "linux", "other"]);

/** Reads the compiled target from the native shell; unknown or unavailable targets stay VPS-only. */
export async function readDesktopPlatform(): Promise<DesktopPlatform> {
  try {
    const platform = await invoke<unknown>("desktop_platform");
    return typeof platform === "string" && PLATFORMS.has(platform as DesktopPlatform)
      ? platform as DesktopPlatform
      : "other";
  } catch {
    return "other";
  }
}
