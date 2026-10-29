import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/use-locale";
import { fill } from "../lib/text-slots";
import { AssistantPortrait } from "../components/assistant-portrait";
import type { OfficeAgent, OfficeClick } from "../office/contract";
import {
  nextStop,
  pauseTour,
  postponeTour,
  readTour,
  resumeTour,
  startTour,
  stopTarget,
  TOUR_STOPS,
  writeTour,
  type TourState,
  type TourStore,
} from "./tour";
import {
  TOUR_ARIA,
  TOUR_COUNTER,
  TOUR_FINISH_BUTTON,
  TOUR_LATER_BUTTON,
  TOUR_NEXT_BUTTON,
  TOUR_PAUSE_BUTTON,
  TOUR_RESUME_BUTTON,
  TOUR_START_BUTTON,
} from "./tour.i18n";
import { TOUR_ROLE_NAME, TOUR_SPEECH } from "./tour-speech.i18n";
import "./office-tour.css";

/**
 * The tour of the office, over the scene. The Assistant (her portrait, the one of the guided screen) invites the
 * person; at each stop the camera goes to the department or the seat, she says where they are and the colleague
 * answers in their own name. The person can pause it at any stop and take it up again where it was; the state is
 * kept (tour.ts), so a window closed in the middle comes back paused. `onFocus` is the page's own way of bringing
 * the camera to a target (the keyboard's focus), and `null` takes the ring away.
 */
export default function OfficeTour({
  roster,
  onFocus,
  store,
}: {
  roster: readonly OfficeAgent[];
  onFocus: (target: OfficeClick | null) => void;
  /** where the state is kept; the webview's own storage when absent (a test gives its own) */
  store?: TourStore | null;
}) {
  const locale = useLocale();
  const [state, setState] = useState<TourState>(() => readTour(store));
  const focus = useRef(onFocus);
  focus.current = onFocus;

  const change = (to: (current: TourState) => TourState) => {
    setState((current) => {
      const next = to(current);
      if (next !== current) writeTour(next, store);
      return next;
    });
  };

  const stop = TOUR_STOPS[state.index];
  const target = stopTarget(stop, roster);
  const targetKey = target ? JSON.stringify(target) : "";
  // The ring is the tour's only while it runs: a pause or the end takes it away, and a tour not begun never touches the focus.
  const showing = useRef(false);
  useEffect(() => {
    if (state.status === "running") {
      showing.current = true;
      focus.current(targetKey ? (JSON.parse(targetKey) as OfficeClick) : null);
    } else if (showing.current) {
      showing.current = false;
      focus.current(null);
    }
  }, [state.status, targetKey]);

  if (state.status === "done") return null;

  if (state.status === "later" || state.status === "paused") {
    return (
      <div className="office-tour office-tour--pill" data-testid="office-tour" data-status={state.status}>
        <button type="button" data-testid="office-tour-resume" onClick={() => change(state.status === "paused" ? resumeTour : startTour)}>
          {(state.status === "paused" ? TOUR_RESUME_BUTTON : TOUR_START_BUTTON)[locale]}
        </button>
      </div>
    );
  }

  if (state.status === "offer") {
    return (
      <section className="office-tour" role="region" aria-label={TOUR_ARIA[locale]} data-testid="office-tour" data-status="offer">
        <AssistantPortrait className="office-tour__portrait" expression="caldo" speaking={false} />
        <div className="office-tour__body">
          <p data-testid="office-tour-line" className="office-tour__line">{TOUR_SPEECH.assistente.greet[locale]}</p>
          <div className="office-tour__actions">
            <button type="button" data-testid="office-tour-start" onClick={() => change(startTour)}>{TOUR_START_BUTTON[locale]}</button>
            <button type="button" data-testid="office-tour-later" onClick={() => change(postponeTour)}>{TOUR_LATER_BUTTON[locale]}</button>
          </div>
        </div>
      </section>
    );
  }

  const speech = TOUR_SPEECH[stop];
  const last = state.index === TOUR_STOPS.length - 1;
  return (
    <section className="office-tour" role="region" aria-label={TOUR_ARIA[locale]} data-testid="office-tour" data-status="running" data-stop={stop}>
      <AssistantPortrait className="office-tour__portrait" expression="neutro" speaking={false} line={state.index} />
      <div className="office-tour__body">
        <small data-testid="office-tour-counter" className="office-tour__counter">
          {fill(TOUR_COUNTER[locale], { n: state.index + 1, total: TOUR_STOPS.length })}
        </small>
        <p data-testid="office-tour-line" className="office-tour__line">
          <strong>{TOUR_ROLE_NAME.assistente[locale]}: </strong>{speech.greet[locale]}
        </p>
        {speech.reply && (
          <p data-testid="office-tour-reply" className="office-tour__line office-tour__reply">
            <strong>{TOUR_ROLE_NAME[stop][locale]}: </strong>{speech.reply[locale]}
          </p>
        )}
        <div className="office-tour__actions">
          <button type="button" data-testid="office-tour-next" onClick={() => change(nextStop)}>
            {(last ? TOUR_FINISH_BUTTON : TOUR_NEXT_BUTTON)[locale]}
          </button>
          <button type="button" data-testid="office-tour-pause" onClick={() => change(pauseTour)}>{TOUR_PAUSE_BUTTON[locale]}</button>
        </div>
      </div>
    </section>
  );
}
