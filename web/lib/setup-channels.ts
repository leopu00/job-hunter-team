export class TelegramPairingBelongsToHostError extends Error {
  constructor() {
    super("telegram_pair_on_host");
    this.name = "TelegramPairingBelongsToHostError";
  }
}

export function setupChannels(
  value: unknown,
  existing: Record<string, unknown> = {},
): Record<string, unknown> {
  if (value === undefined) return { ...existing };
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  if (Object.hasOwn(value, "telegram")) {
    throw new TelegramPairingBelongsToHostError();
  }
  return { ...(value as Record<string, unknown>) };
}
