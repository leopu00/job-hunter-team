/**
 * The button that pauses or resumes (JHT-T181): the team's, in the team's commands, and an agent's, next to
 * its «Restart» and «Stop». It shows «Pause» while what it controls works and «Resume» while it is paused;
 * the click only asks: the page opens its confirmation (what the pause keeps, what it stops), and only the
 * person's confirmation sends the command. It is not the stop: a paused session stays on with its context.
 *
 * Its own file so the page that holds it can move it: it knows no list, no team and no command.
 */
export function PauseResumeButton({
  paused,
  pauseLabel,
  resumeLabel,
  onPause,
  onResume,
  testIdBase,
  disabled = false,
}: {
  paused: boolean;
  pauseLabel: string;
  resumeLabel: string;
  onPause: () => void;
  onResume: () => void;
  /** the test id is `<base>-pause` while it works and `<base>-resume` while it is paused */
  testIdBase: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={`${testIdBase}-${paused ? "resume" : "pause"}`}
      aria-pressed={paused}
      disabled={disabled}
      onClick={paused ? onResume : onPause}
      className="text-[11px] font-semibold uppercase tracking-widest px-3 py-1 rounded border border-[var(--color-border)] text-[var(--color-bright)] disabled:opacity-60"
    >
      {paused ? resumeLabel : pauseLabel}
    </button>
  );
}
