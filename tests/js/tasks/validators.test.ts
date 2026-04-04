/** Test unitari — shared/validators (vitest): common, credentials, tasks Zod schemas. */
import { describe, it, expect } from "vitest";
import {
  nonEmptyString, optionalString, emailSchema, urlSchema,
  hexString, uuid, timestampMs, positiveInt, nonNegativeInt,
  validate, validateOrThrow, enumFromValues,
} from "../../../shared/validators/common.js";
import {
  validateCredential, validateEncryptedPayload,
  validateSaveApiKey, validateSaveOAuthToken,
  isValidProvider, isValidApiKeyProvider,
  CredentialSchema,
} from "../../../shared/validators/credentials.js";
import {
  validateTaskRecord, validateCreateTask,
  validateUpdateTask, validateTaskSnapshot,
  TaskStatusSchema,
} from "../../../shared/validators/tasks.js";

// --- common.ts: stringhe ---

describe("validators/common — stringhe e numeri", () => {
  it("nonEmptyString: valida dopo trim, rifiuta vuoto", () => {
    expect(nonEmptyString.safeParse("hello").success).toBe(true);
    expect(nonEmptyString.safeParse("  hi  ").data).toBe("hi");
    expect(nonEmptyString.safeParse("").success).toBe(false);
    expect(nonEmptyString.safeParse("   ").success).toBe(false);
  });
  it("optionalString: vuoto → undefined, valore → trimmed", () => {
    expect(optionalString.safeParse("  ciao  ").data).toBe("ciao");
    expect(optionalString.safeParse("").data).toBeUndefined();
    expect(optionalString.safeParse(undefined).success).toBe(true);
  });
  it("emailSchema: valida email corrette, rifiuta invalide", () => {
    expect(emailSchema.safeParse("a@b.com").success).toBe(true);
    expect(emailSchema.safeParse("not-email").success).toBe(false);
    expect(emailSchema.safeParse("").success).toBe(false);
  });
  it("urlSchema: valida URL corrette, rifiuta invalide", () => {
    expect(urlSchema.safeParse("https://example.com").success).toBe(true);
    expect(urlSchema.safeParse("not-a-url").success).toBe(false);
  });
  it("timestampMs, positiveInt, nonNegativeInt", () => {
    expect(timestampMs.safeParse(Date.now()).success).toBe(true);
    expect(timestampMs.safeParse(-1).success).toBe(false);
    expect(timestampMs.safeParse(0).success).toBe(false);
    expect(positiveInt.safeParse(1).success).toBe(true);
    expect(positiveInt.safeParse(0).success).toBe(false);
    expect(nonNegativeInt.safeParse(0).success).toBe(true);
    expect(nonNegativeInt.safeParse(-1).success).toBe(false);
  });
});

describe("validators/common — hex, uuid, enum", () => {
  it("hexString: accetta pari, rifiuta dispari e non-hex", () => {
    expect(hexString.safeParse("abcdef").success).toBe(true);
    expect(hexString.safeParse("0123456789abcdef").success).toBe(true);
    expect(hexString.safeParse("abc").success).toBe(false); // dispari
    expect(hexString.safeParse("ghij").success).toBe(false); // non-hex
  });
  it("uuid: accetta v4 valido, rifiuta stringa casuale", () => {
    expect(uuid.safeParse("550e8400-e29b-41d4-a716-446655440000").success).toBe(true);
    expect(uuid.safeParse("not-a-uuid").success).toBe(false);
  });
  it("enumFromValues: accetta valori nell'enum, rifiuta altri", () => {
    const schema = enumFromValues(["a", "b", "c"] as const, "Test enum");
    expect(schema.safeParse("a").success).toBe(true);
    expect(schema.safeParse("z").success).toBe(false);
  });
});

describe("validators/common — validate e validateOrThrow", () => {
  it("validate: success con dati validi, errors con invalidi", () => {
    const r1 = validate(nonEmptyString, "hello");
    expect(r1.success).toBe(true);
    if (r1.success) expect(r1.data).toBe("hello");
    const r2 = validate(nonEmptyString, "");
    expect(r2.success).toBe(false);
    if (!r2.success) expect(r2.errors.length).toBeGreaterThan(0);
  });
  it("validateOrThrow: ritorna dato valido, lancia con label su invalido", () => {
    expect(validateOrThrow(positiveInt, 42)).toBe(42);
    expect(() => validateOrThrow(positiveInt, -1, "Età")).toThrow("Età");
  });
});

// --- credentials.ts ---

describe("validators/credentials — schema e funzioni", () => {
  it("validateCredential: api_key valida", () => {
    const r = validateCredential({ type: "api_key", provider: "claude", apiKey: "sk-test", savedAt: Date.now() });
    expect(r.success).toBe(true);
  });
  it("validateCredential: oauth valida", () => {
    const r = validateCredential({ type: "oauth", provider: "chatgpt_pro", accessToken: "tok", savedAt: Date.now() });
    expect(r.success).toBe(true);
  });
  it("validateCredential: type invalido → errore", () => {
    const r = validateCredential({ type: "invalid", provider: "claude", apiKey: "k", savedAt: 1 });
    expect(r.success).toBe(false);
  });
  it("validateCredential: provider invalido → errore", () => {
    const r = validateCredential({ type: "api_key", provider: "fake", apiKey: "k", savedAt: Date.now() });
    expect(r.success).toBe(false);
  });
  it("validateEncryptedPayload: valida e invalida", () => {
    const valid = { version: 1, algorithm: "aes-256-gcm", iv: "aabb", authTag: "ccdd", data: "eeff" };
    expect(validateEncryptedPayload(valid).success).toBe(true);
    expect(validateEncryptedPayload({ ...valid, iv: "abc" }).success).toBe(false); // dispari
    expect(validateEncryptedPayload({ ...valid, version: 2 }).success).toBe(false);
  });
  it("validateSaveApiKey: valida e invalida", () => {
    expect(validateSaveApiKey({ provider: "openai", apiKey: "sk-123" }).success).toBe(true);
    expect(validateSaveApiKey({ provider: "fake", apiKey: "sk" }).success).toBe(false);
  });
  it("validateSaveOAuthToken: valida con campi opzionali", () => {
    const r = validateSaveOAuthToken({ provider: "claude_max", accessToken: "tok", refreshToken: "ref", expiresAt: Date.now() + 3600000 });
    expect(r.success).toBe(true);
  });
  it("isValidProvider e isValidApiKeyProvider", () => {
    expect(isValidProvider("claude")).toBe(true);
    expect(isValidProvider("chatgpt_pro")).toBe(true);
    expect(isValidProvider("fake")).toBe(false);
    expect(isValidApiKeyProvider("claude")).toBe(true);
    expect(isValidApiKeyProvider("chatgpt_pro")).toBe(false); // è oauth
  });
});

// --- tasks.ts ---

describe("validators/tasks — schema e funzioni", () => {
  const validTask = {
    taskId: "550e8400-e29b-41d4-a716-446655440000",
    runtime: "cli", ownerKey: "web", scopeKind: "session",
    task: "test task", status: "queued", notifyPolicy: "done_only",
    createdAt: Date.now(),
  };
  it("validateTaskRecord: record completo valido", () => {
    expect(validateTaskRecord(validTask).success).toBe(true);
  });
  it("validateTaskRecord: taskId non-uuid → errore", () => {
    expect(validateTaskRecord({ ...validTask, taskId: "not-uuid" }).success).toBe(false);
  });
  it("validateCreateTask: defaults applicati (scopeKind, notifyPolicy, status)", () => {
    const r = validateCreateTask({ runtime: "subagent", ownerKey: "agent-1", task: "do stuff" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.scopeKind).toBe("session");
      expect(r.data.notifyPolicy).toBe("done_only");
      expect(r.data.status).toBe("queued");
    }
  });
  it("validateCreateTask: runtime invalido → errore", () => {
    expect(validateCreateTask({ runtime: "invalid", ownerKey: "x", task: "y" }).success).toBe(false);
  });
  it("validateUpdateTask: almeno un campo → ok", () => {
    expect(validateUpdateTask({ status: "running" }).success).toBe(true);
    expect(validateUpdateTask({ progressSummary: "50%" }).success).toBe(true);
  });
  it("validateUpdateTask: oggetto vuoto → errore (refinement)", () => {
    const r = validateUpdateTask({});
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors[0]).toContain("Almeno un campo");
  });
  it("validateTaskSnapshot: snapshot versioned valido", () => {
    const r = validateTaskSnapshot({ version: 1, updatedAt: Date.now(), tasks: [validTask] });
    expect(r.success).toBe(true);
  });
  it("validateTaskSnapshot: version !== 1 → errore", () => {
    expect(validateTaskSnapshot({ version: 2, updatedAt: 1, tasks: [] }).success).toBe(false);
  });
  it("TaskStatusSchema accetta tutti i 7 stati", () => {
    for (const s of ["queued", "running", "succeeded", "failed", "timed_out", "cancelled", "lost"]) {
      expect(TaskStatusSchema.safeParse(s).success, `stato ${s}`).toBe(true);
    }
    expect(TaskStatusSchema.safeParse("invalid").success).toBe(false);
  });
});
