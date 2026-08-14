/**
 * #158 punto 2 — il cookie `jht_local_token` lo legge qualcuno, lo scrive
 * nessuno.
 *
 * `lib/local-token.ts` e `lib/auth.ts` dichiaravano che il middleware setta
 * quel cookie su richieste localhost dirette. È falso, ed è falso per
 * costruzione: il middleware gira su Edge runtime, dove `node:fs` non esiste
 * e `local-token.ts` non è nemmeno importabile. Nessun altro punto lo scrive.
 *
 * Non è un rischio — è una via d'accesso in MENO di quante ne risultino — ma
 * sta dentro il codice di autenticazione, cioè dove una convinzione sbagliata
 * costa di più: chi ragiona su "chi può entrare" contava una porta che non
 * c'era.
 *
 * Questo test tiene onesta la frase misurando il FATTO, non il testo del
 * commento: se domani qualcuno scrive quel cookie, diventa rosso e obbliga a
 * riallineare i due file (o a scoprire una scrittura che nessuno voleva).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const WEB = path.join(ROOT, "web");

const COOKIE = "jht_local_token";

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Le forme in cui un cookie si scrive in Next: `cookies().set(...)`,
 * `response.cookies.set(...)`, o l'header a mano. Cerchiamo la costante
 * `LOCAL_TOKEN_COOKIE` e il nome letterale, perché si può usare l'una o
 * l'altro.
 */
const WRITE_PATTERNS = [
  /cookies\s*\.\s*set\s*\(\s*(?:LOCAL_TOKEN_COOKIE|["'`]jht_local_token)/,
  /cookies\s*\(\s*\)\s*\.\s*set\s*\(\s*(?:LOCAL_TOKEN_COOKIE|["'`]jht_local_token)/,
  /["'`]Set-Cookie["'`][^\n]*jht_local_token/i,
  /jht_local_token\s*=\s*\$\{/,
];

describe("nessuno scrive il cookie local-token", () => {
  const writers: string[] = [];
  for (const file of sourceFiles(WEB)) {
    const src = readFileSync(file, "utf8");
    if (!src.includes(COOKIE) && !src.includes("LOCAL_TOKEN_COOKIE")) continue;
    if (WRITE_PATTERNS.some((re) => re.test(src)))
      writers.push(path.relative(ROOT, file));
  }

  it("in tutto web/ non c'è una scrittura di quel cookie", () => {
    expect(
      writers,
      "qualcuno ora SCRIVE jht_local_token: aggiorna la nota in " +
        "web/lib/local-token.ts e la lista delle vie d'accesso in " +
        "web/lib/auth.ts, che oggi dicono che non succede",
    ).toEqual([]);
  });

  it("il middleware non lo nomina nemmeno (gira su Edge, non potrebbe)", () => {
    const middleware = readFileSync(path.join(WEB, "middleware.ts"), "utf8");
    expect(middleware).not.toContain(COOKIE);
    expect(middleware).not.toContain("LOCAL_TOKEN_COOKIE");
  });

  it("lo scanner sa riconoscere una scrittura, se ci fosse", () => {
    // Senza questo, un regex rotto renderebbe verde il test per sempre.
    const finto = `const res = NextResponse.next()\nres.cookies.set(LOCAL_TOKEN_COOKIE, token)`;
    expect(WRITE_PATTERNS.some((re) => re.test(finto))).toBe(true);
  });
});
