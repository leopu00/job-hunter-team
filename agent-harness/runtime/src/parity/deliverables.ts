/**
 * Who may write what in the deliverables folder (T25 follow-up).
 *
 * `$JHT_USER_DIR` is one shared folder: with `run-team` every role mounts the
 * same volume, so what the SCRITTORE writes is what the CRITICO reads — and
 * what any other role could overwrite. The CV and the cover letter are the
 * only things the team sends to a company, so this is the one place where a
 * manipulated document leaves the box: least privilege belongs here.
 *
 * The rule is the product's: `cv/` is the SCRITTORE's to write, `critiche/`
 * the CRITICO's, everyone reads everything. Two layers hold it, and both are
 * needed (SICUREZZA and VPS agreed): the filesystem's own modes, which hold
 * even from `bash`, and this one, which turns a refusal into a sentence the
 * agent can read and report instead of a permission error it cannot place.
 */

import { join } from "node:path";

import { realPath, resolveUserPath } from "../tools/paths.ts";
import { roleOf } from "../db/role-policy.ts";
import type { ToolHandler } from "../tools/registry.ts";

/** The subfolder each role writes; every other role reads it. */
export const DELIVERABLE_OWNERS: Readonly<Record<string, string>> = { scrittore: "cv", critico: "critiche" };

const WRITERS = new Set(["write_file", "edit_file"]);
const inside = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

/** `write_file`/`edit_file` confined to this role's own deliverables folder. Reads are untouched. */
export function deliverableWriteGuard(tools: ToolHandler[], options: { userDir: string; agent: string; workdir: string }): ToolHandler[] {
  const root = realPath(options.userDir);
  const role = roleOf(options.agent);
  const own = DELIVERABLE_OWNERS[role];
  const at = (path: string) => realPath(resolveUserPath(path, options.workdir));

  return tools.map((tool) => {
    if (!WRITERS.has(tool.spec.name)) return tool;
    return {
      ...tool,
      async execute(args, context) {
        const given = (args as { path?: string }).path;
        const target = given === undefined ? undefined : at(given);
        if (target !== undefined && inside(target, root) && (own === undefined || !inside(target, join(root, own)))) {
          const owner = Object.entries(DELIVERABLE_OWNERS).find(([, folder]) => inside(target, join(root, folder)));
          const whose = owner ? `${owner[1]}/ is the ${owner[0].toUpperCase()}'s to write` : "the deliverables folder itself is nobody's to write";
          const mine = own ? ` Yours is ${join(root, own)}.` : " This role writes no deliverable.";
          return { ok: false, content: `${tool.spec.name} ${given}: ${whose}, and you may read it but not change it.${mine}` };
        }
        return tool.execute(args, context);
      },
    };
  });
}
