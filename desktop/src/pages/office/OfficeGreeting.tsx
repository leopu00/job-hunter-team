import { appLocale } from "../../lib/app-locale";
import { firstName, greetingText } from "../../lib/greeting";
import { readLocalProfile } from "../../lib/local-profile";
import { useProfileProgress } from "../../profile-progress/useProfileProgress";

/** The name is asked once and does not change under the page: a slow read is enough. */
const GREETING_READ_MS = 60_000;

function Line({ name, now }: { name: string | null; now: () => Date }) {
  const text = greetingText(name, now().getHours(), appLocale());
  if (!text) return null;
  return (
    <p data-testid="office-greeting" className="m-0 shrink-0 border-b border-[var(--color-border)] px-4 py-1.5 text-[11px] text-[var(--color-bright)]">
      {text}
    </p>
  );
}

/** The name the Assistant collected into the profile: read with the profile's progress, once it is there. */
function FromTheProfile({ now }: { now: () => Date }) {
  const progress = useProfileProgress(undefined, GREETING_READ_MS);
  const name = progress.state === "ready" ? firstName(progress.fields.find((field) => field.key === "name" && field.done)?.value) : null;
  return <Line name={name} now={now} />;
}

/**
 * One line above the scene that greets the person by their first name: the display name of the local profile when
 * it has one (the person wrote it on the first screen, and nothing is read for it), else the name the Assistant
 * has put into the profile.
 */
export default function OfficeGreeting({ now = () => new Date() }: { now?: () => Date }) {
  const own = firstName(readLocalProfile()?.displayName);
  return own ? <Line name={own} now={now} /> : <FromTheProfile now={now} />;
}
