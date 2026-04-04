/**
 * JHT Config — Modulo centralizzato di configurazione
 *
 * Esporta types, schema Zod, e utilities IO per ~/.jht/jht.config.json
 */

export type {
  AIProviderName,
  AuthMethod,
  AIProviderConfig,
  SubscriptionConfig,
  ChannelName,
  TelegramChannelConfig,
  ChannelsConfig,
  JHTConfig,
} from "./types";

export {
  JHTConfigSchema,
  AIProviderSchema,
  TelegramChannelSchema,
  ChannelsSchema,
  SubscriptionSchema,
  validateConfig,
} from "./schema";
export type { JHTConfigInput, JHTConfigParsed } from "./schema";

export {
  readConfig,
  writeConfig,
  configExists,
  redactConfig,
  parseJson5,
  onConfigChange,
  JHT_CONFIG_DIR,
  JHT_CONFIG_PATH,
} from "./io";

export {
  resolveSecret,
  createSecretRef,
  describeSecret,
} from "./secret-ref";
export type {
  SecretRef,
  SecretPlaintext,
  SecretEnvRef,
  SecretFileRef,
  SecretExecRef,
} from "./secret-ref";
