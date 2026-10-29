import { appLocale } from "../../lib/app-locale";
import { firstName, greetingText } from "../../lib/greeting";
import { useProfileProgress } from "../../profile-progress/useProfileProgress";

/** The name is asked once and does not change under the page: a slow read is enough. */
const GREETING_READ_MS = 60_000;

/** One line above the scene that greets the person by name, once the Assistant has the name in the profile. */
export default function OfficeGreeting({ now = () => new Date() }: { now?: () => Date }) {
  const progress = useProfileProgress(undefined, GREETING_READ_MS);
  const name = progress.state === "ready" ? firstName(progress.fields.find((field) => field.key === "name" && field.done)?.value) : null;
  const text = greetingText(name, now().getHours(), appLocale());
  if (!text) return null;
  return (
    <p data-testid="office-greeting" className="m-0 shrink-0 border-b border-[var(--color-border)] px-4 py-1.5 text-[11px] text-[var(--color-bright)]">
      {text}
    </p>
  );
}
