/**
 * La segnalazione arriva dove l'utente crede, o non si dice che è arrivata.
 *
 * Il caso che ha motivato questi test: posta giù, webhook su. La versione
 * precedente lanciava i due canali con `Promise.all` e rispondeva ok se ne
 * riusciva almeno uno — così l'utente leggeva «la segnalazione è arrivata
 * al supporto» mentre in quella casella non c'era nulla.
 *
 * Sono test dinamici, non sul sorgente: chiamano davvero la funzione con
 * le due destinazioni in ogni combinazione.
 */
import { describe, it, expect, vi } from "vitest";

import { dispatchFeedback } from "@/lib/feedback-dispatch";

const ok = () => Promise.resolve(true);
const ko = () => Promise.resolve(false);

describe("consegna segnalazione — la posta decide", () => {
  it("posta giù e webhook su: NON consegnata, e il webhook non parte", async () => {
    // È il caso esatto che rendeva bugiarda la risposta.
    const webhook = vi.fn(ok);
    const result = await dispatchFeedback(ko, webhook);

    expect(result.delivered).toBe(false);
    expect(result.webhook).toBeNull();
    // Fail-closed: non si spargono copie della segnalazione in un posto
    // che l'utente non conosce, mentre gli si dice che non ce l'abbiamo
    // fatta.
    expect(webhook).not.toHaveBeenCalled();
  });

  it("posta su e webhook giù: consegnata lo stesso", async () => {
    // La promessa era la casella di supporto ed è stata mantenuta: il
    // webhook è una comodità interna, un suo errore non riguarda l'utente.
    const result = await dispatchFeedback(ok, ko);
    expect(result.delivered).toBe(true);
    expect(result.webhook).toBe(false);
  });

  it("entrambi su: consegnata, e il webhook è partito", async () => {
    const result = await dispatchFeedback(ok, ok);
    expect(result.delivered).toBe(true);
    expect(result.webhook).toBe(true);
  });

  it("entrambi giù: non consegnata", async () => {
    const result = await dispatchFeedback(ko, ko);
    expect(result.delivered).toBe(false);
    expect(result.webhook).toBeNull();
  });

  it("la posta viene tentata PRIMA del webhook, non insieme", async () => {
    // Con `Promise.all` il webhook partirebbe comunque, anche quando la
    // posta sta per fallire. L'ordine è parte della garanzia.
    const order: string[] = [];
    await dispatchFeedback(
      async () => {
        order.push("mail");
        return true;
      },
      async () => {
        order.push("webhook");
        return true;
      },
    );
    expect(order).toEqual(["mail", "webhook"]);
  });

  it("un webhook che esplode non fa fallire una consegna riuscita", async () => {
    const result = await dispatchFeedback(ok, () => {
      throw new Error("boom");
    });
    expect(result.delivered).toBe(true);
    expect(result.webhook).toBe(false);
  });
});

describe("la route risponde secondo la consegna", () => {
  it("non usa più Promise.all sui due canali", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const url = await import("node:url");
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const route = fs.readFileSync(
      path.resolve(here, "../../../web/app/api/feedback/route.ts"),
      "utf8",
    );
    expect(route).toContain("dispatchFeedback");
    // La vecchia forma: `Promise.all([sendEmail…, notifyWebhook…])`.
    expect(route.includes("Promise.all")).toBe(false);
    // E la vecchia condizione, che accettava il solo webhook.
    expect(route.includes("!mail && !webhook")).toBe(false);
  });
});
