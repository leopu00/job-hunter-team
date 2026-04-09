/**
 * JHT TUI Client — implementazione JhtChatClient che chiama il provider della workspace corrente.
 */
import type { JhtChatClient } from "./tui-command-handlers.js";
import type { JhtAgent, ChatEvent } from "./tui-types.js";
import { loadWorkspaceApiKey, loadWorkspaceProviderConfig, type WorkspaceProviderConfig } from "./tui-profile.js";

const SYSTEM_PROMPT = `Sei l'assistente AI del Job Hunter Team. Aiuti l'utente nella ricerca lavoro: scrivi cover letter, prepari colloqui, analizzi offerte, ottimizzi CV. Rispondi in italiano, sii conciso e pratico.`;

export function loadApiKey(): string | null {
  return loadWorkspaceApiKey();
}

export function loadProviderConfig(): WorkspaceProviderConfig | null {
  return loadWorkspaceProviderConfig();
}

type ConversationMessage = { role: "user" | "assistant"; content: string };

export type ChatEventCallback = (event: ChatEvent) => void;

export function createTuiClient(
  onChatEvent: ChatEventCallback,
  apiKeyOverride?: string,
  providerOverride?: WorkspaceProviderConfig["provider"],
): JhtChatClient & { history: ConversationMessage[] } {
  const resolvedProvider = loadProviderConfig();
  const providerConfig = resolvedProvider
    ? { ...resolvedProvider, apiKey: apiKeyOverride ?? resolvedProvider.apiKey, provider: providerOverride ?? resolvedProvider.provider }
    : null;
  if (!providerConfig?.apiKey) throw new Error("provider API non configurato per questa cartella");

  const abortControllers = new Map<string, AbortController>();
  const history: ConversationMessage[] = [];

  const sendAnthropic = async (params: { message: string; runId: string; sessionKey: string }) => {
    const { message, runId, sessionKey } = params;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": providerConfig.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: providerConfig.model,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        stream: true,
        messages: history.slice(-20),
      }),
      signal: abortControllers.get(runId)?.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`API ${res.status}: ${errBody.slice(0, 200)}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let fullText = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);
          if (parsed.type === "content_block_delta" && parsed.delta?.text) {
            fullText += parsed.delta.text;
            onChatEvent({ runId, sessionKey, state: "delta", message: { text: fullText, content: fullText } });
          }
        } catch {
          // ignore malformed SSE chunks
        }
      }
    }

    return fullText;
  };

  const sendOpenAICompatible = async (params: { message: string; runId: string; sessionKey: string }) => {
    const { runId, sessionKey } = params;
    const baseUrl = providerConfig.baseUrl ?? "https://api.openai.com/v1";
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${providerConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: providerConfig.model,
        stream: true,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...history.slice(-20),
        ],
      }),
      signal: abortControllers.get(runId)?.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`API ${res.status}: ${errBody.slice(0, 200)}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let fullText = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data || data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            fullText += delta;
            onChatEvent({ runId, sessionKey, state: "delta", message: { text: fullText, content: fullText } });
          }
        } catch {
          // ignore malformed SSE chunks
        }
      }
    }

    return fullText;
  };

  const sendChat: JhtChatClient["sendChat"] = async (params) => {
    const { message, runId, sessionKey } = params;
    history.push({ role: "user", content: message });

    const controller = new AbortController();
    abortControllers.set(runId, controller);

    try {
      const fullText = providerConfig.provider === "anthropic"
        ? await sendAnthropic({ message, runId, sessionKey })
        : await sendOpenAICompatible({ message, runId, sessionKey });

      history.push({ role: "assistant", content: fullText });
      onChatEvent({
        runId, sessionKey,
        state: "final",
        message: { text: fullText, content: fullText, stopReason: "end_turn" },
      });
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") {
        onChatEvent({ runId, sessionKey, state: "aborted" });
      } else {
        history.pop(); // rimuovi il messaggio user fallito
        onChatEvent({
          runId, sessionKey,
          state: "error",
          errorMessage: String((err as Error).message ?? err),
        });
      }
    } finally {
      abortControllers.delete(runId);
    }
  };

  const getStatus: JhtChatClient["getStatus"] = async () => ({
    runtimeVersion: "jht-tui-client 1.0",
    isConnected: true,
    activeRuns: abortControllers.size,
    model: providerConfig.model,
    provider: providerConfig.provider,
    historyLength: history.length,
  });

  const abortRun: JhtChatClient["abortRun"] = async (_sessionKey) => {
    for (const [, ctrl] of abortControllers) ctrl.abort();
  };

  const listAgents: JhtChatClient["listAgents"] = async () => {
    const roles = ["scout", "analista", "assistente", "critico", "scorer", "scrittore", "sentinella", "alfa"];
    return roles.map<JhtAgent>(r => ({ id: r, name: r, role: r, status: "idle" }));
  };

  return { sendChat, getStatus, abortRun, listAgents, history };
}
