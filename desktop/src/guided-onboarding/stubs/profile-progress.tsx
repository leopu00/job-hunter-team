/**
 * STAND-IN for desktop/src/profile-progress (the profile card): same names and types as its contract, so the
 * real one replaces this by changing one import in ../deps.ts. Not the real card: it shows the fields it is given
 * and says calmly when it has none.
 */
export type ProfileProgressField = {
  key: "name" | "email" | "target_role" | "location" | "experience_years" | "seniority_target" | "skills" | "languages";
  label: string;
  value: string | null;
  done: boolean;
};

export type ProfileProgress = {
  state: "loading" | "ready" | "unavailable";
  fields: ProfileProgressField[];
  filled: number;
  total: number;
};

const UNAVAILABLE: ProfileProgress = { state: "unavailable", fields: [], filled: 0, total: 8 };

export function useProfileProgress(): ProfileProgress {
  return UNAVAILABLE;
}

export function ProfileProgressCard({ progress }: { progress: ProfileProgress }) {
  return (
    <div data-testid="profile-progress-stub" data-state={progress.state}>
      <progress max={progress.total} value={progress.filled} aria-label={`${progress.filled}/${progress.total}`} />
      <ul>
        {progress.fields.map((field) => (
          <li key={field.key} data-done={field.done ? "true" : "false"}>
            {field.done ? "✓" : "○"} {field.label}
            {field.value ? `: ${field.value}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
