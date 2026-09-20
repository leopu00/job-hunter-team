/**
 * A Python skill as a native tool that takes the script's own words.
 *
 * The same shape as the DB tools (`src/db/tools.ts`): `{args: [...]}` is what
 * the agent would have typed after `python3 …/<script>.py`, and the answer is
 * what the script prints, with its exit code when it is not 0. The skills'
 * instructions then hold word for word once the prompt names the tool.
 */

import type { ToolAccess, ToolHandler } from "../../tools/registry.ts";
import { ARGS, asExecution, guarded, type ScriptResult } from "../../db/tools.ts";

export interface ArgvToolOptions {
  name: string;
  /** `deadline_extract.py`: named in the description, so the model maps the skill's command to the tool. */
  script: string;
  description: string;
  run: (args: string[]) => ScriptResult | Promise<ScriptResult>;
  /** Exit codes that are an answer, not a failure (recheck_liveness's 1 = CLOSED). */
  okCodes?: number[];
  /** What the call touches, for the permission policy. Default: nothing outside the runtime. */
  classify?: (args: string[]) => ToolAccess;
}

export function argvTool(options: ArgvToolOptions): ToolHandler {
  return {
    spec: {
      name: options.name,
      description: `${options.description} Same arguments and output as \`python3 /app/shared/skills/${options.script}\`: pass the words after the script name as \`args\`.`,
      schema: ARGS,
    },
    classify: (args) => {
      const words = (args as { args: string[] }).args;
      return options.classify?.(words) ?? { risk: "none", paths: [], summary: words.slice(0, 2).join(" ") };
    },
    async execute(args) {
      const words = (args as { args: string[] }).args;
      let result: ScriptResult;
      try {
        result = await options.run(words);
      } catch (error) {
        result = guarded(() => {
          throw error;
        });
      }
      return asExecution(guarded(() => result), options.okCodes ?? [0]);
    },
  };
}
