/**
 * Stand-in for web/lib/jht-paths.ts, which builds paths from os.homedir() and
 * process.env when it loads (neither exists in the webview). The web's routes
 * import JHT_DB_PATH only for their local-SQLite branch, which the desktop
 * never takes (deploy-mode.ts says "cloud"): the paths name no file.
 * JHT_HOME is here because web/lib/server-locale.ts, reached by type-only
 * imports, names it.
 */
export const JHT_HOME = "/jht-desktop/no-local-home";
export const JHT_DB_PATH = `${JHT_HOME}/jobs.db`;
