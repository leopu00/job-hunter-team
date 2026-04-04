/**
 * i18n — Dizionari traduzioni italiano/inglese
 */
import type { TranslationDictionary } from './types.js';

export const translations: TranslationDictionary = {
  it: {
    // Navigazione
    'nav.dashboard': 'Dashboard',
    'nav.agents': 'Agenti',
    'nav.tasks': 'Task',
    'nav.sessions': 'Sessioni',
    'nav.history': 'Cronologia',
    'nav.notifications': 'Notifiche',
    'nav.settings': 'Impostazioni',
    'nav.logs': 'Log',
    'nav.plugins': 'Plugin',
    'nav.templates': 'Template',
    'nav.channels': 'Canali',
    'nav.analytics': 'Analitiche',
    'nav.health': 'Stato sistema',

    // Comuni
    'common.save': 'Salva',
    'common.cancel': 'Annulla',
    'common.delete': 'Elimina',
    'common.edit': 'Modifica',
    'common.create': 'Crea',
    'common.search': 'Cerca...',
    'common.loading': 'Caricamento...',
    'common.error': 'Errore',
    'common.noResults': 'Nessun risultato trovato.',
    'common.confirm': 'Conferma',
    'common.back': 'Indietro',
    'common.all': 'tutti',
    'common.active': 'attivi',
    'common.total': 'totali',

    // Status
    'status.connected': 'connesso',
    'status.disconnected': 'disconnesso',
    'status.running': 'in esecuzione',
    'status.stopped': 'fermo',
    'status.error': 'errore',
    'status.enabled': 'abilitato',
    'status.disabled': 'disabilitato',

    // Tempo
    'time.now': 'adesso',
    'time.minutesAgo': '{n}m fa',
    'time.hoursAgo': '{n}h fa',
    'time.daysAgo': '{n}g fa',

    // Notifiche
    'notifications.markRead': 'segna letto',
    'notifications.markAllRead': 'segna tutte lette',
    'notifications.unread': 'non lette',
    'notifications.priority.low': 'bassa',
    'notifications.priority.normal': 'normale',
    'notifications.priority.high': 'alta',
    'notifications.priority.urgent': 'urgente',

    // Rate limit
    'rateLimit.tooMany': 'Troppe richieste. Riprova tra poco.',
  },

  en: {
    'nav.dashboard': 'Dashboard',
    'nav.agents': 'Agents',
    'nav.tasks': 'Tasks',
    'nav.sessions': 'Sessions',
    'nav.history': 'History',
    'nav.notifications': 'Notifications',
    'nav.settings': 'Settings',
    'nav.logs': 'Logs',
    'nav.plugins': 'Plugins',
    'nav.templates': 'Templates',
    'nav.channels': 'Channels',
    'nav.analytics': 'Analytics',
    'nav.health': 'System Health',

    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.create': 'Create',
    'common.search': 'Search...',
    'common.loading': 'Loading...',
    'common.error': 'Error',
    'common.noResults': 'No results found.',
    'common.confirm': 'Confirm',
    'common.back': 'Back',
    'common.all': 'all',
    'common.active': 'active',
    'common.total': 'total',

    'status.connected': 'connected',
    'status.disconnected': 'disconnected',
    'status.running': 'running',
    'status.stopped': 'stopped',
    'status.error': 'error',
    'status.enabled': 'enabled',
    'status.disabled': 'disabled',

    'time.now': 'now',
    'time.minutesAgo': '{n}m ago',
    'time.hoursAgo': '{n}h ago',
    'time.daysAgo': '{n}d ago',

    'notifications.markRead': 'mark read',
    'notifications.markAllRead': 'mark all read',
    'notifications.unread': 'unread',
    'notifications.priority.low': 'low',
    'notifications.priority.normal': 'normal',
    'notifications.priority.high': 'high',
    'notifications.priority.urgent': 'urgent',

    'rateLimit.tooMany': 'Too many requests. Please try again later.',
  },
};
