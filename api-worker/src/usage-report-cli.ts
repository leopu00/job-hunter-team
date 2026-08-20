import { resolve } from "node:path";

import { readAuditJsonl } from "./audit.js";
import { buildUsageReport } from "./usage-report.js";

async function main(): Promise<void> {
  const auditPath = parseAuditPath(process.argv.slice(2));
  const report = buildUsageReport(await readAuditJsonl(auditPath));
  process.stdout.write(
    `${JSON.stringify({ auditPath, ...report }, null, 2)}\n`,
  );
}

function parseAuditPath(args: string[]): string {
  const index = args.indexOf("--audit");
  if (index < 0 || !args[index + 1]) {
    throw new Error(
      "usage report requires --audit /absolute/path/scout-runs.jsonl",
    );
  }
  return resolve(args[index + 1]);
}

main().catch(() => {
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: { code: "USAGE_REPORT_CONFIGURATION", message: "The usage report input is invalid or unreadable." } })}\n`,
  );
  process.exitCode = 1;
});
