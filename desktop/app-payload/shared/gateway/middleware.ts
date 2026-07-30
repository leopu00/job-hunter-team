/**
 * Gateway Middleware — Pipeline pre/post processing per messaggi.
 *
 * I middleware vengono eseguiti in ordine di priorita' (crescente).
 * Fase "pre": prima di inviare al provider AI.
 * Fase "post": dopo aver ricevuto la risposta.
 */

import type {
  MiddlewareContext,
  MiddlewareDescriptor,
  MiddlewarePhase,
  GatewayMessage,
} from "./types.js";

export class MiddlewarePipeline {
  private middlewares: MiddlewareDescriptor[] = [];

  register(descriptor: MiddlewareDescriptor): void {
    this.middlewares.push(descriptor);
    this.middlewares.sort((a, b) => a.priority - b.priority);
  }

  unregister(name: string): boolean {
    const idx = this.middlewares.findIndex((m) => m.name === name);
    if (idx === -1) return false;
    this.middlewares.splice(idx, 1);
    return true;
  }

  list(phase?: MiddlewarePhase): MiddlewareDescriptor[] {
    if (!phase) return [...this.middlewares];
    return this.middlewares.filter((m) => m.phase === phase);
  }

  async runPre(message: GatewayMessage): Promise<MiddlewareContext> {
    let ctx = createContext(message);
    for (const mw of this.middlewares.filter((m) => m.phase === "pre")) {
      if (ctx.aborted) break;
      ctx = await mw.handler(ctx);
    }
    return ctx;
  }

  async runPost(ctx: MiddlewareContext): Promise<MiddlewareContext> {
    for (const mw of this.middlewares.filter((m) => m.phase === "post")) {
      if (ctx.aborted) break;
      ctx = await mw.handler(ctx);
    }
    return ctx;
  }
}

function createContext(message: GatewayMessage): MiddlewareContext {
  return {
    message,
    metadata: {},
    aborted: false,
  };
}

// --- Middleware built-in: logging ---

export const loggingMiddleware: MiddlewareDescriptor = {
  name: "logging",
  phase: "pre",
  priority: 0,
  handler: async (ctx) => {
    ctx.metadata.receivedAt = Date.now();
    return ctx;
  },
};

// --- Middleware built-in: rate limit ---

export function createRateLimitMiddleware(
  maxPerMinute: number,
): MiddlewareDescriptor {
  const windowMs = 60_000;
  const timestamps: number[] = [];

  return {
    name: "rate-limit",
    phase: "pre",
    priority: 10,
    handler: async (ctx) => {
      const now = Date.now();
      // Rimuovi timestamp fuori finestra
      while (timestamps.length > 0 && timestamps[0] < now - windowMs) {
        timestamps.shift();
      }
      if (timestamps.length >= maxPerMinute) {
        ctx.aborted = true;
        ctx.abortReason = `Rate limit: max ${maxPerMinute} messaggi/min`;
        return ctx;
      }
      timestamps.push(now);
      return ctx;
    },
  };
}
