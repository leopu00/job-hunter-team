/**
 * `enrichment_policy.py show` as a native tool (T14, skill logo-extraction):
 * the spending brake the care-mode work obeys, and the working mode, as one
 * JSON line. `set` changes the brake, which is the Capitano's on the person's
 * order only: refused.
 */

import { existsSync } from "node:fs";

import { pyRepr } from "../../db/argv.ts";
import type { EnrichmentPolicy } from "../../db/enrichment-policy.ts";
import { pyJson } from "../../db/py-format.ts";
import { refused, type ScriptResult } from "../../db/tools.ts";
import type { ToolHandler } from "../../tools/registry.ts";
import { argvTool } from "./argv-tool.ts";

export function enrichmentPolicyCommand(policy: EnrichmentPolicy, argv: string[]): ScriptResult {
  const sub = argv[0];
  const usage = (message: string): ScriptResult => ({
    stdout: "",
    stderr: `usage: enrichment_policy.py [-h] ...\nenrichment_policy.py: error: ${message}\n`,
    exitCode: 2,
  });
  if (sub === undefined) return usage("the following arguments are required: cmd");
  if (sub !== "show" && sub !== "set") return usage(`argument cmd: invalid choice: ${pyRepr(sub)} (choose from 'show', 'set')`);
  if (sub === "set") return refused("enrichment_policy", sub, ["show"]);
  if (argv.length > 1) return usage(`unrecognized arguments: ${argv.slice(1).join(" ")}`);
  const out = { ok: true, path: policy.policyPath, exists: existsSync(policy.policyPath), policy: policy.load(), mode: policy.currentMode() };
  return { stdout: `${pyJson(out, { ensureAscii: false })}\n`, exitCode: 0 };
}

export function createEnrichmentPolicyTool(policy: EnrichmentPolicy): ToolHandler {
  return argvTool({
    name: "enrichment_policy",
    script: "enrichment_policy.py",
    description: "Show the spending brake on care-mode enrichment and the working mode: enrichment_policy show.",
    run: (args) => enrichmentPolicyCommand(policy, args),
  });
}
