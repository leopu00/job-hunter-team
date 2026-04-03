/**
 * Bridge bot assistente → team JHT.
 *
 * Collega il bot personale al capitano del team.
 * Inoltra richieste classificate, traccia le pending,
 * e restituisce le risposte all'utente.
 */

import { execSync } from "child_process";
import { randomUUID } from "crypto";
import type {
  AssistantConfig,
  AssistantEvent,
  AssistantEventHandler,
  AssistantStatus,
  CaptainMessage,
  TeamRequest,
  TeamResponse,
  UserIntent,
} from "./types.js";
import { DEFAULT_ASSISTANT_CONFIG } from "./types.js";

// ── BRIDGE CLASS ────────────────────────────────────────────

export class TeamBridge {
  private config: AssistantConfig;
  private pendingRequests = new Map<string, TeamRequest>();
  private totalRequests = 0;
  private eventHandlers = new Set<AssistantEventHandler>();

  constructor(config: Partial<AssistantConfig> & { botToken: string; ownerChatId: string }) {
    this.config = { ...DEFAULT_ASSISTANT_CONFIG, ...config };
  }

  /** Registra un handler per eventi del bridge */
  onEvent(handler: AssistantEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private emit(event: AssistantEvent): void {
    for (const handler of this.eventHandlers) {
      try { handler(event); } catch { /* mai bloccare su errori di callback */ }
    }
  }

  // ── DISPATCH TO TEAM ────────────────────────────────────────

  /** Inoltra una richiesta classificata al capitano del team */
  async dispatch(intent: UserIntent, userId: string): Promise<TeamRequest> {
    const request: TeamRequest = {
      id: randomUUID(),
      intent,
      userId,
      timestamp: Date.now(),
      status: "pending",
    };

    this.pendingRequests.set(request.id, request);
    this.totalRequests++;
    this.emit({ type: "request_received", request });

    // Componi messaggio per il capitano
    const captainMsg = this.formatCaptainMessage(request);

    try {
      this.sendToCaptain(captainMsg);
      request.status = "dispatched";
      this.emit({ type: "request_dispatched", requestId: request.id });
    } catch (err) {
      request.status = "error";
      this.emit({ type: "error", requestId: request.id, error: String(err) });
    }

    // Timeout per richieste pendenti
    setTimeout(() => {
      const req = this.pendingRequests.get(request.id);
      if (req && req.status !== "completed") {
        req.status = "timeout";
        this.pendingRequests.delete(request.id);
        this.emit({ type: "request_timeout", requestId: request.id });
      }
    }, this.config.teamResponseTimeoutMs);

    return request;
  }

  // ── RECEIVE FROM TEAM ───────────────────────────────────────

  /** Ricevi una risposta dal team e completa la richiesta */
  receiveResponse(response: TeamResponse): boolean {
    const request = this.pendingRequests.get(response.requestId);
    if (!request) return false;

    request.status = "completed";
    this.pendingRequests.delete(response.requestId);
    this.emit({ type: "response_received", response });
    return true;
  }

  // ── CAPTAIN COMMUNICATION ───────────────────────────────────

  private formatCaptainMessage(request: TeamRequest): CaptainMessage {
    return {
      from: "assistant-bot",
      intent: request.intent,
      requestId: request.id,
      timestamp: request.timestamp,
    };
  }

  /** Invia messaggio al capitano via tmux */
  private sendToCaptain(msg: CaptainMessage): void {
    const session = this.config.captainSession;
    const text = this.formatTmuxMessage(msg);

    try {
      execSync(`tmux has-session -t "${session}" 2>/dev/null`, { stdio: "pipe" });
    } catch {
      throw new Error(`Sessione capitano ${session} non attiva`);
    }

    // Invio in due step come da protocollo JHT
    execSync(`tmux send-keys -t "${session}" ${escapeForTmux(text)}`, { stdio: "pipe" });
    execSync(`tmux send-keys -t "${session}" Enter`, { stdio: "pipe" });
  }

  private formatTmuxMessage(msg: CaptainMessage): string {
    const intentDesc = describeIntent(msg.intent);
    return `[@assistant -> @capitano] [REQ] ${intentDesc} (req:${msg.requestId.slice(0, 8)})`;
  }

  // ── STATUS ──────────────────────────────────────────────────

  getStatus(): AssistantStatus {
    return {
      running: true,
      ownerChatId: this.config.ownerChatId,
      pendingRequests: this.pendingRequests.size,
      totalRequests: this.totalRequests,
    };
  }

  getPendingRequests(): TeamRequest[] {
    return Array.from(this.pendingRequests.values());
  }
}

// ── UTILITIES ───────────────────────────────────────────────

function describeIntent(intent: UserIntent): string {
  switch (intent.kind) {
    case "job_search":
      return `Ricerca lavoro: "${intent.query.slice(0, 100)}"`;
    case "status_check":
      return "Richiesta stato ricerca";
    case "list_applications":
      return "Richiesta lista candidature";
    case "stop_search":
      return "Richiesta stop ricerca";
    case "update_profile":
      return `Aggiornamento profilo: "${intent.details.slice(0, 80)}"`;
    case "unknown":
      return `Messaggio non classificato: "${intent.rawText.slice(0, 80)}"`;
  }
}

/** Escape stringa per tmux send-keys */
function escapeForTmux(text: string): string {
  return `"${text.replace(/"/g, '\\"').replace(/\$/g, "\\$")}"`;
}
