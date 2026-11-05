import { useEffect, useRef, useState } from "react";
import { appLocale } from "../lib/app-locale";
import { onStreamHint, onStreamState, streamPace } from "../lib/state-stream";
import { EMPTY_PROFILE_PROGRESS, PROFILE_REREAD_EVENT, progressFromReading, type ProfileProgress } from "./contract";
import { readProfileProgress, type ProfileProgressRead } from "./read";
import { PROFILE_PROGRESS_TEXT } from "./profile-progress.i18n";

/** How often the card reads the profile again while the profile is not complete, the page is open and the window is in view. */
export const PROFILE_PROGRESS_EVERY_MS = 20_000;
/** The same, while the channel to the team is up: it says when the profile file changes, so this is only the net. */
export const PROFILE_PROGRESS_STREAMED_MS = 60_000;
/** Hints of the channel closer than this are one read. */
const HINT_GAP_MS = 2_000;

/**
 * The profile's progress, read-only, while the component that uses it is mounted: once at once, then every few
 * seconds while the profile is not complete, and not at all while the window is hidden (it reads at once when it
 * comes back) or once a read has found every field filled (the card is gone; the next look at the window reads
 * once more, and stops again if it is still complete). A read that fails
 * after one that worked leaves what was read; one that fails first says `unavailable`, which the card tells
 * without breaking the page. While the channel to the team is up it reads again when the channel says the
 * profile changed, and the timer only backs it up, slower. `read` and `everyMs` are for the tests.
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
    // A hint of the channel came while a read was on its way: that read may have started before the change, so one more follows it.
    let hintedMeanwhile = false;
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
            // «no profile yet» is not a failure; any other code is told by the card
            const reason = done.code === "profile_unavailable" ? undefined : done.code;
            setProgress((current) => (current.state === "ready" ? current : { ...EMPTY_PROFILE_PROGRESS, state: "unavailable", ...(reason ? { reason } : {}) }));
          }
        } finally {
          reading.current = false;
        }
        if (hintedMeanwhile && live) {
          hintedMeanwhile = false;
          return again();
        }
      }
      if (live && !complete) timer = setTimeout(() => void again(), streamPace(everyMs, PROFILE_PROGRESS_STREAMED_MS));
    };
    const seen = () => {
      if (document.visibilityState === "visible") void again();
    };
    void again();
    document.addEventListener("visibilitychange", seen);
    // the card's «Reconnect the chat» says the chat is back: read now
    window.addEventListener(PROFILE_REREAD_EVENT, seen);
    // The profile changed, said the channel: read now (even a card that was complete, a field may have emptied).
    const stopHint = onStreamHint(
      "profile",
      () => {
        if (document.visibilityState !== "visible") return;
        if (reading.current) hintedMeanwhile = true;
        else void again();
      },
      HINT_GAP_MS,
    );
    // The channel went up or down: the wait that is running was set at the other pace.
    const stopState = onStreamState(() => {
      // a read in flight sets the next wait itself, at the pace of the moment it ends
      if (live && !complete && !reading.current) {
        clearTimeout(timer);
        timer = setTimeout(() => void again(), streamPace(everyMs, PROFILE_PROGRESS_STREAMED_MS));
      }
    });
    return () => {
      live = false;
      clearTimeout(timer);
      stopHint();
      stopState();
      document.removeEventListener("visibilitychange", seen);
      window.removeEventListener(PROFILE_REREAD_EVENT, seen);
    };
  }, [read, everyMs]);

  return progress;
}
