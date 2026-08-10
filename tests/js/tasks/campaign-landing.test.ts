import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_NAME,
  CAMPAIGN_SOURCES,
  campaignDestination,
  handleCampaignHit,
} from "../../../web/lib/campaign-landing";
import { DOWNLOAD_ATTRIBUTION_ALLOWLIST } from "../../../web/lib/download-funnel";
import robots from "../../../web/app/robots";
import sitemap from "../../../web/app/sitemap";
import { GET as getR } from "../../../web/app/r/route";
import { GET as getT } from "../../../web/app/t/route";

/**
 * O-47 — /r e /t sono le porte d'ingresso degli annunci a pagamento. Il
 * ticket nasce da un costo che scorre: si compra su due piattaforme e non si
 * sa da quale arrivi il traffico.
 *
 * Questi test guardano le tre cose che, se sbagliate, rendono la spesa
 * inattribuibile senza che nessuno se ne accorga: il redirect deve restare
 * temporaneo, l'attribuzione deve sopravvivere fino al download, e i due
 * percorsi non devono finire negli indici.
 */

function deps() {
  const lines: string[] = [];
  return {
    lines,
    log: (l: string) => lines.push(l),
    now: () => new Date("2026-08-11T01:30:00.000Z"),
  };
}

describe("le due porte di campagna", () => {
  it.each([
    ["r", "reddit"],
    ["t", "tiktok"],
  ] as const)("/%s rimanda alla home attribuendo a %s", (path, source) => {
    const d = deps();
    const res = handleCampaignHit(path, new Request("https://x/" + path), d);

    const location = res.headers.get("Location")!;
    expect(location.startsWith("/?")).toBe(true);
    expect(location).toContain(`utm_source=${source}`);
    expect(location).toContain("utm_medium=paid");
    expect(location).toContain(`utm_campaign=${CAMPAIGN_NAME}`);
  });

  it("usa 307 e non un permanente", () => {
    // Un 301 lo cachano browser e piattaforma: da quel momento il clic non
    // arriva più fino a noi e smetteremmo di contare proprio ciò che paghiamo.
    for (const p of ["r", "t"] as const) {
      expect(
        handleCampaignHit(p, new Request("https://x"), deps()).status,
      ).toBe(307);
    }
  });

  it("vieta la cache del redirect", () => {
    const res = handleCampaignHit("r", new Request("https://x"), deps());
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("si dichiara non indicizzabile nella risposta", () => {
    const res = handleCampaignHit("t", new Request("https://x"), deps());
    expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
  });

  it("registra una riga contabile per ogni richiesta", () => {
    const d = deps();
    handleCampaignHit("t", new Request("https://x/t"), d);

    expect(d.lines).toHaveLength(1);
    expect(d.lines[0]).toContain("[campaign-hit]");
    expect(d.lines[0]).toContain("path=/t");
    expect(d.lines[0]).toContain("source=tiktok");
    expect(d.lines[0]).toContain("ts_hour=2026-08-11T01");
  });

  it("non scrive nel log nulla della richiesta", () => {
    // Un URL pubblicitario può portarsi dietro identificativi di click della
    // piattaforma: la riga di log deve restare fissa, non ricopiare la query.
    const d = deps();
    handleCampaignHit(
      "r",
      new Request("https://x/r?ttclid=SEGRETO&fbclid=ALTRO"),
      d,
    );

    expect(d.lines[0]).not.toContain("SEGRETO");
    expect(d.lines[0]).not.toContain("ttclid");
  });
});

describe("l'attribuzione fino al download", () => {
  it("reddit arriva fino al download, tiktok ANCORA NO — e non è una svista", () => {
    // La tabella `download_clicks` ha un CHECK su ('none','reddit'): mettere
    // 'tiktok' nell'allowlist senza migrazione farebbe fallire l'INSERT
    // proprio sui download da TikTok. Questo test tiene insieme le due cose,
    // così quando arriverà la migrazione (O-50) fallirà qui, ricordando che
    // l'allowlist va estesa nello stesso giro.
    expect(DOWNLOAD_ATTRIBUTION_ALLOWLIST.utm_source).toEqual(["reddit"]);
    expect(Object.values(CAMPAIGN_SOURCES)).toContain("tiktok");
  });

  it("la campagna del redirect è quella che il funnel accetta", () => {
    expect(DOWNLOAD_ATTRIBUTION_ALLOWLIST.utm_campaign).toContain(
      CAMPAIGN_NAME,
    );
    expect(DOWNLOAD_ATTRIBUTION_ALLOWLIST.utm_medium).toContain("paid");
  });
});

describe("i due percorsi restano fuori dagli indici", () => {
  it("robots.txt li vieta", () => {
    const rules = robots().rules;
    const disallow = (Array.isArray(rules) ? rules : [rules]).flatMap((r) =>
      Array.isArray(r.disallow) ? r.disallow : r.disallow ? [r.disallow] : [],
    );
    expect(disallow).toContain("/r");
    expect(disallow).toContain("/t");
  });

  it("la sitemap non li elenca", () => {
    const urls = sitemap().map((e) => new URL(e.url).pathname);
    expect(urls).not.toContain("/r");
    expect(urls).not.toContain("/t");
  });
});

describe("le due route usano la stessa logica", () => {
  it("nessuna delle due reimplementa il redirect", () => {
    // Due copie divergono: la prima volta che si cambia la campagna, una delle
    // due resta indietro e attribuisce a una campagna che non esiste più.
    expect(getR(new Request("https://x/r")).headers.get("Location")).toBe(
      campaignDestination("r"),
    );
    expect(getT(new Request("https://x/t")).headers.get("Location")).toBe(
      campaignDestination("t"),
    );
  });
});
