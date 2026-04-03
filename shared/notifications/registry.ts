/**
 * JHT Notifications — Registry adapter e invio notifiche
 */
import { randomUUID } from 'node:crypto';
import type {
  Notification,
  NotificationAdapter,
  NotificationChannel,
  NotificationEvent,
  NotificationEventListener,
  NotificationPriority,
  NotificationResult,
} from './types.js';

const adapters = new Map<NotificationChannel, NotificationAdapter>();
const listeners = new Set<NotificationEventListener>();

export function onNotificationEvent(listener: NotificationEventListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function emit(event: NotificationEvent): void {
  for (const listener of listeners) {
    try { listener(event); } catch { /* best-effort */ }
  }
}

export function registerAdapter(adapter: NotificationAdapter): void {
  adapters.set(adapter.channel, adapter);
}

export function unregisterAdapter(channel: NotificationChannel): boolean {
  return adapters.delete(channel);
}

export function getAdapter(channel: NotificationChannel): NotificationAdapter | undefined {
  return adapters.get(channel);
}

export function listAdapters(): NotificationAdapter[] {
  return Array.from(adapters.values());
}

export function listAvailableChannels(): NotificationChannel[] {
  return listAdapters().filter((a) => a.isAvailable()).map((a) => a.channel);
}

export function clearAdapters(): void {
  adapters.clear();
  listeners.clear();
}

export function createNotification(
  channel: NotificationChannel,
  title: string,
  body: string,
  opts?: { priority?: NotificationPriority; agentId?: string; sessionId?: string; meta?: Record<string, unknown> },
): Notification {
  return {
    id: randomUUID(),
    channel,
    title,
    body,
    priority: opts?.priority ?? 'normal',
    timestamp: Date.now(),
    agentId: opts?.agentId,
    sessionId: opts?.sessionId,
    meta: opts?.meta,
  };
}

export async function send(notification: Notification): Promise<NotificationResult> {
  const adapter = adapters.get(notification.channel);
  if (!adapter || !adapter.isAvailable()) {
    const result: NotificationResult = {
      channel: notification.channel, success: false,
      error: adapter ? 'Adapter non disponibile' : `Nessun adapter per "${notification.channel}"`,
      sentAtMs: Date.now(),
    };
    emit({ type: 'notification.failed', notification, result, timestamp: Date.now() });
    return result;
  }

  try {
    const result = await adapter.send(notification);
    emit({ type: result.success ? 'notification.sent' : 'notification.failed', notification, result, timestamp: Date.now() });
    return result;
  } catch (err) {
    const result: NotificationResult = {
      channel: notification.channel, success: false,
      error: (err as Error).message, sentAtMs: Date.now(),
    };
    emit({ type: 'notification.failed', notification, result, timestamp: Date.now() });
    return result;
  }
}

export async function broadcast(
  title: string,
  body: string,
  opts?: { channels?: NotificationChannel[]; priority?: NotificationPriority; agentId?: string },
): Promise<NotificationResult[]> {
  const channels = opts?.channels ?? listAvailableChannels();
  const results: NotificationResult[] = [];

  for (const channel of channels) {
    const notification = createNotification(channel, title, body, opts);
    results.push(await send(notification));
  }

  if (channels.length > 0) {
    emit({
      type: 'notification.broadcast',
      notification: createNotification(channels[0], title, body, opts),
      results, timestamp: Date.now(),
    });
  }

  return results;
}
