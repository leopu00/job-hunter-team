import type { Locale } from "@/i18n/config";
import { t, apikeyPrefixMsg } from "./setup-i18n";

export type ProviderName = "claude" | "openai" | "kimi";
export type AuthMethod = "api_key" | "subscription";

export interface ModelOption {
  value: string;
  label: string;
  /** Chiave i18n (vedi setup-i18n.ts) risolta a runtime con la locale. */
  hintKey: string;
}

export interface ProviderDef {
  value: ProviderName;
  label: string;
  /** Chiave i18n (vedi setup-i18n.ts) risolta a runtime con la locale. */
  hintKey: string;
  keyPrefix: string;
  keyPlaceholder: string;
  authMethods: AuthMethod[];
  models: ModelOption[];
}

export const PROVIDERS: ProviderDef[] = [
  {
    value: "claude",
    label: "Anthropic — Claude",
    hintKey: "hint_recommended",
    keyPrefix: "sk-ant-",
    keyPlaceholder: "sk-ant-api03-...",
    authMethods: ["api_key"],
    models: [
      {
        value: "claude-sonnet-4-6",
        label: "Claude Sonnet 4.6",
        hintKey: "hint_fast_capable",
      },
      {
        value: "claude-opus-4-6",
        label: "Claude Opus 4.6",
        hintKey: "hint_max_quality",
      },
      {
        value: "claude-haiku-4-5",
        label: "Claude Haiku 4.5",
        hintKey: "hint_cheap_fast",
      },
    ],
  },
  {
    value: "openai",
    label: "OpenAI — GPT",
    hintKey: "hint_openai_models",
    keyPrefix: "sk-",
    keyPlaceholder: "sk-proj-...",
    authMethods: ["api_key"],
    models: [
      {
        value: "gpt-4o",
        label: "GPT-4o",
        hintKey: "hint_fast_capable",
      },
      { value: "o3", label: "o3", hintKey: "hint_advanced_reasoning" },
      { value: "o4-mini", label: "o4-mini", hintKey: "hint_cheap" },
    ],
  },
  {
    value: "kimi",
    label: "Kimi",
    hintKey: "hint_cheap_alt",
    keyPrefix: "",
    keyPlaceholder: "eyJ...",
    authMethods: ["api_key", "subscription"],
    models: [
      {
        value: "kimi-k2-0905-preview",
        label: "Kimi-01",
        hintKey: "hint_main_model",
      },
      { value: "abab6.5s", label: "ABAB 6.5s", hintKey: "hint_cheap" },
    ],
  },
];

export function validateApiKey(
  provider: ProviderDef,
  value: string,
  locale: Locale,
): string | undefined {
  const v = value.trim();
  if (!v) return t("v_apikey_empty", locale);
  if (v.length < 10) return t("v_apikey_short", locale);
  if (provider.keyPrefix && !v.startsWith(provider.keyPrefix))
    return apikeyPrefixMsg(provider.label, provider.keyPrefix, locale);
  return undefined;
}

export function validateEmail(
  value: string,
  locale: Locale,
): string | undefined {
  const v = value.trim();
  if (!v) return t("v_email_empty", locale);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return t("v_email_invalid", locale);
  return undefined;
}

export function validateTelegramToken(
  value: string,
  locale: Locale,
): string | undefined {
  const v = value.trim();
  if (!v) return t("v_token_empty", locale);
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(v)) return t("v_token_invalid", locale);
  return undefined;
}

export function validateChatId(
  value: string,
  locale: Locale,
): string | undefined {
  if (value.trim() && !/^-?\d+$/.test(value.trim()))
    return t("v_chatid_number", locale);
  return undefined;
}
