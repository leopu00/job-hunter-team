/**
 * `npm run hub` — the team's database and channels behind one process (T18).
 *
 * Environment, all set by whoever deploys it (the pod on the VPS):
 *   JHT_HUB_TOKENS      JSON file { "<token>": "<agent>" }, readable by the hub alone
 *   JHT_HUB_DB          the team's jobs.db
 *   JHT_HUB_CHANNELS    the folder of mailbox/, replies/ and notify.jsonl
 *   JHT_HUB_STATE       the hub's own state (salary cache, scout-dedup.log)
 *   JHT_HUB_PORT        port on 127.0.0.1 (default 8788)
 *   JHT_API_APP_ROOT    the folder holding agents/ (default this checkout; /app in the image)
 *   JHT_API_PROFILE_DIR the person's profile, read-only
 *   JHT_HOME            as the feedback display reads it
 */

import { fileURLToPath } from "node:url";

import { createHub, loadTokens } from "../hub/server.ts";

const CHECKOUT_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`jht-hub: ${name} is not set.`);
    process.exit(2);
  }
  return value;
}

const port = Number(process.env["JHT_HUB_PORT"]?.trim() || "8788");
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error("jht-hub: JHT_HUB_PORT must be a port number.");
  process.exit(2);
}
const tokens = loadTokens(required("JHT_HUB_TOKENS"));
const profileDir = process.env["JHT_API_PROFILE_DIR"]?.trim();
const jhtHome = process.env["JHT_HOME"]?.trim();
const server = createHub({
  tokens,
  dbPath: required("JHT_HUB_DB"),
  channelsDir: required("JHT_HUB_CHANNELS"),
  stateDir: required("JHT_HUB_STATE"),
  appRoot: process.env["JHT_API_APP_ROOT"]?.trim() || CHECKOUT_ROOT,
  ...(profileDir ? { profileDir } : {}),
  ...(jhtHome ? { jhtHome } : {}),
});
// The loopback only: in the pod, every role reaches it; outside the pod, nothing does.
server.listen(port, "127.0.0.1", () => {
  console.log(`jht-hub: ${tokens.size} agents on 127.0.0.1:${port}`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => server.close(() => process.exit(0)));
