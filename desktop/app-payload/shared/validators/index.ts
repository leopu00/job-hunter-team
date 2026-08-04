/**
 * Modulo validators — validazione input Zod per tutti i moduli
 *
 * Re-esporta schema comuni, credentials, tasks e config.
 */

// Common
export {
  nonEmptyString,
  optionalString,
  emailSchema,
  urlSchema,
  optionalUrl,
  timestampMs,
  optionalTimestamp,
  positiveInt,
  nonNegativeInt,
  hexString,
  uuid,
  enumFromValues,
  validate,
  validateOrThrow,
  type ValidationResult,
} from "./common.js";

// Credentials
export {
  ApiKeyProviderSchema,
  OAuthProviderSchema,
  ProviderSchema,
  CredentialSourceSchema,
  CredentialPrecedenceSchema,
  ApiKeyCredentialSchema,
  OAuthCredentialSchema,
  CredentialSchema,
  EncryptedPayloadSchema,
  SaveApiKeyInput,
  SaveOAuthTokenInput,
  ResolveCredentialInput,
  validateCredential,
  validateEncryptedPayload,
  validateSaveApiKey,
  validateSaveOAuthToken,
  isValidProvider,
  isValidApiKeyProvider,
} from "./credentials.js";

// Tasks
export {
  TaskRuntimeSchema,
  TaskStatusSchema,
  TaskNotifyPolicySchema,
  TaskTerminalOutcomeSchema,
  TaskScopeKindSchema,
  TaskRecordSchema,
  CreateTaskInput,
  UpdateTaskInput,
  TaskEventKindSchema,
  TaskEventRecordSchema,
  TaskStatusCountsSchema,
  TaskRuntimeCountsSchema,
  TaskRegistrySummarySchema,
  TaskStoreSnapshotSchema,
  validateTaskRecord,
  validateCreateTask,
  validateUpdateTask,
  validateTaskSnapshot,
} from "./tasks.js";

// Config (re-export dallo schema esistente)
export {
  SubscriptionSchema,
  AIProviderSchema,
  TelegramChannelSchema,
  ChannelsSchema,
  JHTConfigSchema,
  validateConfig,
} from "../config/schema.js";
