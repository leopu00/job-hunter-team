// Dictionary of the band that says a box no longer syncs because of its token
// (app/components/SyncTokenBanner.tsx). `satisfies Dictionary` makes the
// compiler want all seven languages.
import type { Dictionary } from "@/lib/i18n-dict";

export const SYNC_TOKEN_BANNER_T = {
  expiredLabel: {
    it: "Box scollegato",
    en: "Box disconnected",
    hu: "A gép nincs csatlakoztatva",
    es: "Equipo desconectado",
    de: "Gerät getrennt",
    fr: "Machine déconnectée",
    pt: "Máquina desligada",
  },
  expired: {
    it: "Il token del box «{name}» è scaduto il {date}: da allora il box non sincronizza e le posizioni nuove non arrivano qui.",
    en: "The token of the box «{name}» expired on {date}: since then the box does not sync and new positions do not reach this site.",
    hu: "A(z) «{name}» gép tokenje lejárt: {date}. Azóta a gép nem szinkronizál, és az új pozíciók nem érkeznek ide.",
    es: "El token del equipo «{name}» caducó el {date}: desde entonces el equipo no se sincroniza y las posiciones nuevas no llegan aquí.",
    de: "Das Token des Geräts «{name}» ist am {date} abgelaufen: Seitdem synchronisiert das Gerät nicht, und neue Stellen kommen hier nicht an.",
    fr: "Le jeton de la machine « {name} » a expiré le {date} : depuis, la machine ne se synchronise plus et les nouvelles offres n'arrivent pas ici.",
    pt: "O token da máquina «{name}» expirou a {date}: desde então a máquina não sincroniza e as posições novas não chegam aqui.",
  },
  expiringLabel: {
    it: "Token in scadenza",
    en: "Token expiring",
    hu: "Lejáró token",
    es: "Token a punto de caducar",
    de: "Token läuft ab",
    fr: "Jeton bientôt expiré",
    pt: "Token a expirar",
  },
  expiring: {
    it: "Il token del box «{name}» scade il {date} (giorni rimasti: {days}): rinnovalo prima, altrimenti il box si scollega.",
    en: "The token of the box «{name}» expires on {date} (days left: {days}): renew it before then, or the box disconnects.",
    hu: "A(z) «{name}» gép tokenje lejár: {date} (hátralévő napok: {days}). Addig újítsd meg, különben a gép lecsatlakozik.",
    es: "El token del equipo «{name}» caduca el {date} (días restantes: {days}): renuévalo antes o el equipo se desconectará.",
    de: "Das Token des Geräts «{name}» läuft am {date} ab (verbleibende Tage: {days}): Erneuere es vorher, sonst wird das Gerät getrennt.",
    fr: "Le jeton de la machine « {name} » expire le {date} (jours restants : {days}) : renouvelle-le avant, sinon la machine sera déconnectée.",
    pt: "O token da máquina «{name}» expira a {date} (dias restantes: {days}): renova-o antes, ou a máquina desliga-se.",
  },
  renew: {
    it: "Rinnova il token",
    en: "Renew the token",
    hu: "Token megújítása",
    es: "Renovar el token",
    de: "Token erneuern",
    fr: "Renouveler le jeton",
    pt: "Renovar o token",
  },
} satisfies Dictionary;
