import { z } from "zod";

export const ProviderNameSchema = z.enum([
  "mock",
  "anthropic",
  "openai",
  "kimi",
]);

export type ProviderName = z.infer<typeof ProviderNameSchema>;

export const ModelProfileSchema = z
  .strictObject({
    profileVersion: z.literal("1"),
    provider: ProviderNameSchema,
    model: z.string().trim().min(1).max(160),
    capabilities: z.strictObject({
      toolCalling: z.strictObject({
        supported: z.boolean(),
        parallel: z.boolean(),
      }),
      structuredOutput: z.strictObject({
        supported: z.boolean(),
        mode: z.enum(["native", "json_schema", "prompted", "none"]),
      }),
    }),
    pricing: z
      .strictObject({
        inputUsdPerMillionTokens: z.number().nonnegative(),
        outputUsdPerMillionTokens: z.number().nonnegative(),
      })
      .optional(),
    baseUrl: z
      .string()
      .url()
      .refine((value) => new URL(value).protocol === "https:", {
        message: "A live compatible-provider base URL must use HTTPS",
      })
      .optional(),
  })
  .superRefine((profile, context) => {
    if (profile.provider !== "kimi" && profile.baseUrl !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message: "Custom baseUrl is allowed only for the Kimi adapter",
      });
    }
    if (profile.provider === "kimi" && profile.baseUrl === undefined) {
      context.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message: "Kimi requires an explicit OpenAI-compatible baseUrl",
      });
    }
  });

export type ModelProfile = z.infer<typeof ModelProfileSchema>;

export const API_KEY_ENV_BY_PROVIDER = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  kimi: "MOONSHOT_API_KEY",
} as const;

export function assertScoutCapabilities(profile: ModelProfile): void {
  if (!profile.capabilities.toolCalling.supported) {
    throw new Error("CAPABILITY_TOOL_CALLING");
  }
  if (
    !profile.capabilities.structuredOutput.supported ||
    profile.capabilities.structuredOutput.mode === "none"
  ) {
    throw new Error("CAPABILITY_STRUCTURED_OUTPUT");
  }
}
