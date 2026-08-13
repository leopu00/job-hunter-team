import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [helperPath, dbPath, barrierPath, encodedInput] = process.argv.slice(2);
const requireFromWeb = createRequire(
  new URL("../../../web/package.json", import.meta.url),
);
const Database = requireFromWeb(
  "better-sqlite3",
) as typeof import("better-sqlite3");
const helper = await import(pathToFileURL(helperPath).href);
const input = JSON.parse(
  Buffer.from(encodedInput, "base64url").toString("utf8"),
);

while (!existsSync(barrierPath)) {
  await new Promise((resolve) => setTimeout(resolve, 2));
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 10000");
try {
  process.stdout.write(
    JSON.stringify(helper.mutateLocalTeamDirective(db, input)),
  );
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
} finally {
  db.close();
}
