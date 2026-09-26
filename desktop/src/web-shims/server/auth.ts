/**
 * Stand-in for web/lib/auth.ts. The web tells a request from the user's own
 * machine (local SQLite workspace) from one to the cloud deploy (Supabase).
 * The desktop reads Supabase with the user's session: it is always the cloud
 * branch, as on the web deploy.
 */
export async function isLocalRequest(): Promise<boolean> {
  return false;
}
