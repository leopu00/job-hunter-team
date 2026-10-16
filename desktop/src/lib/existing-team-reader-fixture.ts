import { pathToFileURL } from "node:url";

// The core's reader (POSITIONS_READ_PY, src-tauri/src/existing_team_runtime.rs)
// names its two inputs as Python string literals. The tests that run it for
// real on a synthetic folder point it elsewhere by swapping those literals.
// A path goes in as JSON, which is also a valid Python literal: pasted raw
// inside quotes, "C:\Users\runner\..." is a SyntaxError ("truncated \UXXXXXXXX
// escape") and "C:\temp" silently becomes a tab.
const JOBS_DB = "'file:/jht_home/jobs.db?mode=ro'";
const PROFILE_DIR = "'/jht_home/profile'";

function swap(source: string, literal: string, value: string): string {
  if (!source.includes(literal)) throw new Error(`reader literal not found: ${literal}`);
  return source.replace(literal, () => JSON.stringify(value));
}

/** The reader reading `database` instead of the container's jobs.db (a sqlite URI, read-only). */
export function readerOnDatabase(source: string, database: string): string {
  return swap(source, JOBS_DB, `${pathToFileURL(database).href}?mode=ro`);
}

/** The reader reading `profile` instead of the container's profile folder. */
export function readerOnProfile(source: string, profile: string): string {
  return swap(source, PROFILE_DIR, profile);
}
