/**
 * [JHT-TEAM-API-BOUNDARY] — «nessun agente» e «tmux è rotto» sono due cose.
 *
 * ADR-0009:111-113 mette per iscritto il modo di sbagliare che questo file
 * presidia: *«un tunnel caduto è indistinguibile da un team fermo se non è il
 * client a dirlo»*. La lista vuota è la bugia comoda — ha la forma di una
 * risposta valida, costa zero, e risponde «nessun agente» a chi ha chiesto
 * «cosa sta girando?» mentre la verità era «non ho potuto guardare».
 *
 * `listContainerSessions()` (`cli/src/utils/container-proxy.js:167-171`) la
 * racconta due volte: il suo comando finisce in `2>/dev/null || true`, quindi
 * il codice d'uscita è sempre 0 e lo stderr — l'unico posto dove tmux scrive
 * se il server non gira — è buttato; e `if (!r.ok) return []` trasforma un
 * fallimento di trasporto in un successo vuoto. Da lì i tre esiti arrivano al
 * chiamante come un valore solo, e nessun test a valle può più separarli.
 *
 * Il runner è iniettato per una ragione precisa: i tre esiti si provano solo
 * potendo dettare codice d'uscita e stderr, e nessun tmux vero li produce a
 * comando. Nessun processo viene lanciato qui e nessun file temporaneo viene
 * creato: il modulo è una funzione pura sopra un runner.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TMUX_ARGV,
  TMUX_OUTCOMES,
  TMUX_READ_TIMEOUT_MS,
  readTmuxSessions,
} from "../../../cli/src/lib/api/tmux-read.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const MODULE_REL = "cli/src/lib/api/tmux-read.js";
const MODULE_ABS = path.join(ROOT, MODULE_REL);

/** Il tetto di richiesta del server: la lettura tmux deve starci dentro. */
const SERVER_REQUEST_TIMEOUT_MS = 15_000;

type RunnerResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
};

type Call = { argv: string[]; opts: Record<string, unknown> | undefined };

/**
 * Un runner finto nella forma esatta di `execArgvInContainer`: `{ ok, stdout,
 * stderr, code }`. Registra le chiamate, perché metà del contratto di questo
 * modulo è COSA chiede a tmux, non solo cosa ne conclude.
 */
function fakeRunner(result: Partial<RunnerResult>) {
  const calls: Call[] = [];
  const runner = (argv: string[], opts?: Record<string, unknown>) => {
    calls.push({ argv, opts });
    return {
      ok: result.ok ?? true,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      code: result.code ?? 0,
    };
  };
  return { runner, calls };
}

/** Le tre risposte del mondo reale, una volta ciascuna. */
const OK_TWO_SESSIONS: Partial<RunnerResult> = {
  ok: true,
  code: 0,
  stdout: "CAPITANO\nSCOUT-1\n",
};
// tmux 3.3a (bookworm, l'immagine): esce 1 e lo scrive su stderr.
const NO_SERVER: Partial<RunnerResult> = {
  ok: true,
  code: 1,
  stderr: "no server running on /tmp/tmux-0/default",
};
// `docker exec` con il binario mancante: 127 e la frase di runc.
const BINARY_MISSING: Partial<RunnerResult> = {
  ok: true,
  code: 127,
  stderr:
    'OCI runtime exec failed: exec: "tmux": executable file not found in $PATH: unknown',
};
// spawnSync che non parte (ENOENT) o timeout: `container-proxy` traduce in
// `ok:false, code:-1` con stderr vuoto — nessun indizio nel testo.
const SPAWN_FAILED: Partial<RunnerResult> = {
  ok: false,
  code: -1,
  stdout: "",
  stderr: "",
};
// Trasporto: il container non è in esecuzione (`notRunning()`).
const TRANSPORT_DOWN: Partial<RunnerResult> = {
  ok: false,
  code: -1,
  stderr: "container 'jht' is not running",
};

function read(result: Partial<RunnerResult>) {
  const { runner, calls } = fakeRunner(result);
  const log = vi.fn();
  const out = readTmuxSessions({ runner, log });
  return { out, calls, log };
}

describe("readTmuxSessions — i tre esiti", () => {
  it("exit 0: i nomi sono quelli, così come tmux li scrive", () => {
    const { out } = read(OK_TWO_SESSIONS);
    expect(
      out.tmux,
      `${MODULE_REL}: un'uscita 0 è l'unico caso in cui i nomi si possono ` +
        "credere — deve essere 'ok'",
    ).toBe("ok");
    expect(
      out.sessions,
      `${MODULE_REL}: i nomi vanno restituiti grezzi (nessun filtro per ruolo, ` +
        "nessun prefisso aggiunto): la presentazione è del CLI",
    ).toEqual(["CAPITANO", "SCOUT-1"]);
  });

  it("exit 1 + 'no server running': tmux è autorevole, il team è spento", () => {
    const { out, log } = read(NO_SERVER);
    expect(
      out.tmux,
      `${MODULE_REL}: 'no server running' su stderr è tmux che RISPONDE — ` +
        "va mappato su 'no-server', non su 'absent' (sarebbe un 503 a team fermo)",
    ).toBe("no-server");
    expect(
      out.sessions,
      `${MODULE_REL}: con 'no-server' la lista è vuota per definizione`,
    ).toEqual([]);
    expect(
      log.mock.calls.length,
      `${MODULE_REL}: 'no-server' è un esito nominale — non deve scrivere ` +
        "niente in logs/api.log, o il diario diventa illeggibile a team spento",
    ).toBe(0);
  });

  it("exit 127 e ENOENT: non lo sappiamo, e si dice", () => {
    for (const [nome, fixture] of [
      ["exit 127 (binario mancante)", BINARY_MISSING],
      ["spawn fallito / timeout", SPAWN_FAILED],
      ["trasporto giù", TRANSPORT_DOWN],
    ] as const) {
      const { out } = read(fixture);
      expect(
        out.tmux,
        `${MODULE_REL}: «${nome}» non è «nessun agente» — deve dare 'absent', ` +
          "che la rotta traduce in 503 TMUX_UNAVAILABLE",
      ).toBe("absent");
    }
  });

  it("un runner che non rispetta il contratto è 'absent', non un successo", () => {
    // Il runner è iniettabile: la sua forma va verificata, non creduta. Un
    // `undefined` letto come `.code` diventerebbe un esito muto.
    for (const rotto of [undefined, null, "nope", 0]) {
      const log = vi.fn();
      const out = readTmuxSessions({
        runner: (() => rotto) as never,
        log,
      });
      expect(
        out.tmux,
        `${MODULE_REL}: un runner che restituisce ${JSON.stringify(rotto)} ` +
          "non ha detto nulla su tmux — l'esito è 'absent'",
      ).toBe("absent");
    }
  });
});

describe("i tre esiti restano distinguibili (ADR-0009:111-113)", () => {
  it("tre fixture reali, tre valori diversi di `tmux`", () => {
    const esiti = [OK_TWO_SESSIONS, NO_SERVER, BINARY_MISSING].map(
      (f) => read(f).out.tmux,
    );
    expect(
      new Set(esiti).size,
      `${MODULE_REL}: i tre esiti devono restare tre valori diversi — se ne ` +
        "collassano due, `jht team status` torna a dire «No active agent.» " +
        "quando tmux è rotto",
    ).toBe(3);
    expect(
      esiti.every((e) => TMUX_OUTCOMES.includes(e)),
      `${MODULE_REL}: ogni esito deve essere uno di TMUX_OUTCOMES ` +
        `(${TMUX_OUTCOMES.join(", ")})`,
    ).toBe(true);
  });

  it("la lunghezza di `sessions` NON è il segnale: due esiti la hanno vuota", () => {
    // È il punto: chi legge solo `sessions.length` non può distinguere. Il
    // significato sta nel campo `tmux`, e questo test lo dimostra invece di
    // scriverlo in un commento.
    const spento = read(NO_SERVER).out;
    const rotto = read(BINARY_MISSING).out;
    expect(spento.sessions.length, `${MODULE_REL}: 'no-server' → []`).toBe(0);
    expect(rotto.sessions.length, `${MODULE_REL}: 'absent' → []`).toBe(0);
    expect(
      spento.tmux === rotto.tmux,
      `${MODULE_REL}: 'no-server' e 'absent' hanno la stessa lista vuota, ` +
        "quindi il campo `tmux` è l'unico posto dove la differenza esiste: " +
        "non può essere lo stesso valore",
    ).toBe(false);
  });

  it("una lettura fallita non produce MAI un roster, nemmeno parziale", () => {
    // stdout residuo prima del guasto: se venisse letto, il chiamante
    // riceverebbe un elenco di agenti da una lettura che è fallita.
    const { out } = read({
      ok: false,
      code: -1,
      stdout: "CAPITANO\nSCOUT-1\n",
      stderr: "container 'jht' is not running",
    });
    expect(out.tmux, `${MODULE_REL}: guasto → 'absent'`).toBe("absent");
    expect(
      out.sessions,
      `${MODULE_REL}: con esito 'absent' lo stdout va IGNORATO — un roster ` +
        "estratto da una lettura fallita è la bugia peggiore delle due",
    ).toEqual([]);
  });
});

describe("cosa viene chiesto a tmux", () => {
  it("argv diretto, nessuna shell, nessuna redirezione", () => {
    const { calls } = read(OK_TWO_SESSIONS);
    expect(
      calls.length,
      `${MODULE_REL}: una lettura = una chiamata al runner`,
    ).toBe(1);
    expect(
      calls[0].argv,
      `${MODULE_REL}: l'argv deve essere TMUX_ARGV — e '#{session_name}' ` +
        "SENZA apici: gli apici sono sintassi di bash, e qui bash non c'è",
    ).toEqual([...TMUX_ARGV]);
    const piatto = calls[0].argv.join(" ");
    for (const vietato of ["2>/dev/null", "|| true", "bash", "-c", "'"]) {
      expect(
        piatto.includes(vietato),
        `${MODULE_REL}: «${vietato}» nell'argv è il difetto di ` +
          "listContainerSessions(): butta stderr e il codice d'uscita, cioè " +
          "proprio il dato che distingue 'no-server' da 'absent'",
      ).toBe(false);
    }
  });

  it("il timeout sta sotto il requestTimeout del server", () => {
    const { calls } = read(OK_TWO_SESSIONS);
    const timeoutMs = calls[0].opts?.timeoutMs as number | undefined;
    expect(
      typeof timeoutMs,
      `${MODULE_REL}: il default di execArgvInContainer è 30 s, il doppio del ` +
        "budget di una richiesta — il timeout va passato SEMPRE",
    ).toBe("number");
    expect(
      timeoutMs,
      `${MODULE_REL}: un tmux incantato più della richiesta HTTP fa cadere la ` +
        `connessione, che il client legge come «l'API non risponde» — resta ` +
        `sotto i ${SERVER_REQUEST_TIMEOUT_MS} ms di requestTimeout`,
    ).toBeLessThan(SERVER_REQUEST_TIMEOUT_MS);
    expect(timeoutMs, `${MODULE_REL}: e sopra zero`).toBeGreaterThan(0);
    expect(
      TMUX_READ_TIMEOUT_MS,
      `${MODULE_REL}: TMUX_READ_TIMEOUT_MS è il default usato dalla rotta`,
    ).toBe(timeoutMs);
  });

  it("i nomi arrivano puliti anche con \\r\\n e righe vuote", () => {
    // Il byte passa per `docker exec` e per una pipe di Windows quando il CLI
    // gira sull'host: un `\r` in coda produrrebbe nomi che non combaciano con
    // nessun ruolo, cioè un roster vuoto senza nessun errore.
    const { out } = read({
      ok: true,
      code: 0,
      stdout: "CAPITANO\r\n  SCOUT-1  \r\n\r\n",
    });
    expect(
      out.sessions,
      `${MODULE_REL}: trim per riga e righe vuote scartate, altrimenti un ` +
        "roster valido si legge come vuoto su Windows",
    ).toEqual(["CAPITANO", "SCOUT-1"]);
  });

  it("exit 0 con stdout vuoto è 'ok' con zero sessioni, non un guasto", () => {
    const { out } = read({ ok: true, code: 0, stdout: "" });
    expect(out.tmux, `${MODULE_REL}: tmux ha risposto: è 'ok'`).toBe("ok");
    expect(out.sessions, `${MODULE_REL}: e non c'è niente da elencare`).toEqual(
      [],
    );
  });
});

describe("il diario del caso brutto", () => {
  it("'absent' scrive UNA riga, in inglese, con la ragione e il codice", () => {
    const { log } = read(BINARY_MISSING);
    expect(
      log.mock.calls.length,
      `${MODULE_REL}: senza una riga di log, chi apre logs/api.log dopo un 503 ` +
        "trova «TMUX_UNAVAILABLE» e nessun indizio su quale dei modi di non " +
        "sapere sia capitato",
    ).toBe(1);
    const line = String(log.mock.calls[0][0]);
    expect(
      line.includes("\n"),
      `${MODULE_REL}: una riga sola — chi fa grep su logs/api.log deve ` +
        "ottenere un elenco di eventi, non un testo a capo",
    ).toBe(false);
    expect(
      line,
      `${MODULE_REL}: la riga deve nominare la ragione, o non serve a niente`,
    ).toMatch(/reason=binary-missing/);
    expect(line, `${MODULE_REL}: e il codice d'uscita`).toMatch(/exit=127/);
    // Le righe di log sono superficie a tolleranza zero del censimento copy
    // (scripts/analysis/backend_copy_census.py): `cli/src` è area censita e
    // `console.error` è uno dei suoi punti di raccolta.
    for (const italiano of [
      "sessione",
      "sessioni",
      "non disponibile",
      "errore",
      "impossibile",
    ]) {
      expect(
        line.toLowerCase().includes(italiano),
        `${MODULE_REL}: le stringhe visibili all'utente e nei log stanno in ` +
          "inglese (censimento copy: cli/src è a tolleranza zero)",
      ).toBe(false);
    }
  });

  it("le tre ragioni di 'absent' sono nomi diversi nel log", () => {
    const ragione = (f: Partial<RunnerResult>) => {
      const { log } = read(f);
      return /reason=([a-z0-9-]+)/.exec(String(log.mock.calls[0][0]))?.[1];
    };
    const nomi = [
      ragione(BINARY_MISSING),
      ragione(SPAWN_FAILED),
      ragione({ ok: true, code: 42, stderr: "tmux said something new" }),
    ];
    expect(
      new Set(nomi).size,
      `${MODULE_REL}: la risposta HTTP è la stessa (503), ma il log deve dire ` +
        "QUALE dei modi di non sapere è capitato: tre ragioni, tre nomi",
    ).toBe(3);
    expect(
      nomi.every(Boolean),
      `${MODULE_REL}: ogni riga di 'absent' porta una reason= riconoscibile`,
    ).toBe(true);
  });

  it("il log di serie va su stderr (finisce in logs/api.log via pid1)", () => {
    // pid1 prefissa `[api] ` e tee'a in $JHT_HOME/logs/api.log: se il default
    // non scrivesse su un flusso, il caso brutto sarebbe muto nel container —
    // il posto dove nessuno può attaccare un debugger.
    const spia = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { runner } = fakeRunner(SPAWN_FAILED);
      const out = readTmuxSessions({ runner });
      expect(out.tmux, `${MODULE_REL}: esito atteso 'absent'`).toBe("absent");
      expect(
        spia.mock.calls.length,
        `${MODULE_REL}: il log di serie deve esistere — un guasto dentro il ` +
          "container che non lascia traccia non è diagnosticabile",
      ).toBe(1);
      expect(
        String(spia.mock.calls[0][0]),
        `${MODULE_REL}: la riga va marcata, o non si trova con grep`,
      ).toContain("[tmux-read]");
    } finally {
      spia.mockRestore();
    }
  });

  it("un log che esplode non fa fallire la lettura", () => {
    const { runner } = fakeRunner(SPAWN_FAILED);
    const out = readTmuxSessions({
      runner,
      log: () => {
        throw new Error("no stderr");
      },
    });
    expect(
      out.tmux,
      `${MODULE_REL}: il diario è un accessorio — l'esito 'absent' è il ` +
        "messaggio che conta e deve arrivare comunque",
    ).toBe("absent");
  });
});

describe("i confini del modulo", () => {
  const src = readFileSync(MODULE_ABS, "utf8");
  /** Solo il codice: i commenti citano di proposito i nomi che il codice non deve usare. */
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");

  it("non passa da listContainerSessions()", () => {
    expect(
      /listContainerSessions\s*\(/.test(code),
      `${MODULE_REL}: listContainerSessions() finisce in '2>/dev/null || true' ` +
        "e restituisce [] sul fallimento di trasporto: usarla riporta i tre " +
        "esiti a uno, che è esattamente ciò che ADR-0009:111-113 vieta",
    ).toBe(false);
  });

  it("non porta dentro la tabella dei ruoli né la copy del CLI", () => {
    // Il server riporta il fatto; ruoli, colori e frasi restano nel CLI. Se
    // la tabella finisse qui, ogni client dovrebbe accettare la nostra — e le
    // due che il repo ha già non sono nemmeno d'accordo fra loro (7 voci in
    // commands/agents.js, 9 in commands/team/agents.js).
    for (const presentazione of [
      "AGENTS",
      "CAPITANO",
      "SCOUT",
      "ANALISTA",
      "SENTINELLA",
      "No active agent",
      "picocolors",
    ]) {
      expect(
        code.includes(presentazione),
        `${MODULE_REL}: «${presentazione}» è presentazione, non un fatto su ` +
          "tmux: sta nel CLI",
      ).toBe(false);
    }
  });

  it("zero dipendenze npm: ogni import è node:, . o /", () => {
    // È la premessa su cui poggia la misura del costo immagine (roadmap
    // §7.1): un bare specifier qui sarebbe una dipendenza dell'immagine.
    const specifiers = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map(
      (m) => m[1],
    );
    expect(
      specifiers.length,
      `${MODULE_REL}: l'estrattore degli import deve trovare qualcosa, ` +
        "altrimenti questo test è verde a vuoto",
    ).toBeGreaterThan(0);
    for (const s of specifiers) {
      expect(
        /^(node:|\.|\/)/.test(s),
        `${MODULE_REL}: import '${s}' — sotto cli/src/lib/api/ sono ammessi ` +
          "solo node:, relativi e assoluti (zero npm)",
      ).toBe(true);
    }
  }, 15_000);
});
