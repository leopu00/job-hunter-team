/**
 * Stand-in for web/lib/deploy-mode.ts, which reads JHT_DEPLOY from
 * process.env (absent in the webview). The desktop reads Supabase with the
 * user's session, as the cloud deploy does: it is always "cloud", so the web's
 * routes never look for the local SQLite file.
 */
export type DeployMode = "cloud" | "local";

export function getDeployMode(): DeployMode {
  return "cloud";
}

export function isCloudDeploy(): boolean {
  return true;
}

export function isLocalDeploy(): boolean {
  return false;
}

/**
 * The single door's strict origin check wants `JHT_PUBLIC_ORIGIN` on a public cloud deploy. The desktop is
 * "cloud" above only to read with the user's session: its calls to the routes never leave the app, so
 * there is no public address to configure.
 */
export function requiresPublicOrigin(): boolean {
  return false;
}
