// These are the existing guard parsers, shared by the tests and baseline capture.
// Regexes, fallbacks and value extraction deliberately match the original tests.
export const PROFILE_FIELDS = /const PROFILE_FIELDS: &\[&str\] = &\[([\s\S]*?)\];/;
export const CHAT_AGENTS = /const CHAT_AGENTS: \[&str; \d+\] = \[([^\]]*)\]/;
export const PROFILE_PROGRESS = /const PROFILE_PROGRESS_PY: &str = r#"([\s\S]*?)"#;/;
export const TEAM_START = /const TEAM_START_PY: &str = r#"([\s\S]*?)"#;/;
export const WORK_STATS = /const WORK_STATS_PY: &str = r#"([\s\S]*?)"#;/;

export function profileFields(source) {
  const block = PROFILE_FIELDS.exec(source)?.[1] ?? '';
  return [...block.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
}

export function chatAgents(source) {
  return CHAT_AGENTS.exec(source)[1].match(/"([a-z]+)"/g).map((s) => s.slice(1, -1));
}

export function profileProgress(source) {
  return PROFILE_PROGRESS.exec(source)[1];
}

export function teamStart(source) {
  return TEAM_START.exec(source)[1];
}

export function workStats(source) {
  return WORK_STATS.exec(source)[1];
}
