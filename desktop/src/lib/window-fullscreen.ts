import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Full screen on and off: the app's window in the desktop app, the page itself in a browser. Resolves to false when it did not work. */
export async function toggleFullscreen(): Promise<boolean> {
  try {
    if (isTauri()) {
      const window = getCurrentWindow();
      await window.setFullscreen(!(await window.isFullscreen()));
    } else if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
    return true;
  } catch {
    return false;
  }
}
