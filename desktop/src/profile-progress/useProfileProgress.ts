import { useEffect, useRef, useState } from "react";
import { appLocale } from "../lib/app-locale";
import { EMPTY_PROFILE_PROGRESS, progressFromReading, type ProfileProgress } from "./contract";
import { readProfileProgress, type ProfileProgressRead } from "./read";
import { PROFILE_PROGRESS_TEXT } from "./profile-progress.i18n";

/** How often the card reads the profile again while the page is open and the window is in view. */
export const PROFILE_PROGRESS_EVERY_MS = 4_000;

/**
 * The profile's progress, read-only, while the component that uses it is mounted: once at once, then every few
 * seconds, and not at all while the window is hidden (it reads at once when it comes back). A read that fails
 * after one that worked leaves what was read; one that fails first says `unavailable`, which the card tells
 * without breaking the page. `read` and `everyMs` are for the tests.
 */
export function useProfileProgress(
  read: () => Promise<ProfileProgressRead> = readProfileProgress,
  everyMs: number = PROFILE_PROGRESS_EVERY_MS,
): ProfileProgress {
  const [progress, setProgress] = useState<ProfileProgress>(EMPTY_PROFILE_PROGRESS);
  const reading = useRef(false);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const again = async () => {
      if (!live) return;
      clearTimeout(timer);
      if (document.visibilityState === "visible" && !reading.current) {
        reading.current = true;
        try {
          const done = await read();
          if (!live) return;
          if (done.ok) {
            setProgress(progressFromReading(done.reading, PROFILE_PROGRESS_TEXT[appLocale()].fields));
          } else {
            setProgress((current) => (current.state === "ready" ? current : { ...EMPTY_PROFILE_PROGRESS, state: "unavailable" }));
          }
        } finally {
          reading.current = false;
        }
      }
      if (live) timer = setTimeout(() => void again(), everyMs);
    };
    const seen = () => {
      if (document.visibilityState === "visible") void again();
    };
    void again();
    document.addEventListener("visibilitychange", seen);
    return () => {
      live = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", seen);
    };
  }, [read, everyMs]);

  return progress;
}
