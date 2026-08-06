// Costanti della guida di setup: dove vive la pagina, e ogni URL che la
// guida propone all'utente.
//
// Perché in un file solo: i link di download sono in corso di revisione
// insieme ai comandi CLI (HQ-BACKEND) e lo slug della pagina è in attesa
// della scelta di naming (HQ-DOCS). Tenerli qui significa che entrambe le
// decisioni si applicano in un punto solo, senza rileggere le fasi.
//
// ⚠️ La guida NON è ancora pubblica: la route non è linkata dal menu e la
// pagina è `noindex`. Vedi `page.tsx`.

import type { OsId } from "./guide-types";

/** Slug della pagina. PROVVISORIO: la scelta di naming è di HQ-DOCS —
 *  vincoli noti: non «tutorial» per la pagina, non «videogioco» per
 *  l'artefatto installabile. Cambiando questa costante e la cartella della
 *  route, tutti i riferimenti interni seguono. */
export const GUIDE_PATH = "/setup-guide";

/** Base delle release GitHub: risolve sempre l'ultima pubblicata, così il
 *  link non va aggiornato a ogni versione (stesso meccanismo di /download,
 *  W04 — qualunque modifica qui si verifica contro una release reale). */
const RELEASE_BASE =
  "https://github.com/leopu00/job-hunter-team/releases/latest/download";

/** Nome dell'asset di release per sistema operativo. Allineato a
 *  `app/download/DownloadClient.tsx`: se cambia lì, cambia qui. */
const DESKTOP_ASSET: Record<OsId, string> = {
  macos: "job-hunter-team.zip",
  windows: "job-hunter-team-windows-x64-setup.exe",
  linux: "job-hunter-team-linux-x64.tar.gz",
};

/** URL di download diretto per il sistema selezionato. */
export function downloadUrlFor(os: OsId): string {
  return `${RELEASE_BASE}/${DESKTOP_ASSET[os]}`;
}

/** La pagina Download del sito, per chi arriva qui da un link diretto. */
export const DOWNLOAD_PAGE = "/download";

/** «Se non hai Docker, scaricalo da qui» — pagina ufficiale per sistema. */
export const DOCKER_URL: Record<OsId, string> = {
  macos: "https://docs.docker.com/desktop/install/mac-install/",
  windows: "https://docs.docker.com/desktop/install/windows-install/",
  linux: "https://docs.docker.com/engine/install/",
};

/** Installazione da terminale, per chi preferisce la CLI all'app. */
export const CLI_INSTALL_CMD =
  "curl -fsSL https://jobhunterteam.ai/install.sh | bash";

/** Pagine del sito citate dalle fasi. */
export const DOCS_PROVIDER = "/docs/guides/connect-ai-provider";
export const DOCS_PRIVACY = "/docs/guides/privacy-and-security";
export const DOCS_DASHBOARD = "/docs/guides/dashboard-and-results";
export const DOCS_FAQ = "/docs/guides/faq";

/** Risolve l'href di un link `external` che può variare per sistema. */
export function resolveExternalHref(
  href: string | Partial<Record<OsId, string>>,
  os: OsId,
): string | undefined {
  return typeof href === "string" ? href : href[os];
}
