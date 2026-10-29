import { useEffect, useRef, useState } from "react";
import { appLocale } from "../lib/app-locale";
import { EMPTY_PROFILE_PROGRESS, progressFromReading, type ProfileProgress } from "./contract";
import { readProfileProgress, type ProfileProgressRead } from "./read";
import { PROFILE_PROGRESS_TEXT } from "./profile-progress.i18n";

/** How often the card reads the profile again while the profile is not complete, the page is open and the window is in view. */
export const PROFILE_PROGRESS_EVERY_MS = 20_000;

/**
 * The profile's progress, read-only, while the component that uses it is mounted: once at once, then every few
 * seconds while the profile is not complete, and not at all while the window is hidden (it reads at once when it
 * comes back) or once a read has found every field filled (the card is gone; the next look at the window reads
 * once more, and stops again if it is still complete). A read that fails
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
    let complete = false;
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
            complete = done.reading.done >= done.reading.required;
            setProgress(progressFromReading(done.reading, PROFILE_PROGRESS_TEXT[appLocale()].fields));
          } else {
            complete = false;
            setProgress((current) => (current.state === "ready" ? current : { ...EMPTY_PROFILE_PROGRESS, state: "unavailable" }));
          }
        } finally {
          reading.current = false;
        }
      }
      if (live && !complete) timer = setTimeout(() => void again(), everyMs);
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
