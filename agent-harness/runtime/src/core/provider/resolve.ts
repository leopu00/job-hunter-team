/**
 * Turns a `Config` into a `ProviderPort`.
 *
 * The AI SDK adapter is imported lazily so that a mock run never loads it —
 * a test cannot reach a paid endpoint through a module it never evaluated.
 */

import type { Config } from "../../config.ts";
import type { ProviderPort } from "./port.ts";
import { MockProvider, type ScriptedTurn } from "./mock.ts";

export async function resolveProvider(
  config: Config,
  mockScript: ScriptedTurn[] = [],
): Promise<ProviderPort> {
  if (!config.live) {
    return new MockProvider(mockScript);
  }
  const { AiSdkProvider } = await import("./ai-sdk.ts");
  return new AiSdkProvider({
    profile: config.profile,
    openAICompatible: config.openAICompatible,
    openAI: config.openAI,
  });
}
