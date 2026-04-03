/**
 * JHT Notifications — Tipi per il sistema notifiche multi-canale.
 *
 * Supporta notifiche su desktop, telegram e web push.
 */

export const NOTIFICATION_CHANNELS = ['desktop', 'telegram', 'web'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Notification {
  id: string;
  channel: NotificationChannel;
  title: string;
  body: string;
  priority: NotificationPriority;
  timestamp: number;
  agentId?: string;
  sessionId?: string;
  meta?: Record<string, unknown>;
}

export interface NotificationResult {
  channel: NotificationChannel;
  success: boolean;
  messageId?: string;
  error?: string;
  sentAtMs: number;
}

export interface NotificationAdapter {
  readonly channel: NotificationChannel;
  /** Verifica se l'adapter e' disponibile (configurato, connesso) */
  isAvailable(): boolean;
  /** Invia una notifica attraverso questo canale */
  send(notification: Notification): Promise<NotificationResult>;
}

export type SubscriptionMode = 'persistent' | 'once';

export interface NotificationSubscription {
  id: string;
  channel: NotificationChannel;
  /** Destinatario (userId, chatId, endpoint push, ecc.) */
  target: string;
  mode: SubscriptionMode;
  userId?: string;
  createdAtMs: number;
}

export type NotificationEventType =
  | 'notification.sent'
  | 'notification.failed'
  | 'notification.broadcast';

export interface NotificationEvent {
  type: NotificationEventType;
  notification: Notification;
  result?: NotificationResult;
  results?: NotificationResult[];
  timestamp: number;
}

export type NotificationEventListener = (event: NotificationEvent) => void;

export interface NotificationsConfig {
  enabled: boolean;
  channels?: NotificationChannel[];
  desktopMinPriority?: NotificationPriority;
  telegramMinPriority?: NotificationPriority;
}

export const DEFAULT_NOTIFICATIONS_CONFIG: NotificationsConfig = {
  enabled: true,
  channels: ['desktop', 'telegram', 'web'],
};
