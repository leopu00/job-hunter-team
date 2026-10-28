import { useEffect, useState, type ReactNode } from "react";
import { useLocale } from "@/lib/use-locale";
import { AssistantPortrait, ProfileProgressCard, useProfileProgress } from "./deps";
import {
  GUIDED_CHAT_ARIA,
  GUIDED_CONTINUE_LATER,
  GUIDED_CONTINUE_LATER_HINT,
  GUIDED_MOMENT_LINE,
  GUIDED_PROFILE_ARIA,
  GUIDED_TEAM_LATE,
} from "./guided.i18n";
import { guidedMoment, TEAM_START_PATIENCE_MS, type FirstRunSignal } from "./moments";
import "./guided-onboarding.css";

/**
 * The screen that follows the setup: the profile card on the left, the Assistant on the right (its portrait, the
 * moment the person is at, and the real chat). The moment is derived from what the caller reads of the machine
 * (the Captain, the profile confirmation, the first-run state) and from the card's own count of fields; the caller
 * builds the chat (the screen is the same with any chat in it). After `patienceMs` in the `team` moment the line
 * says the team is late. «Continue later» is always there: no moment is without a way out.
 */
export default function GuidedOnboardingPage({
  profileReady,
  captainRunning,
  firstRun,
  onContinueLater,
  patienceMs = TEAM_START_PATIENCE_MS,
  children,
}: {
  profileReady: boolean;
  captainRunning: boolean;
  /** null: not read yet, or not readable. */
  firstRun: FirstRunSignal | null;
  onContinueLater: () => void;
  patienceMs?: number;
  /** The chat with the Assistant. */
  children: ReactNode;
}) {
  const locale = useLocale();
  const progress = useProfileProgress();
  const moment = guidedMoment({
    profileFilled: progress.filled,
    profileTotal: progress.total,
    profileReady,
    captainRunning,
    firstRun,
  });
  // One timer, set when the `team` moment begins and dropped when it ends: nothing ticks while the person waits.
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (moment !== "team") {
      setLate(false);
      return;
    }
    const timer = setTimeout(() => setLate(true), patienceMs);
    return () => clearTimeout(timer);
  }, [moment, patienceMs]);
  return (
    <section className="guided-onboarding" data-testid="guided-onboarding" data-moment={moment}>
      <aside className="guided-onboarding__profile" aria-label={GUIDED_PROFILE_ARIA[locale]}>
        <ProfileProgressCard progress={progress} />
      </aside>
      <div className="guided-onboarding__assistant" role="region" aria-label={GUIDED_CHAT_ARIA[locale]}>
        <header className="guided-onboarding__header">
          <AssistantPortrait className="guided-onboarding__portrait" expression="neutro" speaking={false} />
          <div className="guided-onboarding__says">
            <p data-testid="guided-moment-line" className="guided-onboarding__line">{GUIDED_MOMENT_LINE[moment][locale]}</p>
            {late && (
              <p data-testid="guided-team-late" role="status" className="guided-onboarding__late">{GUIDED_TEAM_LATE[locale]}</p>
            )}
          </div>
          <div className="guided-onboarding__later">
            <button type="button" data-testid="guided-continue-later" onClick={onContinueLater}>
              {GUIDED_CONTINUE_LATER[locale]}
            </button>
            <small>{GUIDED_CONTINUE_LATER_HINT[locale]}</small>
          </div>
        </header>
        <div className="guided-onboarding__chat">{children}</div>
      </div>
    </section>
  );
}
