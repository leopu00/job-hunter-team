/**
 * Gateway — Orchestratore centrale JHT.
 *
 * Gestisce il ciclo di vita dei messaggi: ricezione da canale,
 * pipeline middleware pre, invio al provider AI, pipeline middleware
 * post, dispatch risposta al canale di origine.
 */

import { randomUUID } from "node:crypto";
import type {
  GatewayConfig,
  GatewayEvent,
  GatewayEventHandler,
  GatewayMessage,
  GatewayResponse,
} from "./types.js";
import { DEFAULT_GATEWAY_CONFIG } from "./types.js";
import { MiddlewarePipeline, loggingMiddleware } from "./middleware.js";
import { MessageRouter } from "./router.js";

export class Gateway {
  readonly config: GatewayConfig;
  readonly router: MessageRouter;
  readonly middleware: MiddlewarePipeline;

  private running = false;
  private eventHandlers: GatewayEventHandler[] = [];
  private queue: GatewayMessage[] = [];

  constructor(config?: Partial<GatewayConfig>) {
    this.config = { ...DEFAULT_GATEWAY_CONFIG, ...config };
    this.router = new MessageRouter();
    this.middleware = new MiddlewarePipeline();
    this.middleware.register(loggingMiddleware);
  }

  onEvent(handler: GatewayEventHandler): void {
    this.eventHandlers.push(handler);
  }

  private emit(event: GatewayEvent): void {
    for (const handler of this.eventHandlers) {
      try { handler(event); } catch { /* non bloccare il gateway */ }
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.router.connectAll();
    this.emit({
      type: "channel.connected",
      timestamp: new Date(),
      data: { channels: this.router.listChannels() },
    });
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    await this.router.disconnectAll();
    this.queue = [];
    this.emit({
      type: "channel.disconnected",
      timestamp: new Date(),
      data: {},
    });
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Processa un messaggio attraverso il gateway:
   * 1. Middleware pre-processing
   * 2. Routing al provider AI
   * 3. Middleware post-processing
   * 4. Dispatch risposta al canale
   */
  async handleMessage(message: GatewayMessage): Promise<GatewayResponse> {
    if (!this.running) {
      throw new Error("Gateway non attivo");
    }

    if (this.queue.length >= this.config.maxQueueSize) {
      throw new Error("Coda messaggi piena");
    }

    this.queue.push(message);
    this.emit({
      type: "message.received",
      timestamp: new Date(),
      data: { messageId: message.id, channel: message.channel },
    });

    try {
      // Pre-processing
      const preCtx = await this.middleware.runPre(message);
      if (preCtx.aborted) {
        throw new Error(preCtx.abortReason || "Messaggio bloccato dal middleware");
      }

      // Routing al provider
      const response = await this.router.routeToProvider(preCtx.message);
      this.emit({
        type: "response.started",
        timestamp: new Date(),
        data: { messageId: message.id, responseId: response.id },
      });

      // Post-processing
      const postCtx = await this.middleware.runPost({
        ...preCtx,
        response,
      });

      const finalResponse = postCtx.response || response;

      // Dispatch al canale
      await this.router.routeToChannel(message.channel, finalResponse);
      this.emit({
        type: "response.completed",
        timestamp: new Date(),
        data: {
          messageId: message.id,
          responseId: finalResponse.id,
          usage: finalResponse.usage,
        },
      });

      return finalResponse;
    } catch (err) {
      this.emit({
        type: "error",
        timestamp: new Date(),
        data: {
          messageId: message.id,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      throw err;
    } finally {
      const idx = this.queue.indexOf(message);
      if (idx !== -1) this.queue.splice(idx, 1);
    }
  }

  queueSize(): number {
    return this.queue.length;
  }
}

/** Factory per creare un gateway con configurazione */
export function createGateway(config?: Partial<GatewayConfig>): Gateway {
  return new Gateway(config);
}
