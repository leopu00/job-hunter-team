import { after } from "next/server";
import {
  createLandingHit,
  isLandingPath,
  type LandingHit,
  type LandingPath,
} from "@/lib/landing-funnel";
import { recordLandingHit } from "@/lib/landing-hits";

// O-47 — il conteggio sta QUI, sul server, e non nel browser.
//
// `ConsentedAnalytics` monta Vercel Analytics solo dopo il consenso: il
// client-side non vedrebbe /r e /t nella maggior parte dei casi, e il dato
// che lo dimostra c'è già — 1.052 pageview su 110 visitatori, 9,6 pagine a
// testa, che non è il traffico ma il sottoinsieme di chi accetta. Un
// contatore che misura solo chi dice di sì non può dire dove spendere.
//
// E sta in DUE route handler dedicati, non in un middleware: un
// `middleware.ts` gira su ogni richiesta del sito e ognuna è
// un'invocazione fatturata. Qui il costo cade solo su /r e /t, che sono
// esattamente le richieste da contare (stessa ragione per cui O-11 è stato
// chiuso col Firewall di Vercel).

type RedirectDependencies = {
  schedule: (task: () => void | Promise<void>) => void;
  record: (event: LandingHit) => Promise<void>;
  now: () => Date;
  logFailure: () => void;
};

const DEFAULT_DEPENDENCIES: RedirectDependencies = {
  schedule: after,
  record: recordLandingHit,
  now: () => new Date(),
  // Messaggio fisso per scelta: mai la richiesta, la query o l'errore del DB.
  logFailure: () =>
    console.error("[landing-funnel] aggregate increment failed"),
};

// `no-store` non è prudenza: un redirect messo in cache non torna al server e
// smette di essere contato — il contatore scenderebbe da solo mentre la
// campagna gira. `noindex` perché /r e /t sono percorsi tecnici: se un motore
// li indicizza, il conteggio si riempie di crawler e la landing si ritrova
// due URL doppioni.
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

/** Dove si atterra. Il redirect è temporaneo: /r e /t restano indirizzabili
 *  e riusabili per la prossima campagna — un 301 se lo terrebbe il browser. */
const LANDING_TARGET = "/";

export function handleLandingRedirect(
  request: Request,
  path: string,
  dependencies: RedirectDependencies = DEFAULT_DEPENDENCIES,
): Response {
  if (!isLandingPath(path)) {
    return new Response(request.method === "HEAD" ? null : "Not found", {
      status: 404,
      headers: RESPONSE_HEADERS,
    });
  }

  const event = createLandingHit(path as LandingPath, dependencies.now());
  const response = new Response(null, {
    status: 307,
    headers: { ...RESPONSE_HEADERS, Location: LANDING_TARGET },
  });

  try {
    dependencies.schedule(async () => {
      try {
        await dependencies.record(event);
      } catch {
        dependencies.logFailure();
      }
    });
  } catch {
    // Anche la misura è infrastruttura: non deve mai trattenere la persona
    // che ha cliccato l'annuncio. Se il conteggio non parte, il redirect sì.
    dependencies.logFailure();
  }

  return response;
}

export function landingMethodNotAllowed(): Response {
  return new Response("Method not allowed", {
    status: 405,
    headers: { ...RESPONSE_HEADERS, Allow: "GET, HEAD" },
  });
}
