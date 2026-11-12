// The person's time zone for the working hours. Inside the container the system zone is UTC: the zone the host setup
// asked or read from the computer arrives as JHT_USER_TZ (host.env → compose), and it wins when it is a real zone.
// On the host (no JHT_USER_TZ) the system zone is the person's.
export function localTimeZone(env = process.env) {
  const asked = String(env.JHT_USER_TZ || '').trim();
  if (asked) {
    try { return new Intl.DateTimeFormat('en', { timeZone: asked }).resolvedOptions().timeZone; } catch { /* not a zone */ }
  }
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}
