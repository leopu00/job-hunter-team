/**
 * Gateway Router — Smistamento messaggi tra canali e provider AI.
 *
 * Gestisce la registrazione dei canali, il routing dei messaggi
 * in ingresso verso il provider corretto, e il dispatch delle
 * risposte verso il canale di origine.
 */

import type {
  ChannelId,
  ChannelStatus,
  GatewayMessage,
  GatewayResponse,
} from "./types.js";

// --- Channel Handler ---

export interface ChannelHandler {
  id: ChannelId;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(response: GatewayResponse): Promise<void>;
  status(): ChannelStatus;
}

// --- Provider Handler ---

export interface ProviderHandler {
  name: string;
  chat(message: GatewayMessage): Promise<GatewayResponse>;
}

// --- Router ---

export class MessageRouter {
  private channels = new Map<ChannelId, ChannelHandler>();
  private provider: ProviderHandler | null = null;

  registerChannel(handler: ChannelHandler): void {
    this.channels.set(handler.id, handler);
  }

  unregisterChannel(id: ChannelId): boolean {
    return this.channels.delete(id);
  }

  setProvider(handler: ProviderHandler): void {
    this.provider = handler;
  }

  getChannel(id: ChannelId): ChannelHandler | undefined {
    return this.channels.get(id);
  }

  getProvider(): ProviderHandler | null {
    return this.provider;
  }

  listChannels(): ChannelStatus[] {
    return Array.from(this.channels.values()).map((ch) => ch.status());
  }

  async connectAll(): Promise<void> {
    const results = await Promise.allSettled(
      Array.from(this.channels.values()).map((ch) => ch.connect()),
    );
    for (const result of results) {
      if (result.status === "rejected") {
        console.error("[router] errore connessione canale:", result.reason);
      }
    }
  }

  async disconnectAll(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.channels.values()).map((ch) => ch.disconnect()),
    );
  }

  /**
   * Inoltra un messaggio al provider AI e restituisce la risposta.
   * Se il provider non e' configurato, lancia errore.
   */
  async routeToProvider(message: GatewayMessage): Promise<GatewayResponse> {
    if (!this.provider) {
      throw new Error("Nessun provider AI configurato");
    }
    return this.provider.chat(message);
  }

  /**
   * Invia una risposta al canale di origine del messaggio.
   */
  async routeToChannel(
    channelId: ChannelId,
    response: GatewayResponse,
  ): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Canale "${channelId}" non registrato`);
    }
    await channel.send(response);
  }
}
