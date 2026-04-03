/**
 * JHT Channels — CLI Channel (stdin/stdout)
 *
 * Canale per interazione via terminale. Legge da stdin,
 * scrive su stdout. Supporta readline per input interattivo.
 */
import * as readline from 'node:readline';
import type { Channel, ChannelMeta, ChannelMessage, MessageHandler } from './channel.js';
import { buildInboundMessage, buildOutboundMessage } from './channel.js';

const CLI_META: ChannelMeta = {
  id: 'cli',
  label: 'CLI',
  description: 'Terminale — input/output via stdin/stdout',
  capabilities: {
    markdown: false,
    streaming: true,
    attachments: false,
    push: false,
  },
};

export class CLIChannel implements Channel {
  readonly id = 'cli' as const;
  readonly meta = CLI_META;

  #connected = false;
  #handlers: Set<MessageHandler> = new Set();
  #rl: readline.Interface | null = null;
  #prompt: string;

  constructor(opts?: { prompt?: string }) {
    this.#prompt = opts?.prompt ?? 'jht> ';
  }

  get connected(): boolean {
    return this.#connected;
  }

  async connect(): Promise<void> {
    if (this.#connected) return;

    this.#rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.#prompt,
    });

    this.#rl.on('line', async (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const message = buildInboundMessage('cli', {
        text: trimmed,
        sender: 'user',
      });

      for (const handler of this.#handlers) {
        try {
          await handler(message);
        } catch (err) {
          console.error('[cli-channel] Errore handler:', (err as Error).message);
        }
      }
    });

    this.#rl.on('close', () => {
      this.#connected = false;
    });

    this.#connected = true;
    this.#rl.prompt();
  }

  async disconnect(): Promise<void> {
    if (this.#rl) {
      this.#rl.close();
      this.#rl = null;
    }
    this.#connected = false;
    this.#handlers.clear();
  }

  async send(
    params: Omit<ChannelMessage, 'id' | 'channelId' | 'direction' | 'timestamp'>,
  ): Promise<ChannelMessage> {
    const message = buildOutboundMessage('cli', params);
    process.stdout.write(message.text + '\n');

    if (this.#rl) {
      this.#rl.prompt();
    }

    return message;
  }

  onMessage(handler: MessageHandler): () => void {
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
  }

  /** Mostra il prompt senza attendere input */
  showPrompt(): void {
    this.#rl?.prompt();
  }
}
