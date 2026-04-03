/**
 * JHT Notifications — Gestione sottoscrizioni notifiche
 *
 * Subscriber persistenti e one-shot per notifiche multi-canale.
 */
import { randomUUID } from 'node:crypto';
import type { NotificationChannel, NotificationSubscription, SubscriptionMode } from './types.js';

const subscriptions = new Map<string, NotificationSubscription>();

export function subscribe(
  channel: NotificationChannel,
  target: string,
  opts?: { mode?: SubscriptionMode; userId?: string },
): NotificationSubscription {
  const existing = findSubscription(channel, target);
  if (existing) {
    existing.mode = opts?.mode ?? existing.mode;
    return existing;
  }
  const sub: NotificationSubscription = {
    id: randomUUID(), channel, target,
    mode: opts?.mode ?? 'persistent',
    userId: opts?.userId,
    createdAtMs: Date.now(),
  };
  subscriptions.set(sub.id, sub);
  return sub;
}

export function unsubscribe(id: string): boolean {
  return subscriptions.delete(id);
}

export function getSubscription(id: string): NotificationSubscription | undefined {
  return subscriptions.get(id);
}

export function findSubscription(
  channel: NotificationChannel,
  target: string,
): NotificationSubscription | undefined {
  for (const sub of subscriptions.values()) {
    if (sub.channel === channel && sub.target === target) return sub;
  }
  return undefined;
}

export function listSubscriptions(opts?: {
  channel?: NotificationChannel;
  userId?: string;
}): NotificationSubscription[] {
  let subs = Array.from(subscriptions.values());
  if (opts?.channel) subs = subs.filter((s) => s.channel === opts.channel);
  if (opts?.userId) subs = subs.filter((s) => s.userId === opts.userId);
  return subs;
}

export function listSubscriptionsByChannel(channel: NotificationChannel): NotificationSubscription[] {
  return listSubscriptions({ channel });
}

/** Rimuove tutte le sottoscrizioni one-shot (dopo consegna) */
export function pruneOneShot(): number {
  let removed = 0;
  for (const [id, sub] of subscriptions) {
    if (sub.mode === 'once') { subscriptions.delete(id); removed++; }
  }
  return removed;
}

export function subscriptionCount(channel?: NotificationChannel): number {
  if (!channel) return subscriptions.size;
  return listSubscriptionsByChannel(channel).length;
}

export function clearSubscriptions(): void {
  subscriptions.clear();
}
