import type { ReactNode } from "react";
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
import { teamWaitState, type GuidedMoment } from "./moments";
import "./guided-onboarding.css";

/**
 * The screen that follows the setup: the profile card on the left, the Assistant on the right (its portrait, the
 * moment the person is at, and the real chat). It decides nothing: the moment and how long the team has been
 * waited for come from the caller, which also builds the chat (the screen is the same with any chat in it).
 * «Continue later» is always there: no moment is without a way out.
 */
export default function GuidedOnboardingPage({
  moment,
  teamWaitedMs,
  onContinueLater,
  children,
}: {
  moment: GuidedMoment;
  /** How long the screen has been in the `team` moment, in ms. */
  teamWaitedMs: number;
  onContinueLater: () => void;
  /** The chat with the Assistant. */
  children: ReactNode;
}) {
  const locale = useLocale();
  const progress = useProfileProgress();
  const late = moment === "team" && teamWaitState(teamWaitedMs) === "late";
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
