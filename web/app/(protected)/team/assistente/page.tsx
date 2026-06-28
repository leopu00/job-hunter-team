"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, useCallback } from "react";
import { useDevMode } from "@/components/SettingsMenu";
import { useTeamCommandPoller } from "@/app/hooks/useTeamCommandPoller";
import { useIsCloud } from "@/app/hooks/useIsCloud";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

const T: Record<
  Locale,
  {
    sending: string;
    queuedVps: string;
    starting: string;
    startAssistant: string;
    timeoutSubscriber: string;
    dashboard: string;
    team: string;
    assistant: string;
    subtitle: string;
    sectionLabel: string;
    hideTerminal: string;
    showTerminal: string;
    openTerminal: string;
    openPowershell: string;
    connecting: string;
    active: string;
    inactive: string;
    stopping: string;
    stop: string;
    chatAssistant: string;
    clear: string;
    exit: string;
    expand: string;
    writeToStart: string;
    attachFile: string;
    writeMessage: string;
    send: string;
    terminal: string;
    assistantSession: string;
    noOutput: string;
    notActive: string;
    pressStartPrefix: string;
    pressStartSuffix: string;
    expandCollapseSection: (collapsed: boolean) => string;
    filesAttachedPlaceholder: (n: number) => string;
    removeFile: (name: string) => string;
  }
> = {
  it: {
    sending: "Invio…",
    queuedVps: "In coda sulla VPS…",
    starting: "Avvio in corso…",
    startAssistant: "Avvia Assistente",
    timeoutSubscriber: "Timeout: il subscriber sulla VPS non risponde.",
    dashboard: "Dashboard",
    team: "Team",
    assistant: "Assistente",
    subtitle: "Ti aiuta a configurare il sistema e navigare la piattaforma",
    sectionLabel: "Assistente",
    hideTerminal: "nascondi terminale",
    showTerminal: "mostra terminale",
    openTerminal: "apri terminale",
    openPowershell: "apri powershell",
    connecting: "connessione…",
    active: "attivo",
    inactive: "inattivo",
    stopping: "Fermando…",
    stop: "Ferma",
    chatAssistant: "chat · assistente",
    clear: "pulisci",
    exit: "esci",
    expand: "espandi",
    writeToStart: "Scrivi un messaggio per iniziare la conversazione.",
    attachFile: "Allega file",
    writeMessage: "Scrivi un messaggio...",
    send: "invia",
    terminal: "Terminale",
    assistantSession: "sessione ASSISTENTE",
    noOutput: "nessun output…",
    notActive: "L'Assistente non è attivo.",
    pressStartPrefix: "Premi ",
    pressStartSuffix: " per iniziare.",
    expandCollapseSection: (c) =>
      `${c ? "Espandi" : "Chiudi"} sezione Assistente`,
    filesAttachedPlaceholder: (n) =>
      `${n} file allegat${n === 1 ? "o" : "i"} — scrivi un messaggio...`,
    removeFile: (name) => `Rimuovi file ${name}`,
  },
  en: {
    sending: "Sending…",
    queuedVps: "Queued on the VPS…",
    starting: "Starting…",
    startAssistant: "Start Assistant",
    timeoutSubscriber: "Timeout: the subscriber on the VPS is not responding.",
    dashboard: "Dashboard",
    team: "Team",
    assistant: "Assistant",
    subtitle: "Helps you configure the system and navigate the platform",
    sectionLabel: "Assistant",
    hideTerminal: "hide terminal",
    showTerminal: "show terminal",
    openTerminal: "open terminal",
    openPowershell: "open powershell",
    connecting: "connecting…",
    active: "active",
    inactive: "inactive",
    stopping: "Stopping…",
    stop: "Stop",
    chatAssistant: "chat · assistant",
    clear: "clear",
    exit: "exit",
    expand: "expand",
    writeToStart: "Write a message to start the conversation.",
    attachFile: "Attach file",
    writeMessage: "Write a message...",
    send: "send",
    terminal: "Terminal",
    assistantSession: "ASSISTENTE session",
    noOutput: "no output…",
    notActive: "The Assistant is not active.",
    pressStartPrefix: "Press ",
    pressStartSuffix: " to start.",
    expandCollapseSection: (c) =>
      `${c ? "Expand" : "Collapse"} Assistant section`,
    filesAttachedPlaceholder: (n) =>
      `${n} file${n === 1 ? "" : "s"} attached — write a message...`,
    removeFile: (name) => `Remove file ${name}`,
  },
  es: {
    sending: "Enviando…",
    queuedVps: "En cola en el VPS…",
    starting: "Iniciando…",
    startAssistant: "Iniciar Asistente",
    timeoutSubscriber: "Tiempo agotado: el suscriptor en el VPS no responde.",
    dashboard: "Panel",
    team: "Equipo",
    assistant: "Asistente",
    subtitle: "Te ayuda a configurar el sistema y navegar por la plataforma",
    sectionLabel: "Asistente",
    hideTerminal: "ocultar terminal",
    showTerminal: "mostrar terminal",
    openTerminal: "abrir terminal",
    openPowershell: "abrir powershell",
    connecting: "conectando…",
    active: "activo",
    inactive: "inactivo",
    stopping: "Deteniendo…",
    stop: "Detener",
    chatAssistant: "chat · asistente",
    clear: "limpiar",
    exit: "salir",
    expand: "ampliar",
    writeToStart: "Escribe un mensaje para iniciar la conversación.",
    attachFile: "Adjuntar archivo",
    writeMessage: "Escribe un mensaje...",
    send: "enviar",
    terminal: "Terminal",
    assistantSession: "sesión ASSISTENTE",
    noOutput: "sin salida…",
    notActive: "El Asistente no está activo.",
    pressStartPrefix: "Pulsa ",
    pressStartSuffix: " para iniciar.",
    expandCollapseSection: (c) =>
      `${c ? "Expandir" : "Contraer"} sección Asistente`,
    filesAttachedPlaceholder: (n) =>
      `${n} archivo${n === 1 ? "" : "s"} adjunto${n === 1 ? "" : "s"} — escribe un mensaje...`,
    removeFile: (name) => `Eliminar archivo ${name}`,
  },
  fr: {
    sending: "Envoi…",
    queuedVps: "En file d'attente sur le VPS…",
    starting: "Démarrage en cours…",
    startAssistant: "Démarrer l'Assistant",
    timeoutSubscriber: "Délai dépassé : l'abonné sur le VPS ne répond pas.",
    dashboard: "Tableau de bord",
    team: "Équipe",
    assistant: "Assistant",
    subtitle:
      "Vous aide à configurer le système et à naviguer sur la plateforme",
    sectionLabel: "Assistant",
    hideTerminal: "masquer le terminal",
    showTerminal: "afficher le terminal",
    openTerminal: "ouvrir le terminal",
    openPowershell: "ouvrir powershell",
    connecting: "connexion…",
    active: "actif",
    inactive: "inactif",
    stopping: "Arrêt…",
    stop: "Arrêter",
    chatAssistant: "chat · assistant",
    clear: "effacer",
    exit: "quitter",
    expand: "agrandir",
    writeToStart: "Écris un message pour démarrer la conversation.",
    attachFile: "Joindre un fichier",
    writeMessage: "Écris un message...",
    send: "envoyer",
    terminal: "Terminal",
    assistantSession: "session ASSISTENTE",
    noOutput: "aucune sortie…",
    notActive: "L'Assistant n'est pas actif.",
    pressStartPrefix: "Appuie sur ",
    pressStartSuffix: " pour démarrer.",
    expandCollapseSection: (c) =>
      `${c ? "Développer" : "Réduire"} la section Assistant`,
    filesAttachedPlaceholder: (n) =>
      `${n} fichier${n === 1 ? "" : "s"} joint${n === 1 ? "" : "s"} — écris un message...`,
    removeFile: (name) => `Supprimer le fichier ${name}`,
  },
  de: {
    sending: "Senden…",
    queuedVps: "In Warteschlange auf dem VPS…",
    starting: "Wird gestartet…",
    startAssistant: "Assistent starten",
    timeoutSubscriber:
      "Zeitüberschreitung: Der Subscriber auf dem VPS antwortet nicht.",
    dashboard: "Dashboard",
    team: "Team",
    assistant: "Assistent",
    subtitle:
      "Hilft dir, das System zu konfigurieren und die Plattform zu navigieren",
    sectionLabel: "Assistent",
    hideTerminal: "Terminal ausblenden",
    showTerminal: "Terminal anzeigen",
    openTerminal: "Terminal öffnen",
    openPowershell: "PowerShell öffnen",
    connecting: "verbinde…",
    active: "aktiv",
    inactive: "inaktiv",
    stopping: "Wird gestoppt…",
    stop: "Stoppen",
    chatAssistant: "Chat · Assistent",
    clear: "leeren",
    exit: "schließen",
    expand: "erweitern",
    writeToStart: "Schreibe eine Nachricht, um das Gespräch zu beginnen.",
    attachFile: "Datei anhängen",
    writeMessage: "Nachricht schreiben...",
    send: "senden",
    terminal: "Terminal",
    assistantSession: "Sitzung ASSISTENTE",
    noOutput: "keine Ausgabe…",
    notActive: "Der Assistent ist nicht aktiv.",
    pressStartPrefix: "Drücke ",
    pressStartSuffix: ", um zu starten.",
    expandCollapseSection: (c) =>
      `${c ? "Erweitern" : "Einklappen"} Assistent-Bereich`,
    filesAttachedPlaceholder: (n) =>
      `${n} Datei${n === 1 ? "" : "en"} angehängt — Nachricht schreiben...`,
    removeFile: (name) => `Datei ${name} entfernen`,
  },
  hu: {
    sending: "Küldés…",
    queuedVps: "Sorban a VPS-en…",
    starting: "Indítás folyamatban…",
    startAssistant: "Asszisztens indítása",
    timeoutSubscriber: "Időtúllépés: a VPS-en lévő feliratkozó nem válaszol.",
    dashboard: "Irányítópult",
    team: "Csapat",
    assistant: "Asszisztens",
    subtitle: "Segít a rendszer beállításában és a platform használatában",
    sectionLabel: "Asszisztens",
    hideTerminal: "terminál elrejtése",
    showTerminal: "terminál megjelenítése",
    openTerminal: "terminál megnyitása",
    openPowershell: "powershell megnyitása",
    connecting: "kapcsolódás…",
    active: "aktív",
    inactive: "inaktív",
    stopping: "Leállítás…",
    stop: "Leállítás",
    chatAssistant: "chat · asszisztens",
    clear: "törlés",
    exit: "kilépés",
    expand: "kibontás",
    writeToStart: "Írj egy üzenetet a beszélgetés megkezdéséhez.",
    attachFile: "Fájl csatolása",
    writeMessage: "Írj egy üzenetet...",
    send: "küldés",
    terminal: "Terminál",
    assistantSession: "ASSISTENTE munkamenet",
    noOutput: "nincs kimenet…",
    notActive: "Az Asszisztens nem aktív.",
    pressStartPrefix: "Nyomd meg: ",
    pressStartSuffix: " a kezdéshez.",
    expandCollapseSection: (c) =>
      `Asszisztens szakasz ${c ? "kibontása" : "összecsukása"}`,
    filesAttachedPlaceholder: (n) => `${n} fájl csatolva — írj egy üzenetet...`,
    removeFile: (name) => `${name} fájl eltávolítása`,
  },
  pt: {
    sending: "Enviando…",
    queuedVps: "Na fila no VPS…",
    starting: "Iniciando…",
    startAssistant: "Iniciar Assistente",
    timeoutSubscriber: "Tempo esgotado: o subscriber no VPS não responde.",
    dashboard: "Painel",
    team: "Equipe",
    assistant: "Assistente",
    subtitle: "Ajuda você a configurar o sistema e navegar pela plataforma",
    sectionLabel: "Assistente",
    hideTerminal: "ocultar terminal",
    showTerminal: "mostrar terminal",
    openTerminal: "abrir terminal",
    openPowershell: "abrir powershell",
    connecting: "conectando…",
    active: "ativo",
    inactive: "inativo",
    stopping: "Parando…",
    stop: "Parar",
    chatAssistant: "chat · assistente",
    clear: "limpar",
    exit: "sair",
    expand: "expandir",
    writeToStart: "Escreva uma mensagem para iniciar a conversa.",
    attachFile: "Anexar arquivo",
    writeMessage: "Escreva uma mensagem...",
    send: "enviar",
    terminal: "Terminal",
    assistantSession: "sessão ASSISTENTE",
    noOutput: "sem saída…",
    notActive: "O Assistente não está ativo.",
    pressStartPrefix: "Pressione ",
    pressStartSuffix: " para iniciar.",
    expandCollapseSection: (c) =>
      `${c ? "Expandir" : "Recolher"} seção Assistente`,
    filesAttachedPlaceholder: (n) =>
      `${n} arquivo${n === 1 ? "" : "s"} anexado${n === 1 ? "" : "s"} — escreva uma mensagem...`,
    removeFile: (name) => `Remover arquivo ${name}`,
  },
};

const LOCALE_TAG: Record<Locale, string> = {
  it: "it-IT",
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  hu: "hu-HU",
  pt: "pt-PT",
};

type Status = { active: boolean; output: string };
type ChatMsg = { role: "user" | "assistant"; text: string; ts: number };

/** Render markdown leggero: **bold**, *italic*, `code`, \n */
function renderMarkdown(text: string) {
  // Split per blocchi di codice inline
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
    // Bold **text**
    const boldParts = part.split(/(\*\*[^*]+\*\*)/);
    return boldParts.map((bp, j) => {
      if (bp.startsWith("**") && bp.endsWith("**")) {
        return <strong key={`${i}-${j}`}>{bp.slice(2, -2)}</strong>;
      }
      // Italic *text*
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

export default function AssistentePage() {
  const isCloud = useIsCloud();
  const locale = useLocale();
  const t = T[locale];
  const localeTag = LOCALE_TAG[locale] ?? "en-US";
  const [status, setStatus] = useState<Status | null>(null);
  const startCmd = useTeamCommandPoller();
  const stopCmd = useTeamCommandPoller();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [showTerminal, setShowTerminal] = useState(false);
  const [chatFullscreen, setChatFullscreen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (id: string) =>
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  const devMode = useDevMode();

  // Dev mode off → chiudi il terminale se era aperto.
  useEffect(() => {
    if (!devMode) setShowTerminal(false);
  }, [devMode]);

  // Blocca scroll del body quando chat è fullscreen
  useEffect(() => {
    document.body.style.overflow = chatFullscreen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [chatFullscreen]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isActive = status?.active ?? false;

  // Fetch stato agente
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/assistente/status");
      const data: Status = await res.json();
      setStatus(data);
    } catch {
      setStatus({ active: false, output: "" });
    }
  }, []);

  // Fetch chat messages — il file è la source of truth
  const fetchChat = useCallback(async () => {
    try {
      const res = await fetch("/api/assistente/chat?after=0");
      const data = await res.json();
      if (data.messages) {
        setMessages(data.messages);
      }
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
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }
    prevMsgCountRef.current = messages.length;
  }, [messages]);

  // Scroll terminale in fondo
  useEffect(() => {
    if (termRef.current)
      termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [status?.output, showTerminal]);

  const handleStart = () => startCmd.run("/api/assistente/start");
  const handleStop = () => stopCmd.run("/api/assistente/stop");

  // Quando un comando arriva a stato terminal positivo, aggiorna subito
  // lo status (no need to wait il polling 5s). Su error/timeout lascio
  // il messaggio visibile finché l'utente non riprova.
  useEffect(() => {
    if (startCmd.state === "done" || startCmd.state === "local") {
      fetchStatus();
    }
  }, [startCmd.state, fetchStatus]);
  useEffect(() => {
    if (stopCmd.state === "done" || stopCmd.state === "local") {
      fetchStatus();
    }
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
      ? t.sending
      : startCmd.state === "pending"
        ? t.queuedVps
        : startCmd.state === "running"
          ? t.starting
          : t.startAssistant;
  const startBanner =
    startCmd.error ||
    (startCmd.state === "timeout" ? t.timeoutSubscriber : null) ||
    startCmd.message ||
    stopCmd.error ||
    stopCmd.message;

  const handleSend = async () => {
    if ((!input.trim() && attachedFiles.length === 0) || sending) return;
    setSending(true);
    const text = input.trim();
    const filesToSend = [...attachedFiles];
    setInput("");
    setAttachedFiles([]);
    try {
      let filePaths: string[] = [];
      // Upload file se presenti
      if (filesToSend.length > 0) {
        const formData = new FormData();
        filesToSend.forEach((f) => formData.append("files", f));
        const uploadRes = await fetch("/api/assistente/upload", {
          method: "POST",
          body: formData,
        });
        const uploadData = await uploadRes.json();
        if (uploadData.saved) {
          filePaths = uploadData.saved.map(
            (f: { name: string; path: string }) => f.path,
          );
        }
      }
      // Componi messaggio con path allegati
      let fullText = text;
      if (filePaths.length > 0) {
        const fileList = filePaths.map((p) => `📎 ${p}`).join("\n");
        fullText = fullText
          ? `${fullText}\n\n[FILE ALLEGATI]\n${fileList}`
          : `[FILE ALLEGATI]\n${fileList}`;
      }
      if (fullText) {
        await fetch("/api/assistente/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: fullText }),
        });
      }
      await fetchChat();
    } catch {
      /* ignore */
    }
    setSending(false);
    inputRef.current?.focus();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) {
      setAttachedFiles((prev) => [...prev, ...files]);
    }
    e.target.value = "";
  };

  const removeAttachedFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div style={{ animation: "fade-in 0.35s ease both" }}>
      {/* Header */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link
            href="/dashboard"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
          >
            {t.dashboard}
          </Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">
            /
          </span>
          <Link
            href="/team"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
          >
            {t.team}
          </Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">
            /
          </span>
          <span
            className="text-[10px] text-[var(--color-muted)]"
            aria-current="page"
          >
            {t.assistant}
          </span>
        </nav>
        <div className="mt-4 flex items-start gap-5">
          <div className="text-5xl leading-none select-none">👨‍💼</div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
              {t.assistant}
            </h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">
              {t.subtitle}
            </p>
          </div>
        </div>
      </div>

      {/* Assistente */}
      <div className="mb-6">
        <div
          role="button"
          tabIndex={0}
          aria-label={t.expandCollapseSection(!!collapsed.step3)}
          className="flex items-center justify-between mb-3 cursor-pointer select-none"
          onClick={() => toggle("step3")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggle("step3");
            }
          }}
          aria-expanded={!collapsed.step3}
        >
          <div className="section-label">{t.sectionLabel}</div>
          <div className="flex items-center gap-3">
            {isCloud !== true && isActive && !collapsed.step3 && (
              <>
                {devMode && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowTerminal((v) => !v);
                    }}
                    className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)] hover:text-[var(--color-muted)] transition-colors cursor-pointer"
                  >
                    {showTerminal ? t.hideTerminal : t.showTerminal}
                  </button>
                )}
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    await fetch("/api/assistente/terminal", { method: "POST" });
                  }}
                  className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)] hover:text-[var(--color-green)] transition-colors cursor-pointer"
                >
                  {/Mac/.test(navigator.platform)
                    ? t.openTerminal
                    : t.openPowershell}
                </button>
              </>
            )}
            <span className="text-[10px] text-[var(--color-dim)]">
              {collapsed.step3 ? "▶" : "▼"}
            </span>
          </div>
        </div>

        {!collapsed.step3 && (
          <>
            <div className="flex items-center gap-4 mb-4">
              <div className="flex items-center gap-2 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg px-4 py-2.5">
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{
                    background:
                      status == null
                        ? "var(--color-dim)"
                        : isActive
                          ? "var(--color-green)"
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
                          ? "var(--color-green)"
                          : "var(--color-dim)",
                  }}
                >
                  {status == null
                    ? t.connecting
                    : isActive
                      ? t.active
                      : t.inactive}
                </span>
              </div>
              {/* Controlli team (start/stop) — solo desktop, nascosti sul cloud read-only */}
              {isCloud !== true && (
                <>
                  {!isActive && (
                    <button
                      onClick={handleStart}
                      disabled={startBusy || status == null}
                      className="px-6 py-2.5 rounded-lg text-[12px] font-bold tracking-wide transition-all"
                      style={{
                        background:
                          startBusy || status == null
                            ? "var(--color-border)"
                            : "var(--color-green)",
                        color:
                          startBusy || status == null
                            ? "var(--color-dim)"
                            : "#000",
                        cursor:
                          startBusy || status == null
                            ? "not-allowed"
                            : "pointer",
                        opacity: startBusy ? 0.7 : 1,
                      }}
                    >
                      {startLabel}
                    </button>
                  )}
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
                      {stopBusy ? t.stopping : t.stop}
                    </button>
                  )}
                </>
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

            {/* Chat */}
            {isActive &&
              (() => {
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
                          ? {
                              flex: 1,
                              display: "flex",
                              flexDirection: "column" as const,
                            }
                          : {}),
                      }}
                    >
                      <div className="px-4 py-2.5 border-b border-[var(--color-border)] flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2 h-2 rounded-full bg-[var(--color-green)]"
                            style={{
                              animation: "pulse-dot 2s ease-in-out infinite",
                            }}
                          />
                          <span className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-muted)]">
                            {t.chatAssistant}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          {isCloud !== true && messages.length > 0 && (
                            <button
                              onClick={async () => {
                                await fetch("/api/assistente/chat", {
                                  method: "DELETE",
                                });
                                setMessages([]);
                              }}
                              className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)] hover:text-[var(--color-red)] transition-colors cursor-pointer"
                            >
                              {t.clear}
                            </button>
                          )}
                          <button
                            onClick={() => setChatFullscreen((v) => !v)}
                            className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-dim)] hover:text-[var(--color-muted)] transition-colors cursor-pointer"
                          >
                            {chatFullscreen ? t.exit : t.expand}
                          </button>
                        </div>
                      </div>

                      <div
                        className="px-4 py-4 overflow-auto"
                        style={{
                          height: chatFullscreen ? undefined : "45vh",
                          flex: chatFullscreen ? 1 : undefined,
                        }}
                      >
                        {messages.length === 0 && (
                          <div className="flex flex-col items-center justify-center h-full text-center">
                            <div className="text-3xl mb-3 opacity-30">👨‍💼</div>
                            <p className="text-[var(--color-dim)] text-[11px]">
                              {t.writeToStart}
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
                                background:
                                  msg.role === "user"
                                    ? "var(--color-green)"
                                    : "#1c2333",
                                color:
                                  msg.role === "user"
                                    ? "#000"
                                    : "var(--color-bright)",
                                borderBottomRightRadius:
                                  msg.role === "user" ? "4px" : undefined,
                                borderBottomLeftRadius:
                                  msg.role === "assistant" ? "4px" : undefined,
                              }}
                            >
                              <div
                                style={{
                                  whiteSpace: "pre-wrap",
                                  wordBreak: "break-word",
                                }}
                              >
                                {renderMarkdown(msg.text)}
                              </div>
                              <div className="text-[9px] mt-1 opacity-50 text-right">
                                {new Date(msg.ts * 1000).toLocaleTimeString(
                                  localeTag,
                                  { hour: "2-digit", minute: "2-digit" },
                                )}
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
                                <div className="flex items-center gap-1">
                                  <span
                                    className="w-1.5 h-1.5 rounded-full bg-[var(--color-muted)]"
                                    style={{
                                      animation:
                                        "pulse-dot 1.4s ease-in-out infinite",
                                    }}
                                  />
                                  <span
                                    className="w-1.5 h-1.5 rounded-full bg-[var(--color-muted)]"
                                    style={{
                                      animation:
                                        "pulse-dot 1.4s ease-in-out 0.2s infinite",
                                    }}
                                  />
                                  <span
                                    className="w-1.5 h-1.5 rounded-full bg-[var(--color-muted)]"
                                    style={{
                                      animation:
                                        "pulse-dot 1.4s ease-in-out 0.4s infinite",
                                    }}
                                  />
                                </div>
                              </div>
                            </div>
                          )}

                        <div ref={chatEndRef} />
                      </div>
                    </div>

                    {/* Allegati preview */}
                    {attachedFiles.length > 0 && (
                      <div
                        className="flex flex-wrap gap-2 px-4 py-2 border border-t-0 border-[var(--color-border)]"
                        style={{ background: "#0d1117" }}
                      >
                        {attachedFiles.map((file, i) => (
                          <div
                            key={`${file.name}-${i}`}
                            className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px]"
                            style={{
                              background: "var(--color-card)",
                              border: "1px solid var(--color-border)",
                              color: "var(--color-muted)",
                            }}
                          >
                            <svg
                              aria-hidden="true"
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              style={{ flexShrink: 0 }}
                            >
                              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                            </svg>
                            <span
                              className="max-w-[150px] truncate"
                              title={file.name}
                            >
                              {file.name}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeAttachedFile(i)}
                              aria-label={t.removeFile(file.name)}
                              className="ml-0.5 hover:text-[var(--color-red)] transition-colors cursor-pointer"
                              style={{
                                color: "var(--color-dim)",
                                fontSize: "12px",
                                lineHeight: 1,
                              }}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Input chat — [JHT-DASHBOARD-SPLIT] composer = controllo, solo desktop */}
                    {isCloud !== true && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleSend();
                        }}
                        className="flex items-center border border-t-0 border-[var(--color-border)] overflow-hidden"
                        style={{
                          background: "#0d1117",
                          borderRadius: chatFullscreen ? "0" : "0 0 12px 12px",
                          margin: chatFullscreen
                            ? "0 16px 16px 16px"
                            : undefined,
                        }}
                      >
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          onChange={handleFileSelect}
                          className="hidden"
                          accept=".pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg,.csv,.xlsx,.xls,.json,.yaml,.yml"
                        />
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={sending}
                          className="pl-3 pr-1 py-3 transition-colors cursor-pointer"
                          aria-label={t.attachFile}
                          title={t.attachFile}
                          style={{
                            color:
                              attachedFiles.length > 0
                                ? "var(--color-green)"
                                : "var(--color-dim)",
                          }}
                        >
                          <svg
                            aria-hidden="true"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                          </svg>
                        </button>
                        <input
                          ref={inputRef}
                          type="text"
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          placeholder={
                            attachedFiles.length > 0
                              ? t.filesAttachedPlaceholder(attachedFiles.length)
                              : t.writeMessage
                          }
                          disabled={sending}
                          className="flex-1 px-3 py-3 text-[12px] bg-transparent outline-none"
                          style={{ color: "var(--color-bright)" }}
                        />
                        <button
                          type="submit"
                          disabled={
                            (!input.trim() && attachedFiles.length === 0) ||
                            sending
                          }
                          className="px-5 py-3 text-[11px] font-semibold tracking-widest uppercase transition-colors"
                          style={{
                            color:
                              (!input.trim() && attachedFiles.length === 0) ||
                              sending
                                ? "var(--color-dim)"
                                : "var(--color-green)",
                            cursor:
                              (!input.trim() && attachedFiles.length === 0) ||
                              sending
                                ? "default"
                                : "pointer",
                          }}
                        >
                          {sending ? "…" : t.send}
                        </button>
                      </form>
                    )}

                    {/* Terminale (toggle) — nascosto in fullscreen */}
                    {showTerminal && !chatFullscreen && (
                      <div
                        className="mt-4"
                        style={{ animation: "fade-in 0.25s ease both" }}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="section-label">{t.terminal}</div>
                          <span className="text-[9px] text-[var(--color-dim)] font-mono">
                            {t.assistantSession}
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
                            borderColor: "var(--color-green)30",
                          }}
                        >
                          {status?.output ? (
                            status.output
                          ) : (
                            <span style={{ color: "var(--color-dim)" }}>
                              {t.noOutput}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
                return chatFullscreen
                  ? createPortal(chatContent, document.body)
                  : chatContent;
              })()}
          </>
        )}
      </div>

      {/* Empty state */}
      {!isActive && status != null && !startBanner && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="text-4xl mb-4 opacity-30">👨‍💼</div>
          <p className="text-[var(--color-muted)] text-[13px]">{t.notActive}</p>
          <p className="text-[var(--color-dim)] text-[11px] mt-1">
            {t.pressStartPrefix}
            <span style={{ color: "var(--color-green)" }}>
              {t.startAssistant}
            </span>
            {t.pressStartSuffix}
          </p>
        </div>
      )}
    </div>
  );
}
