/**
 * JHT Channels — Registry canali attivi
 *
 * Registro centralizzato per tutti i canali. Permette di registrare,
 * recuperare, e inviare messaggi broadcast a tutti i canali attivi.
 */
import type { Channel, ChannelId, ChannelMessage, MessageHandler } from './channel.js';

export class ChannelRegistry {
  #channels: Map<ChannelId, Channel> = new Map();
  #globalHandlers: Set<MessageHandler> = new Set();

  /** Registra un canale. Sovrascrive se gia' presente. */
  register(channel: Channel): void {
    this.#channels.set(channel.id, channel);
  }

  /** Rimuove un canale dal registro. */
  unregister(id: ChannelId): boolean {
    return this.#channels.delete(id);
  }

  /** Recupera un canale per ID. */
  get(id: ChannelId): Channel | undefined {
    return this.#channels.get(id);
  }

  /** Verifica se un canale e' registrato. */
  has(id: ChannelId): boolean {
    return this.#channels.has(id);
  }

  /** Lista tutti i canali registrati. */
  list(): Channel[] {
    return [...this.#channels.values()];
  }

  /** Lista gli ID dei canali registrati. */
  listIds(): ChannelId[] {
    return [...this.#channels.keys()];
  }

  /** Lista solo i canali connessi. */
  listConnected(): Channel[] {
    return this.list().filter((ch) => ch.connected);
  }

  /**
   * Connette tutti i canali registrati.
   * Ritorna un report con successi e errori.
   */
  async connectAll(): Promise<{ connected: ChannelId[]; errors: Array<{ id: ChannelId; error: string }> }> {
    const connected: ChannelId[] = [];
    const errors: Array<{ id: ChannelId; error: string }> = [];

    for (const channel of this.#channels.values()) {
      try {
        await channel.connect();
        connected.push(channel.id);
      } catch (err) {
        errors.push({ id: channel.id, error: (err as Error).message });
      }
    }

    return { connected, errors };
  }

  /** Disconnette tutti i canali. */
  async disconnectAll(): Promise<void> {
    for (const channel of this.#channels.values()) {
      try {
        await channel.disconnect();
      } catch {
        // Ignora errori in fase di disconnect
      }
    }
  }

  /**
   * Invia un messaggio a un canale specifico.
   */
  async sendTo(
    id: ChannelId,
    params: Omit<ChannelMessage, 'id' | 'channelId' | 'direction' | 'timestamp'>,
  ): Promise<ChannelMessage | null> {
    const channel = this.#channels.get(id);
    if (!channel?.connected) return null;
    return channel.send(params);
  }

  /**
   * Broadcast: invia un messaggio a tutti i canali connessi.
   * Ritorna i messaggi inviati con successo.
   */
  async broadcast(
    params: Omit<ChannelMessage, 'id' | 'channelId' | 'direction' | 'timestamp'>,
  ): Promise<ChannelMessage[]> {
    const results: ChannelMessage[] = [];
    for (const channel of this.listConnected()) {
      try {
        const msg = await channel.send(params);
        results.push(msg);
      } catch {
        // Continua con gli altri canali
      }
    }
    return results;
  }

  /**
   * Registra un handler globale per messaggi da TUTTI i canali.
   * Ritorna una funzione per rimuovere l'handler.
   */
  onAnyMessage(handler: MessageHandler): () => void {
    this.#globalHandlers.add(handler);

    const unsubscribers: Array<() => void> = [];
    for (const channel of this.#channels.values()) {
      unsubscribers.push(channel.onMessage(handler));
    }

    return () => {
      this.#globalHandlers.delete(handler);
      for (const unsub of unsubscribers) unsub();
    };
  }

  /** Numero di canali registrati */
  get size(): number {
    return this.#channels.size;
  }
}

/** Istanza singleton del registry */
let defaultRegistry: ChannelRegistry | null = null;

export function getDefaultRegistry(): ChannelRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new ChannelRegistry();
  }
  return defaultRegistry;
}

export function resetDefaultRegistry(): void {
  defaultRegistry = null;
}
