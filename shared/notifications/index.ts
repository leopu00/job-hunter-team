/**
 * JHT Notifications — Sistema notifiche multi-canale
 */

export type {
  NotificationChannel,
  NotificationPriority,
  Notification,
  NotificationResult,
  NotificationAdapter,
  SubscriptionMode,
  NotificationSubscription,
  NotificationEventType,
  NotificationEvent,
  NotificationEventListener,
  NotificationsConfig,
} from './types.js';

export { NOTIFICATION_CHANNELS, DEFAULT_NOTIFICATIONS_CONFIG } from './types.js';

export {
  registerAdapter,
  unregisterAdapter,
  getAdapter,
  listAdapters,
  listAvailableChannels,
  clearAdapters,
  onNotificationEvent,
  createNotification,
  send,
  broadcast,
} from './registry.js';

export {
  subscribe,
  unsubscribe,
  getSubscription,
  findSubscription,
  listSubscriptions,
  listSubscriptionsByChannel,
  pruneOneShot,
  subscriptionCount,
  clearSubscriptions,
} from './notifier.js';
