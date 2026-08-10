// Le due porte d'ingresso degli annunci a pagamento: /r (Reddit) e /t (TikTok).
//
// O-47: dall'8 agosto si compra traffico su due piattaforme e non si sa da
// quale arrivi, quindi non si sa su quale conviene spingere. L'analytics del
// sito non può rispondere: si monta solo dopo il consenso, e infatti riporta
// 9,6 pagine per visitatore — non è il traffico, è il sottoinsieme di chi
// accetta.
//
// Queste due route rispondono PRIMA di qualunque consenso, perché contano le
// richieste al nostro server e non toccano il dispositivo di nessuno: è come
// contare chi entra in negozio.
//
// Perché due route handler dedicati e NON un middleware: un middleware gira
// su ogni richiesta del sito e ognuna è un'invocazione fatturata. Qui il costo
// cade solo su /r e /t, che sono esattamente le richieste da contare — stessa
// ragione per cui il crawler è stato fermato col firewall e non in codice.
//
// L'attribuzione non si ferma al clic: il redirect porta gli UTM sulla home,
// e da lì la macchina già esistente di `/go/[slug]` li riporta sul DOWNLOAD.
// Così si può dire non solo quanti clic arrivano da ciascuna piattaforma, ma
// quanti di quei clic diventano un'installazione — che è la domanda vera.

import type { DownloadAttribution } from "@/lib/download-funnel";

export const CAMPAIGN_SOURCES = {
  r: "reddit",
  t: "tiktok",
} as const;

export type CampaignPath = keyof typeof CAMPAIGN_SOURCES;

/** Campagna in corso. Cambiarla è una modifica esplicita, come l'allowlist. */
export const CAMPAIGN_NAME = "lancio-2026-08";

export function campaignAttribution(path: CampaignPath): DownloadAttribution {
  return {
    utm_source: CAMPAIGN_SOURCES[path],
    utm_medium: "paid",
    utm_campaign: CAMPAIGN_NAME,
  };
}

/** La home con l'attribuzione appesa. Relativo: vale su qualsiasi dominio. */
export function campaignDestination(path: CampaignPath): string {
  const a = campaignAttribution(path);
  return `/?utm_source=${a.utm_source}&utm_medium=${a.utm_medium}&utm_campaign=${a.utm_campaign}`;
}

type Deps = {
  log: (line: string) => void;
  now: () => Date;
};

const DEFAULT_DEPS: Deps = {
  // Riga fissa e strutturata: nessuna query, nessun IP, nessuno user agent.
  // Va cercata nei Runtime Logs come "[campaign-hit]".
  log: (line: string) => console.log(line),
  now: () => new Date(),
};

/**
 * 307 e non 301: un permanente lo cache il browser e la piattaforma, e da quel
 * momento il clic non arriva più fino a noi — cioè smetteremmo di contare
 * proprio ciò che stiamo pagando.
 */
export function handleCampaignHit(
  path: CampaignPath,
  request: Request,
  deps: Deps = DEFAULT_DEPS,
): Response {
  const hour = deps.now().toISOString().slice(0, 13);
  deps.log(
    `[campaign-hit] ts_hour=${hour} path=/${path} source=${CAMPAIGN_SOURCES[path]} campaign=${CAMPAIGN_NAME}`,
  );

  return new Response(null, {
    status: 307,
    headers: {
      Location: campaignDestination(path),
      // Senza questo un intermediario servirebbe il redirect dalla cache e il
      // conteggio perderebbe i clic successivi.
      "Cache-Control": "no-store",
      // Percorso tecnico, non contenuto: non deve finire in un indice.
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
