import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  VERDICT_ORDER,
  VERDICT_SIGNAL,
  needsReason,
} from "@/lib/position-verdict";
import {
  FACTUAL_REASONS,
  REASON_ORDER,
  negativeSignalFor,
} from "@/app/(protected)/positions/[id]/exclusion-reasons";

const ROOT = resolve(import.meta.dirname, "../../..");
const read = (relative: string) =>
  readFileSync(resolve(ROOT, relative), "utf8");

const FEEDBACK_SURFACES = [
  "web/app/(protected)/positions/[id]/FeedbackButtons.tsx",
  "web/app/(protected)/swipe/SwipeDeck.tsx",
];

describe("O-76 feedback future-only boundary", () => {
  it("maps every verdict to feedback only, including dislike", () => {
    expect(VERDICT_SIGNAL.no).toEqual({
      action: "dislike",
      score: 1,
      direction: "less_like_this",
    });
    for (const signal of Object.values(VERDICT_SIGNAL)) {
      expect(signal).not.toHaveProperty("exclude");
    }
  });

  // Il confine di O-76 è che un GIUDIZIO non tolga di mezzo la posizione: un
  // «non mi interessa» insegna, non cancella. Fino a #167 quel confine si
  // leggeva come «il file non nomina la route di esclusione», che era un buon
  // proxy finché il pulsante faceva una cosa sola.
  //
  // #167 lo ha reso falso per una ragione voluta: «scaduta» e «già gestita»
  // sono FATTI sulla posizione, non gusti, e devono toglierla dal giro SENZA
  // insegnare allo Scout a evitare quel tipo di posizione. Il pulsante quindi
  // sceglie fra due azioni invece di farne una — e la proprietà da proteggere
  // non è più l'assenza di una stringa, è CHI può arrivare a quella route.
  //
  // La regola vive in `negativeSignalFor`, pura e testata a parte: qui si
  // verifica che il sorgente non possa raggiungere l'esclusione scavalcandola.
  //
  // ⚠️ Come questo caso era stato svuotato, perché non ricapiti: diceva «se
  // il sorgente contiene /user-exclude allora deve contenere
  // negativeSignalFor», ma il caso qui sotto pretende che TUTTE le superfici
  // contengano `negativeSignalFor`. Con il conseguente sempre vero
  // l'implicazione non vincola niente: un ramo futuro poteva chiamare la
  // route scavalcando la regola con la suite verde. Una clausola falsa era
  // stata sostituita da una tautologia.
  //
  // Ora si guarda il PUNTO DI CHIAMATA: uno solo per superficie, dopo la
  // regola pura, dentro il ramo che quella regola ha scelto, e con un corpo
  // costruito dal SEGNALE — non dal verdetto. Due punti di chiamata sono due
  // regole, e la seconda è quella che nessuno ha letto.
  it.each(FEEDBACK_SURFACES)(
    "%s reaches the exclusion writer from one guarded call site",
    (path) => {
      const source = read(path);
      expect(source).toContain("/feedback");
      expect(source.match(/\/user-exclude/g) ?? []).toHaveLength(1);
      const rule = source.indexOf("negativeSignalFor(");
      const guard = source.indexOf('signal.kind === "exclude"');
      const call = source.indexOf("/user-exclude");
      expect(rule, "la regola pura non viene nemmeno chiamata").toBeGreaterThan(
        -1,
      );
      expect(
        guard,
        "l'esclusione non è dietro il ramo del segnale",
      ).toBeGreaterThan(rule);
      expect(call, "si scrive prima di aver deciso").toBeGreaterThan(guard);
      // Il motivo spedito è quello che la regola ha validato: prenderlo da
      // un'altra parte rimetterebbe in giro un codice che nessuno ha
      // controllato.
      expect(source.slice(call, call + 400)).toContain("signal.reason");
    },
  );

  // #172 — la clausola «lo swipe non deve nominare l'esclusione» valeva
  // finché lo swipe non aveva un selettore: era il modo di dire «lì il
  // giudizio è secco, quindi non può che essere un gusto». Ora il selettore
  // c'è, chiesto DOPO il gesto, e quella formulazione vieterebbe proprio la
  // correzione che il ticket chiedeva.
  //
  // La proprietà da proteggere non cambia: un VERDETTO non toglie di mezzo
  // la posizione. Cambia chi la garantisce — non l'assenza di una stringa in
  // un file, ma il fatto che alla route ci si arrivi solo da un MOTIVO, e
  // solo se quel motivo è un fatto sulla posizione. Le due metà si
  // verificano insieme: la regola pura qui sotto, e sopra (`it.each`) che
  // nessuna delle due superfici raggiunga la route scavalcandola.
  it("keeps every taste verdict out of the exclusion path", () => {
    for (const path of FEEDBACK_SURFACES) {
      expect(read(path)).toContain("negativeSignalFor");
    }
    // Un verdetto resta un segnale di preferenza: se un giorno qualcuno gli
    // attaccasse un'esclusione, VERDICT_SIGNAL lo direbbe e il primo caso
    // sopra fallirebbe.
    for (const reason of REASON_ORDER) {
      const signal = negativeSignalFor(reason, "un testo qualsiasi");
      expect(signal.kind, reason).toBe(
        FACTUAL_REASONS.includes(reason) ? "exclude" : "feedback",
      );
    }
    // E il gesto che ci arriva è sempre e solo quello che ha chiesto il
    // perché: gli altri tre verdetti non hanno un motivo da valutare.
    expect(VERDICT_ORDER.filter(needsReason)).toEqual(["no"]);
  });

  it("keeps explicit exclusion as a separate action", () => {
    const page = read("web/app/(protected)/positions/[id]/page.tsx");
    const explicit = read(
      "web/app/(protected)/positions/[id]/ExcludeButton.tsx",
    );
    expect(page).toContain("<ExcludeButton");
    expect(explicit).toContain("/user-exclude");
  });

  it("uses the same non-exclusion label in all seven locales", () => {
    const labels = (source: string) =>
      [...source.matchAll(/verdicts:\s*\{\s*no:\s*"([^"]+)"/g)].map(
        ([, value]) => value,
      );
    const detail = labels(read(FEEDBACK_SURFACES[0]));
    const swipe = labels(read("web/app/(protected)/swipe/SwipeDeck.i18n.ts"));
    expect(detail).toHaveLength(7);
    expect(detail).toEqual(swipe);
  });

  it("describes future-only learning in all seven public Scorer locales", () => {
    const scorer = read("web/app/agents/page.tsx")
      .split('slug: "scorer"')[1]
      .split('slug: "scrittore"')[0];
    const paragraphs = [...scorer.matchAll(/p2:\s*"([^"]+)"/g)].map(
      ([, copy]) => copy,
    );
    const futureTerms = [
      "futuro",
      "future",
      "futuro",
      "avenir",
      "künftig",
      "futuro",
      "jövőben",
    ];
    expect(paragraphs).toHaveLength(7);
    paragraphs.forEach((copy, index) =>
      expect(copy.toLowerCase()).toContain(futureTerms[index]),
    );
    expect(scorer.toLowerCase()).not.toMatch(
      /ricalibra|recalibrates|recalibra|recalibre|kalibriert|igazítja a pontszámot/,
    );
  });

  it("keeps the Mentor cross-reference on aggregate future themes in EN+6", () => {
    const locales = ["", ".it", ".es", ".fr", ".de", ".pt", ".hu"];
    for (const locale of locales) {
      const source = read(`agents/_skills/mentor-patterns/SKILL${locale}.md`);
      const crossReference = source
        .split("\n")
        .find((line) => line.startsWith("- `feedback-query`"));
      expect(crossReference).toBeDefined();
      expect(crossReference).not.toMatch(
        /one position at a time|una posizione alla volta|una posición a la vez|position par position|Position für Position|uma posição de cada vez|pozíciónként/,
      );
    }
  });

  it("does not advertise a feedback verdict as discard in swipe metadata", () => {
    const metadata = read("web/app/(protected)/swipe/layout.tsx");
    expect(metadata.match(/^    description:/gm)).toHaveLength(7);
    expect(metadata).not.toMatch(
      /sinistra per scartare|left to discard|balra, ha nem|izquierda para descartar|links zum Aussortieren|gauche pour écarter|esquerda para descartar/,
    );
  });
});
