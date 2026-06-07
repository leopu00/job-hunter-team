"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useLocale } from "@/lib/use-locale";
import {
  AI_ASSISTANT_SUGGESTIONS,
  loadStoredAssistantHistory,
  saveStoredAssistantHistory,
  type AssistantChatMessage,
  type AssistantSuggestion,
} from "@/lib/ai-assistant";

const T: Record<string, Record<string, string>> = {
  close_chat: {
    it: "Chiudi chat",
    en: "Close chat",
    hu: "Csevegés bezárása",
    es: "Cerrar chat",
    de: "Chat schließen",
    fr: "Fermer le chat",
    pt: "Fechar chat",
  },
  open_assistant: {
    it: "Apri AI Assistant",
    en: "Open AI Assistant",
    hu: "AI Asszisztens megnyitása",
    es: "Abrir AI Assistant",
    de: "AI Assistant öffnen",
    fr: "Ouvrir l'AI Assistant",
    pt: "Abrir AI Assistant",
  },
  panel_label: {
    it: "Chat AI Assistant",
    en: "AI Assistant chat",
    hu: "AI Asszisztens csevegés",
    es: "Chat de AI Assistant",
    de: "AI Assistant Chat",
    fr: "Chat AI Assistant",
    pt: "Chat do AI Assistant",
  },
  close: {
    it: "Chiudi",
    en: "Close",
    hu: "Bezárás",
    es: "Cerrar",
    de: "Schließen",
    fr: "Fermer",
    pt: "Fechar",
  },
  offline: {
    it: "offline",
    en: "offline",
    hu: "offline",
    es: "sin conexión",
    de: "offline",
    fr: "hors ligne",
    pt: "offline",
  },
  online: {
    it: "online",
    en: "online",
    hu: "online",
    es: "en línea",
    de: "online",
    fr: "en ligne",
    pt: "online",
  },
  not_active: {
    it: "Chatbot non attivo: manca `OPENAI_API_KEY` sul server.",
    en: "Chatbot not active: `OPENAI_API_KEY` is missing on the server.",
    hu: "A chatbot nem aktív: hiányzik az `OPENAI_API_KEY` a szerveren.",
    es: "Chatbot no activo: falta `OPENAI_API_KEY` en el servidor.",
    de: "Chatbot nicht aktiv: `OPENAI_API_KEY` fehlt auf dem Server.",
    fr: "Chatbot inactif : `OPENAI_API_KEY` est manquant sur le serveur.",
    pt: "Chatbot inativo: falta `OPENAI_API_KEY` no servidor.",
  },
  intro: {
    it: "Ti aiuto a capire la piattaforma e da dove iniziare.",
    en: "I help you understand the platform and where to start.",
    hu: "Segítek megérteni a platformot, és hogy hol kezdd.",
    es: "Te ayudo a entender la plataforma y por dónde empezar.",
    de: "Ich helfe dir, die Plattform zu verstehen und wo du anfangen sollst.",
    fr: "Je vous aide à comprendre la plateforme et par où commencer.",
    pt: "Ajudo você a entender a plataforma e por onde começar.",
  },
  thinking: {
    it: "Sto pensando...",
    en: "Thinking...",
    hu: "Gondolkodom...",
    es: "Pensando...",
    de: "Ich denke nach...",
    fr: "Réflexion...",
    pt: "Pensando...",
  },
  placeholder_unconfigured: {
    it: "Chatbot non configurato",
    en: "Chatbot not configured",
    hu: "A chatbot nincs beállítva",
    es: "Chatbot no configurado",
    de: "Chatbot nicht konfiguriert",
    fr: "Chatbot non configuré",
    pt: "Chatbot não configurado",
  },
  placeholder_message: {
    it: "Scrivi un messaggio...",
    en: "Write a message...",
    hu: "Írj egy üzenetet...",
    es: "Escribe un mensaje...",
    de: "Schreibe eine Nachricht...",
    fr: "Écrivez un message...",
    pt: "Escreva uma mensagem...",
  },
  input_label: {
    it: "Scrivi un messaggio all'assistente",
    en: "Write a message to the assistant",
    hu: "Írj üzenetet az asszisztensnek",
    es: "Escribe un mensaje al asistente",
    de: "Schreibe eine Nachricht an den Assistenten",
    fr: "Écrivez un message à l'assistant",
    pt: "Escreva uma mensagem ao assistente",
  },
  send: {
    it: "Invia messaggio",
    en: "Send message",
    hu: "Üzenet küldése",
    es: "Enviar mensaje",
    de: "Nachricht senden",
    fr: "Envoyer le message",
    pt: "Enviar mensagem",
  },
  reply_error: {
    it: "Il chatbot non è riuscito a rispondere in questo momento.",
    en: "The chatbot was unable to respond at this time.",
    hu: "A chatbot most nem tudott válaszolni.",
    es: "El chatbot no pudo responder en este momento.",
    de: "Der Chatbot konnte momentan nicht antworten.",
    fr: "Le chatbot n'a pas pu répondre pour le moment.",
    pt: "O chatbot não conseguiu responder neste momento.",
  },
};

type AssistantBootstrap = {
  suggestions?: AssistantSuggestion[];
  configured?: boolean;
  model?: string;
};

type Message = AssistantChatMessage;
type Suggestion = AssistantSuggestion;

export default function FloatingChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  const [suggestions, setSuggestions] = useState<AssistantSuggestion[]>(
    AI_ASSISTANT_SUGGESTIONS,
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [model, setModel] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;

  const fetchHistory = useCallback(async () => {
    setMessages(loadStoredAssistantHistory());
    const res = await fetch("/api/ai-assistant").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as AssistantBootstrap;
    setSuggestions(data.suggestions ?? AI_ASSISTANT_SUGGESTIONS);
    setConfigured(data.configured ?? false);
    setModel(data.model ?? "");
  }, []);

  useEffect(() => {
    if (open) fetchHistory();
  }, [open, fetchHistory]);
  useEffect(() => {
    if (open) scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages, open]);
  useEffect(() => {
    saveStoredAssistantHistory(messages);
  }, [messages]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    if (configured === false) return;

    const previousHistory = messages;
    const userMessage: AssistantChatMessage = {
      role: "user",
      content: msg,
      timestamp: Date.now(),
    };
    setInput("");
    setSending(true);
    setMessages((prev) => [...prev, userMessage]);
    const res = await fetch("/api/ai-assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: msg,
        history: previousHistory,
        path: window.location.pathname,
      }),
    }).catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply, timestamp: data.timestamp },
      ]);
    } else {
      const data = await res?.json().catch(() => null);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data?.error ?? tr("reply_error"),
          timestamp: Date.now(),
        },
      ]);
      if (typeof data?.configured === "boolean") setConfigured(data.configured);
    }
    setSending(false);
  };

  return (
    <>
      <style>{`
        @keyframes chat-slide-up {
          from { opacity: 0; transform: translateY(12px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      {/* Floating button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full flex items-center justify-center shadow-lg cursor-pointer border-0 transition-all hover:opacity-90"
        style={{
          background: "var(--color-green)",
          color: "var(--color-void)",
          zIndex: 60,
        }}
        aria-label={open ? tr("close_chat") : tr("open_assistant")}
      >
        {open ? (
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div
          role="complementary"
          aria-label={tr("panel_label")}
          className="fixed bottom-24 right-6 w-96 flex flex-col rounded-xl overflow-hidden shadow-2xl"
          style={{
            maxHeight: 560,
            zIndex: 60,
            animation: "chat-slide-up 0.25s ease both",
            background: "var(--color-deep)",
            border: "1px solid var(--color-border)",
          }}
        >
          {/* Header */}
          <div
            className="px-4 py-3 flex items-center justify-between flex-shrink-0"
            style={{ borderBottom: "1px solid var(--color-border)" }}
          >
            <div className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: "var(--color-green)" }}
              />
              <span
                className="text-[11px] font-bold tracking-widest uppercase"
                style={{ color: "var(--color-white)" }}
              >
                AI Assistant
              </span>
            </div>
            <div
              className="text-[9px]"
              style={{
                color:
                  configured === false
                    ? "var(--color-yellow)"
                    : "var(--color-dim)",
              }}
            >
              {configured === false ? tr("offline") : model || tr("online")}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="cursor-pointer bg-transparent border-0 p-0 flex items-center"
              style={{ color: "var(--color-dim)" }}
              aria-label={tr("close")}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                aria-hidden="true"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-4 min-h-0"
            aria-live="polite"
            style={{ minHeight: 200 }}
          >
            {configured === false && (
              <div
                className="mb-4 rounded-lg p-3 text-[11px]"
                style={{
                  background: "rgba(245,197,24,0.08)",
                  color: "var(--color-muted)",
                  border: "1px solid rgba(245,197,24,0.24)",
                }}
              >
                {tr("not_active")}
              </div>
            )}
            {messages.length === 0 && (
              <div className="text-center py-8">
                <p
                  className="text-[12px] mb-4"
                  style={{ color: "var(--color-dim)" }}
                >
                  {tr("intro")}
                </p>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {suggestions.map((s) => (
                    <button
                      key={s.label}
                      onClick={() => send(s.prompt)}
                      disabled={configured === false}
                      className="px-3 py-1.5 rounded-lg text-[10px] cursor-pointer transition-colors"
                      style={{
                        background: "var(--color-row)",
                        color: "var(--color-muted)",
                        border: "1px solid var(--color-border)",
                        opacity: configured === false ? 0.45 : 1,
                      }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex mb-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className="max-w-[80%] px-3 py-2 rounded-lg text-[11px] leading-relaxed"
                  style={
                    m.role === "user"
                      ? {
                          background: "var(--color-green)",
                          color: "#000",
                          borderBottomRightRadius: 2,
                        }
                      : {
                          background: "var(--color-row)",
                          color: "var(--color-muted)",
                          border: "1px solid var(--color-border)",
                          borderBottomLeftRadius: 2,
                        }
                  }
                >
                  {m.content}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start mb-3">
                <div
                  className="px-3 py-2 rounded-lg"
                  style={{ background: "var(--color-row)" }}
                >
                  <span
                    className="text-[11px]"
                    style={{ color: "var(--color-dim)" }}
                  >
                    {tr("thinking")}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Suggestions (compact) */}
          {messages.length > 0 && suggestions.length > 0 && (
            <div className="flex gap-1 px-3 pb-2 flex-wrap">
              {suggestions.map((s) => (
                <button
                  key={s.label}
                  onClick={() => send(s.prompt)}
                  disabled={configured === false}
                  className="px-2 py-0.5 rounded text-[8px] cursor-pointer"
                  style={{
                    background: "var(--color-row)",
                    color: "var(--color-dim)",
                    border: "1px solid var(--color-border)",
                    opacity: configured === false ? 0.45 : 1,
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div
            className="p-3 flex gap-2 flex-shrink-0"
            style={{ borderTop: "1px solid var(--color-border)" }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder={
                configured === false
                  ? tr("placeholder_unconfigured")
                  : tr("placeholder_message")
              }
              aria-label={tr("input_label")}
              disabled={configured === false}
              className="flex-1 text-[11px] px-3 py-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-green)]"
              style={{
                background: "var(--color-row)",
                color: "var(--color-muted)",
                border: "1px solid var(--color-border)",
                opacity: configured === false ? 0.55 : 1,
              }}
            />
            <button
              onClick={() => send()}
              disabled={sending || !input.trim() || configured === false}
              aria-label={tr("send")}
              className="px-4 py-2 rounded-lg text-[11px] font-bold cursor-pointer transition-colors"
              style={{
                background:
                  input.trim() && configured !== false
                    ? "var(--color-green)"
                    : "var(--color-border)",
                color:
                  input.trim() && configured !== false
                    ? "#000"
                    : "var(--color-dim)",
              }}
            >
              <span aria-hidden="true">↑</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
