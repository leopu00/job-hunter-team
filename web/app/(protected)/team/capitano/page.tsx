"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, useCallback } from "react";
import { useDevMode } from "@/components/SettingsMenu";
import { useTeamCommandPoller } from "@/app/hooks/useTeamCommandPoller";
import { useLocale } from "@/lib/use-locale";
import { useIsCloud } from "@/app/hooks/useIsCloud";

const ACCENT = "#ff9100";

const T: Record<string, Record<string, string>> = {
  sending: {
    it: "Invio…",
    en: "Sending…",
    hu: "Küldés…",
    es: "Enviando…",
    de: "Senden…",
    fr: "Envoi…",
    pt: "Enviando…",
  },
  queuedVps: {
    it: "In coda sulla VPS…",
    en: "Queued on the VPS…",
    hu: "Sorban a VPS-en…",
    es: "En cola en el VPS…",
    de: "In Warteschlange auf dem VPS…",
    fr: "En file d'attente sur le VPS…",
    pt: "Na fila no VPS…",
  },
  starting: {
    it: "Avvio in corso…",
    en: "Starting…",
    hu: "Indítás folyamatban…",
    es: "Iniciando…",
    de: "Wird gestartet…",
    fr: "Démarrage en cours…",
    pt: "Iniciando…",
  },
  startCaptain: {
    it: "Avvia Capitano",
    en: "Start Captain",
    hu: "Kapitány indítása",
    es: "Iniciar Capitán",
    de: "Kapitän starten",
    fr: "Démarrer le Capitaine",
    pt: "Iniciar Capitão",
  },
  timeoutSubscriber: {
    it: "Timeout: il subscriber sulla VPS non risponde.",
    en: "Timeout: the subscriber on the VPS is not responding.",
    hu: "Időtúllépés: a VPS-en lévő feliratkozó nem válaszol.",
    es: "Tiempo agotado: el suscriptor en el VPS no responde.",
    de: "Zeitüberschreitung: Der Subscriber auf dem VPS antwortet nicht.",
    fr: "Délai dépassé : l'abonné sur le VPS ne répond pas.",
    pt: "Tempo esgotado: o subscriber no VPS não responde.",
  },
  chatCaptain: {
    it: "chat · capitano",
    en: "chat · captain",
    hu: "chat · kapitány",
    es: "chat · capitán",
    de: "Chat · Kapitän",
    fr: "chat · capitaine",
    pt: "chat · capitão",
  },
  clear: {
    it: "pulisci",
    en: "clear",
    hu: "törlés",
    es: "limpiar",
    de: "leeren",
    fr: "effacer",
    pt: "limpar",
  },
  exit: {
    it: "esci",
    en: "exit",
    hu: "kilépés",
    es: "salir",
    de: "schließen",
    fr: "quitter",
    pt: "sair",
  },
  expand: {
    it: "espandi",
    en: "expand",
    hu: "kibontás",
    es: "ampliar",
    de: "erweitern",
    fr: "agrandir",
    pt: "expandir",
  },
  chatMessages: {
    it: "Messaggi chat",
    en: "Chat messages",
    hu: "Chat üzenetek",
    es: "Mensajes del chat",
    de: "Chat-Nachrichten",
    fr: "Messages du chat",
    pt: "Mensagens do chat",
  },
  writeToStart: {
    it: "Scrivi un messaggio per iniziare la conversazione.",
    en: "Write a message to start the conversation.",
    hu: "Írj egy üzenetet a beszélgetés megkezdéséhez.",
    es: "Escribe un mensaje para iniciar la conversación.",
    de: "Schreibe eine Nachricht, um das Gespräch zu beginnen.",
    fr: "Écris un message pour démarrer la conversation.",
    pt: "Escreva uma mensagem para iniciar a conversa.",
  },
  sendToCaptain: {
    it: "Invia messaggio al capitano",
    en: "Send message to the captain",
    hu: "Üzenet küldése a kapitánynak",
    es: "Enviar mensaje al capitán",
    de: "Nachricht an den Kapitän senden",
    fr: "Envoyer un message au capitaine",
    pt: "Enviar mensagem ao capitão",
  },
  inputPlaceholder: {
    it: "Scrivi un messaggio...",
    en: "Write a message...",
    hu: "Írj egy üzenetet...",
    es: "Escribe un mensaje...",
    de: "Nachricht schreiben...",
    fr: "Écris un message...",
    pt: "Escreva uma mensagem...",
  },
  send: {
    it: "invia",
    en: "send",
    hu: "küldés",
    es: "enviar",
    de: "senden",
    fr: "envoyer",
    pt: "enviar",
  },
  terminal: {
    it: "Terminale",
    en: "Terminal",
    hu: "Terminál",
    es: "Terminal",
    de: "Terminal",
    fr: "Terminal",
    pt: "Terminal",
  },
  captainSession: {
    it: "sessione CAPITANO",
    en: "CAPTAIN session",
    hu: "KAPITÁNY munkamenet",
    es: "sesión CAPITÁN",
    de: "KAPITÄN-Sitzung",
    fr: "session CAPITAINE",
    pt: "sessão CAPITÃO",
  },
  noOutput: {
    it: "nessun output…",
    en: "no output…",
    hu: "nincs kimenet…",
    es: "sin salida…",
    de: "keine Ausgabe…",
    fr: "aucune sortie…",
    pt: "sem saída…",
  },
  dashboard: {
    it: "Dashboard",
    en: "Dashboard",
    hu: "Irányítópult",
    es: "Panel",
    de: "Dashboard",
    fr: "Tableau de bord",
    pt: "Painel",
  },
  team: {
    it: "Team",
    en: "Team",
    hu: "Csapat",
    es: "Equipo",
    de: "Team",
    fr: "Équipe",
    pt: "Equipe",
  },
  captain: {
    it: "Capitano",
    en: "Captain",
    hu: "Kapitány",
    es: "Capitán",
    de: "Kapitän",
    fr: "Capitaine",
    pt: "Capitão",
  },
  orchestrates: {
    it: "Orchestra tutta la pipeline Job Hunter",
    en: "Orchestrates the entire Job Hunter pipeline",
    hu: "A teljes Job Hunter folyamatot vezényli",
    es: "Orquesta todo el pipeline de Job Hunter",
    de: "Orchestriert die gesamte Job-Hunter-Pipeline",
    fr: "Orchestre tout le pipeline Job Hunter",
    pt: "Orquestra todo o pipeline do Job Hunter",
  },
  connecting: {
    it: "connessione…",
    en: "connecting…",
    hu: "kapcsolódás…",
    es: "conectando…",
    de: "verbinde…",
    fr: "connexion…",
    pt: "conectando…",
  },
  active: {
    it: "attivo",
    en: "active",
    hu: "aktív",
    es: "activo",
    de: "aktiv",
    fr: "actif",
    pt: "ativo",
  },
  inactive: {
    it: "inattivo",
    en: "inactive",
    hu: "inaktív",
    es: "inactivo",
    de: "inaktiv",
    fr: "inactif",
    pt: "inativo",
  },
  stopping: {
    it: "Fermando…",
    en: "Stopping…",
    hu: "Leállítás…",
    es: "Deteniendo…",
    de: "Wird gestoppt…",
    fr: "Arrêt…",
    pt: "Parando…",
  },
  stop: {
    it: "Ferma",
    en: "Stop",
    hu: "Leállítás",
    es: "Detener",
    de: "Stoppen",
    fr: "Arrêter",
    pt: "Parar",
  },
  hideTerminal: {
    it: "nascondi terminale",
    en: "hide terminal",
    hu: "terminál elrejtése",
    es: "ocultar terminal",
    de: "Terminal ausblenden",
    fr: "masquer le terminal",
    pt: "ocultar terminal",
  },
  showTerminal: {
    it: "mostra terminale",
    en: "show terminal",
    hu: "terminál megjelenítése",
    es: "mostrar terminal",
    de: "Terminal anzeigen",
    fr: "afficher le terminal",
    pt: "mostrar terminal",
  },
  openTerminal: {
    it: "apri terminale",
    en: "open terminal",
    hu: "terminál megnyitása",
    es: "abrir terminal",
    de: "Terminal öffnen",
    fr: "ouvrir le terminal",
    pt: "abrir terminal",
  },
  openPowershell: {
    it: "apri powershell",
    en: "open powershell",
    hu: "powershell megnyitása",
    es: "abrir powershell",
    de: "PowerShell öffnen",
    fr: "ouvrir powershell",
    pt: "abrir powershell",
  },
  captainNotActive: {
    it: "Il Capitano non è attivo.",
    en: "The Captain is not active.",
    hu: "A Kapitány nem aktív.",
    es: "El Capitán no está activo.",
    de: "Der Kapitän ist nicht aktiv.",
    fr: "Le Capitaine n'est pas actif.",
    pt: "O Capitão não está ativo.",
  },
  pressStartPrefix: {
    it: "Premi ",
    en: "Press ",
    hu: "Nyomd meg: ",
    es: "Pulsa ",
    de: "Drücke ",
    fr: "Appuie sur ",
    pt: "Pressione ",
  },
  pressStartSuffix: {
    it: " per avviare la sessione.",
    en: " to start the session.",
    hu: " a munkamenet indításához.",
    es: " para iniciar la sesión.",
    de: ", um die Sitzung zu starten.",
    fr: " pour démarrer la session.",
    pt: " para iniciar a sessão.",
  },
};

type Status = { active: boolean; output: string };
type ChatMsg = { role: "user" | "assistant"; text: string; ts: number };

/** Render markdown leggero: **bold**, *italic*, `code` */
function renderMarkdown(text: string) {
  const parts = text.split(/(`[^`]+`)/);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          style={{
            background: "rgba(255,255,255,0.1)",
            padding: "1px 4px",
            borderRadius: "3px",
            fontSize: "11px",
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    const boldParts = part.split(/(\*\*[^*]+\*\*)/);
    return boldParts.map((bp, j) => {
      if (bp.startsWith("**") && bp.endsWith("**")) {
        return <strong key={`${i}-${j}`}>{bp.slice(2, -2)}</strong>;
      }
      const italicParts = bp.split(/(\*[^*]+\*)/);
      return italicParts.map((ip, k) => {
        if (ip.startsWith("*") && ip.endsWith("*")) {
          return <em key={`${i}-${j}-${k}`}>{ip.slice(1, -1)}</em>;
        }
        return <span key={`${i}-${j}-${k}`}>{ip}</span>;
      });
    });
  });
}

const LOCALE_TAG: Record<string, string> = {
  it: "it-IT",
  en: "en-GB",
  hu: "hu-HU",
  es: "es-ES",
  de: "de-DE",
  fr: "fr-FR",
  pt: "pt-PT",
};

export default function CapitanoPage() {
  const isCloud = useIsCloud();
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
  const localeTag = LOCALE_TAG[locale] ?? "en-GB";
  const [status, setStatus] = useState<Status | null>(null);
  const startCmd = useTeamCommandPoller();
  const stopCmd = useTeamCommandPoller();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [chatFullscreen, setChatFullscreen] = useState(false);
  const devMode = useDevMode();

  // Se dev mode si spegne e il terminale era aperto, chiudilo.
  useEffect(() => {
    if (!devMode) setShowTerminal(false);
  }, [devMode]);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Blocca scroll body in fullscreen
  useEffect(() => {
    document.body.style.overflow = chatFullscreen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [chatFullscreen]);

  const isActive = status?.active ?? false;

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/capitano/status");
      const data: Status = await res.json();
      setStatus(data);
    } catch {
      setStatus({ active: false, output: "" });
    }
  }, []);

  const fetchChat = useCallback(async () => {
    try {
      const res = await fetch("/api/capitano/chat?after=0");
      const data = await res.json();
      if (data.messages) setMessages(data.messages);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchChat();
    if (isCloud) return;
    const statusId = setInterval(fetchStatus, 5000);
    const chatId = setInterval(fetchChat, 3000);
    return () => {
      clearInterval(statusId);
      clearInterval(chatId);
    };
  }, [fetchStatus, fetchChat, isCloud]);

  // Scroll chat in fondo solo quando arrivano nuovi messaggi
  const prevMsgCountRef = useRef(0);
  useEffect(() => {
    if (messages.length > prevMsgCountRef.current) {
      const container = chatEndRef.current?.parentElement;
      if (container) container.scrollTop = container.scrollHeight;
    }
    prevMsgCountRef.current = messages.length;
  }, [messages]);

  // Scroll terminale in fondo
  useEffect(() => {
    if (termRef.current)
      termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [status?.output, showTerminal]);

  const handleStart = () => startCmd.run("/api/capitano/start");
  const handleStop = () => stopCmd.run("/api/capitano/stop");

  useEffect(() => {
    if (startCmd.state === "done" || startCmd.state === "local") fetchStatus();
  }, [startCmd.state, fetchStatus]);
  useEffect(() => {
    if (stopCmd.state === "done" || stopCmd.state === "local") fetchStatus();
  }, [stopCmd.state, fetchStatus]);

  const startBusy =
    startCmd.state === "posting" ||
    startCmd.state === "pending" ||
    startCmd.state === "running";
  const stopBusy =
    stopCmd.state === "posting" ||
    stopCmd.state === "pending" ||
    stopCmd.state === "running";
  const startLabel =
    startCmd.state === "posting"
      ? tr("sending")
      : startCmd.state === "pending"
        ? tr("queuedVps")
        : startCmd.state === "running"
          ? tr("starting")
          : tr("startCaptain");
  const startBanner =
    startCmd.error ||
    (startCmd.state === "timeout" ? tr("timeoutSubscriber") : null) ||
    startCmd.message ||
    stopCmd.error ||
    stopCmd.message;

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    setSending(true);
    const text = input.trim();
    setInput("");
    try {
      await fetch("/api/capitano/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      await fetchChat();
    } catch {
      /* ignore */
    }
    setSending(false);
    inputRef.current?.focus();
  };

  const chatContent = (
    <div
      style={{
        ...(chatFullscreen
          ? {
              position: "fixed" as const,
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 9999,
              background: "#0d1117",
              display: "flex",
              flexDirection: "column" as const,
            }
          : { animation: "fade-in 0.25s ease both" }),
      }}
    >
      {/* Chat area */}
      <div
        className="border border-[var(--color-border)] overflow-hidden"
        style={{
          background: "var(--color-card)",
          borderRadius: chatFullscreen ? "0" : "12px 12px 0 0",
          ...(chatFullscreen
            ? { flex: 1, display: "flex", flexDirection: "column" as const }
            : {}),
        }}
      >
        <div className="px-4 py-2.5 border-b border-[var(--color-border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{
                background: ACCENT,
                animation: "pulse-dot 2s ease-in-out infinite",
              }}
            />
            <span className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-muted)]">
              {tr("chatCaptain")}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {messages.length > 0 && (
              <button
                onClick={async () => {
                  await fetch("/api/capitano/chat", { method: "DELETE" });
                  setMessages([]);
                }}
                className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)] hover:text-[var(--color-red)] transition-colors cursor-pointer"
              >
                {tr("clear")}
              </button>
            )}
            <button
              onClick={() => setChatFullscreen((v) => !v)}
              className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)] hover:text-[var(--color-muted)] transition-colors cursor-pointer"
            >
              {chatFullscreen ? tr("exit") : tr("expand")}
            </button>
          </div>
        </div>

        <div
          className="px-4 py-4 overflow-auto"
          role="log"
          aria-live="polite"
          aria-label={tr("chatMessages")}
          style={{
            height: chatFullscreen ? undefined : "45vh",
            flex: chatFullscreen ? 1 : undefined,
          }}
        >
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="text-3xl mb-3 opacity-30" aria-hidden="true">
                👨‍✈️
              </div>
              <p className="text-[var(--color-dim)] text-[11px]">
                {tr("writeToStart")}
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={`${msg.ts}-${i}`}
              className={`flex mb-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className="max-w-[75%] px-3 py-2 rounded-lg text-[12px] leading-relaxed"
                style={{
                  background: msg.role === "user" ? ACCENT : "#1c2333",
                  color: msg.role === "user" ? "#000" : "var(--color-bright)",
                  borderBottomRightRadius:
                    msg.role === "user" ? "4px" : undefined,
                  borderBottomLeftRadius:
                    msg.role === "assistant" ? "4px" : undefined,
                }}
              >
                <div
                  style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                >
                  {renderMarkdown(msg.text)}
                </div>
                <div className="text-[9px] mt-1 opacity-50 text-right">
                  {new Date(msg.ts * 1000).toLocaleTimeString(localeTag, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            </div>
          ))}

          {/* Indicatore "sta pensando" */}
          {messages.length > 0 &&
            messages[messages.length - 1].role === "user" && (
              <div className="flex justify-start mb-3">
                <div
                  className="px-4 py-3 rounded-lg text-[12px]"
                  style={{
                    background: "#1c2333",
                    borderBottomLeftRadius: "4px",
                  }}
                >
                  <div className="flex items-center gap-1" aria-hidden="true">
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-[var(--color-muted)]"
                      style={{
                        animation: "pulse-dot 1.4s ease-in-out infinite",
                      }}
                    />
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-[var(--color-muted)]"
                      style={{
                        animation: "pulse-dot 1.4s ease-in-out 0.2s infinite",
                      }}
                    />
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-[var(--color-muted)]"
                      style={{
                        animation: "pulse-dot 1.4s ease-in-out 0.4s infinite",
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

          <div ref={chatEndRef} />
        </div>
      </div>

      {/* Input chat */}
      <form
        aria-label={tr("sendToCaptain")}
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="flex items-center border border-t-0 border-[var(--color-border)] overflow-hidden"
        style={{
          background: "#0d1117",
          borderRadius: chatFullscreen ? "0" : "0 0 12px 12px",
          margin: chatFullscreen ? "0 16px 16px 16px" : undefined,
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={tr("inputPlaceholder")}
          disabled={sending}
          className="flex-1 px-4 py-3 text-[12px] bg-transparent outline-none"
          style={{ color: "var(--color-bright)" }}
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          className="px-5 py-3 text-[11px] font-semibold tracking-widest uppercase transition-colors"
          style={{
            color: !input.trim() || sending ? "var(--color-dim)" : ACCENT,
            cursor: !input.trim() || sending ? "default" : "pointer",
          }}
        >
          {sending ? "…" : tr("send")}
        </button>
      </form>

      {/* Terminale (toggle) — nascosto in fullscreen */}
      {showTerminal && !chatFullscreen && (
        <div className="mt-4" style={{ animation: "fade-in 0.25s ease both" }}>
          <div className="flex items-center justify-between mb-2">
            <div className="section-label">{tr("terminal")}</div>
            <span className="text-[9px] text-[var(--color-dim)] font-mono">
              {tr("captainSession")}
            </span>
          </div>
          <div
            ref={termRef}
            className="border border-[var(--color-border)] rounded-xl p-4 font-mono text-[11px] leading-relaxed overflow-auto"
            style={{
              height: "40vh",
              background: "#0d1117",
              color: "var(--color-base)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              borderColor: `${ACCENT}30`,
            }}
          >
            {status?.output ? (
              status.output
            ) : (
              <span style={{ color: "var(--color-dim)" }}>
                {tr("noOutput")}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div style={{ animation: "fade-in 0.35s ease both" }}>
      {/* Header */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link
            href="/dashboard"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
          >
            {tr("dashboard")}
          </Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">
            /
          </span>
          <Link
            href="/team"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
          >
            {tr("team")}
          </Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">
            /
          </span>
          <span
            className="text-[10px] text-[var(--color-muted)]"
            aria-current="page"
          >
            {tr("captain")}
          </span>
        </nav>
        <div className="mt-4 flex items-start gap-5">
          <div className="text-5xl leading-none select-none" aria-hidden="true">
            👨‍✈️
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
              {tr("captain")}
            </h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">
              {tr("orchestrates")}
            </p>
          </div>
        </div>
      </div>

      {/* Stato + Bottoni */}
      <div className="flex items-center gap-4 mb-6">
        <div className="flex items-center gap-2 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg px-4 py-2.5">
          <div
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{
              background:
                status == null
                  ? "var(--color-dim)"
                  : isActive
                    ? ACCENT
                    : "var(--color-dim)",
              animation: isActive
                ? "pulse-dot 2s ease-in-out infinite"
                : undefined,
            }}
          />
          <span
            className="text-[11px] font-semibold tracking-widest uppercase"
            style={{
              color:
                status == null
                  ? "var(--color-dim)"
                  : isActive
                    ? ACCENT
                    : "var(--color-dim)",
            }}
          >
            {status == null
              ? tr("connecting")
              : isActive
                ? tr("active")
                : tr("inactive")}
          </span>
        </div>

        {!isActive && (
          <button
            onClick={handleStart}
            disabled={startBusy || status == null}
            className="px-6 py-2.5 rounded-lg text-[12px] font-bold tracking-wide transition-all"
            style={{
              background:
                startBusy || status == null ? "var(--color-border)" : ACCENT,
              color: startBusy || status == null ? "var(--color-dim)" : "#000",
              cursor: startBusy || status == null ? "not-allowed" : "pointer",
              opacity: startBusy ? 0.7 : 1,
            }}
          >
            {startLabel}
          </button>
        )}

        {/* Bottone Ferma */}
        {isActive && (
          <button
            onClick={handleStop}
            disabled={stopBusy}
            className="px-5 py-2.5 rounded-lg text-[12px] font-bold tracking-wide transition-all border border-[var(--color-red)] hover:bg-[var(--color-red)] hover:text-[#000]"
            style={{
              color: "var(--color-red)",
              cursor: stopBusy ? "not-allowed" : "pointer",
              opacity: stopBusy ? 0.6 : 1,
            }}
          >
            {stopBusy ? tr("stopping") : tr("stop")}
          </button>
        )}

        {isActive && devMode && (
          <button
            onClick={() => setShowTerminal((v) => !v)}
            className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)] hover:text-[var(--color-muted)] transition-colors cursor-pointer"
          >
            {showTerminal ? tr("hideTerminal") : tr("showTerminal")}
          </button>
        )}

        {isActive && (
          <button
            onClick={async () => {
              await fetch("/api/capitano/terminal", { method: "POST" });
            }}
            className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors cursor-pointer"
          >
            {typeof navigator !== "undefined" && /Mac/.test(navigator.platform)
              ? tr("openTerminal")
              : tr("openPowershell")}
          </button>
        )}

        {startBanner && (
          <span
            className="text-[11px]"
            style={{
              color:
                startCmd.state === "error" ||
                startCmd.state === "timeout" ||
                stopCmd.state === "error" ||
                stopCmd.state === "timeout"
                  ? "var(--color-red)"
                  : "var(--color-muted)",
            }}
          >
            {startBanner}
          </span>
        )}
      </div>

      {/* Chat — visibile solo se attivo */}
      {isActive &&
        (chatFullscreen
          ? createPortal(chatContent, document.body)
          : chatContent)}

      {/* Empty state */}
      {!isActive && status != null && !startBanner && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="text-4xl mb-4 opacity-30" aria-hidden="true">
            👨‍✈️
          </div>
          <p className="text-[var(--color-muted)] text-[13px]">
            {tr("captainNotActive")}
          </p>
          <p className="text-[var(--color-dim)] text-[11px] mt-1">
            {tr("pressStartPrefix")}
            <span style={{ color: ACCENT }}>{tr("startCaptain")}</span>
            {tr("pressStartSuffix")}
          </p>
        </div>
      )}
    </div>
  );
}
