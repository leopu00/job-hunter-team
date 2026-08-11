/**
 * Test unitari — cli/src/lib/chat-sync.js (vitest)
 *
 * [JHT-CHAT-UNIFY] Questa corsia esiste perché la stessa chat viveva in due
 * posti che non si parlavano: `chat.jsonl` (videogioco) e
 * `pending_user_messages` (web/cloud). Il modulo li tiene allineati nei due
 * versi e consegna i turni dell'utente al pane tmux dell'agente.
 *
 * Cosa proteggono questi test — cioè cosa può rompersi in silenzio:
 *  · il MIRROR non deve fare ping-pong: una riga letta dal file e importata
 *    in SQLite non deve tornare nel file al giro dopo (e viceversa). È la
 *    trappola classica di ogni mirror bidirezionale, e si manifesta come
 *    duplicazione infinita, non come errore;
 *  · un messaggio dell'utente NON si perde mai: se il pane è occupato la
 *    consegna fallisce e si ritenta — `delivered_at` resta NULL;
 *  · il primo giro dopo l'aggiornamento non deve riversare mesi di storico
 *    nella chat del gioco;
 *  · il `ts` di un turno nato sul web è deterministico: se cambiasse fra un
 *    tentativo di consegna e l'altro, la dedup fallirebbe e l'utente
 *    vedrebbe il proprio messaggio due volte.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { appendFileSync, mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CHAT_AGENTS,
  authorFromRole,
  chatChannelFor,
  chatEnvelope,
  chatFileFor,
  chatPending,
  chatTsOf,
  cloudRequestFailure,
  deliverPendingUserTurns,
  diagnoseChatLane,
  fileChanged,
  importCloudUserTurns,
  ingestChatJsonl,
  jsonlLine,
  markChatRowsPushed,
  mirrorDbTurnsToJsonl,
  parseChatLine,
  pickUnmirrored,
  readTailLines,
  shouldAnnounceStall,
  takeChatRowsToPush,
  tmuxSessionFor,
  toCloudRow,
  undeliveredUserTurns,
} from "../../../cli/src/lib/chat-sync.js";

// Schema minimo ma FEDELE alla tabella reale (shared/skills/_db.py): se il
// test girasse su uno schema semplificato non direbbe nulla sulle colonne
// che il codice usa davvero.
const SCHEMA = `
CREATE TABLE pending_user_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'notification',
  author TEXT NOT NULL DEFAULT 'agent',
  chat_ts REAL,
  related_position_id INTEGER,
  delivered_via TEXT,
  delivered_at TIMESTAMP,
  acknowledged_at TIMESTAMP,
  user_reply TEXT,
  user_reply_at TIMESTAMP,
  agent_seen_reply_at TIMESTAMP,
  cloud_synced_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

let home: string;
let db: InstanceType<typeof DatabaseSync>;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "jht-chat-"));
  db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
});

afterEach(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

function writeChat(agent: string, lines: string[]) {
  const path = chatFileFor(home, agent);
  mkdirSync(join(home, "agents", agent), { recursive: true });
  writeFileSync(path, lines.join(""), "utf-8");
  return path;
}

const rowsOf = () =>
  db
    .prepare("SELECT * FROM pending_user_messages ORDER BY id ASC")
    .all() as Record<string, unknown>[];

// ── Parsing e forma dei dati ───────────────────────────────────────────

describe("parsing di chat.jsonl", () => {
  it("legge una riga scritta da jht-send", () => {
    expect(parseChatLine('{"role":"assistant","text":"ciao","ts":1753790000.5}')).toEqual({
      role: "assistant",
      text: "ciao",
      ts: 1753790000.5,
    });
  });

  it("scarta le righe rotte invece di esplodere", () => {
    // Il quoting a mano produceva JSON invalido: il file non deve diventare
    // veleno per il mirror (era il motivo della skill chat-web).
    for (const bad of ['{"role":"user","text":', "non json", "", '{"text":"x"}', '{"ts":1}']) {
      expect(parseChatLine(bad)).toBeNull();
    }
  });

  it("solo 'user' è l'utente: qualsiasi altro ruolo è l'agente", () => {
    expect(authorFromRole("user")).toBe("user");
    expect(authorFromRole("assistant")).toBe("agent");
    expect(authorFromRole("system")).toBe("agent");
    expect(authorFromRole(undefined as unknown as string)).toBe("agent");
  });

  it("la busta per il pane è quella che l'agente già conosce", () => {
    // Identica a vps_backend.gd (gioco) e a tg-bridge.py (Telegram): gli
    // agenti hanno UNA skill di risposta e un solo formato da riconoscere.
    expect(chatEnvelope("capitano", "che ore sono?")).toBe(
      "[@utente -> @capitano] [CHAT] che ore sono?",
    );
  });

  it("la sessione tmux è il RUOLO, senza il suffisso di scaling", () => {
    expect(tmuxSessionFor("capitano")).toBe("CAPITANO");
    expect(tmuxSessionFor("scout-3")).toBe("SCOUT");
  });
});

describe("coda del file", () => {
  it("legge solo l'ultima parte e scarta la riga tagliata a metà", () => {
    const lines = Array.from({ length: 50 }, (_, i) =>
      jsonlLine({ role: "assistant", text: `messaggio numero ${i}`, ts: 1000 + i }),
    );
    const path = writeChat("capitano", lines);
    const tail = readTailLines(path, 200);
    expect(tail.length).toBeGreaterThan(0);
    // Ogni riga tornata deve essere JSON intero: la prima parziale è tolta.
    for (const l of tail) expect(parseChatLine(l)).not.toBeNull();
    expect(tail.length).toBeLessThan(lines.length);
  });

  it("un file che non si è mosso non si rilegge", () => {
    const stat = { size: 10, mtimeMs: 5 } as never;
    expect(fileChanged(undefined, stat)).toBe(true);
    expect(fileChanged({ size: 10, mtimeMs: 5 }, stat)).toBe(false);
    expect(fileChanged({ size: 9, mtimeMs: 5 }, stat)).toBe(true);
    expect(fileChanged({ size: 10, mtimeMs: 4 }, stat)).toBe(true);
  });

  it("pickUnmirrored salta ciò che è già noto e i doppioni interni", () => {
    const lines = [
      jsonlLine({ role: "user", text: "a", ts: 1 }),
      jsonlLine({ role: "assistant", text: "b", ts: 2 }),
      jsonlLine({ role: "assistant", text: "b bis", ts: 2 }),
      jsonlLine({ role: "assistant", text: "c", ts: 3 }),
    ];
    const picked = pickUnmirrored(lines, new Set([1]));
    expect(picked.map((p) => p.ts)).toEqual([2, 3]);
  });
});

// ── Il mirror nei due versi ────────────────────────────────────────────

describe("chat.jsonl → SQLite", () => {
  it("importa il turno dell'utente scritto dal gioco e la risposta dell'agente", () => {
    writeChat("capitano", [
      jsonlLine({ role: "user", text: "CIAO - CHE ORE SONO?", ts: 1753790000 }),
      jsonlLine({ role: "assistant", text: "Sono le 14:32.", ts: 1753790060 }),
    ]);
    const res = ingestChatJsonl(db, { jhtHome: home, agents: ["capitano"] });
    expect(res.inserted).toBe(2);

    const rows = rowsOf();
    expect(rows.map((r) => r.author)).toEqual(["user", "agent"]);
    expect(rows[0].body).toBe("CIAO - CHE ORE SONO?");
    // Sono già passati per il pane (li ha consegnati il gioco): non vanno
    // riconsegnati, quindi nascono con delivered_at valorizzato.
    expect(rows[0].delivered_at).toBeTruthy();
    // …e non ancora saliti al cloud: è ciò che li farà arrivare sul web.
    expect(rows[0].cloud_synced_at).toBeNull();
  });

  it("un secondo giro sullo stesso file non duplica nulla", () => {
    writeChat("capitano", [jsonlLine({ role: "user", text: "ciao", ts: 1753790000 })]);
    ingestChatJsonl(db, { jhtHome: home, agents: ["capitano"] });
    ingestChatJsonl(db, { jhtHome: home, agents: ["capitano"] });
    expect(rowsOf()).toHaveLength(1);
  });

  it("una chat lunga di battute corte non si duplica al giro dopo", () => {
    // [CHAT-DUPLICATES-BORN-INSIDE-THE-BOX] La coda letta si misura in byte
    // (96 KB), la dedup si misurava in righe (le ultime 1000 della tabella).
    // Con battute corte — «ok», «sì», «vai» — in 96 KB ci stanno più di mille
    // turni: il pezzo scoperto tornava "nuovo" a ogni giro in cui il file si
    // muoveva e veniva reimportato. Doppioni nati dentro il box, prima di
    // qualsiasi sincronizzazione.
    const lines: string[] = [];
    for (let i = 0; i < 1600; i += 1) {
      lines.push(jsonlLine({ role: i % 2 ? "user" : "assistant", text: `ok ${i}`, ts: 1753790000 + i / 10 }));
    }
    writeChat("capitano", lines);
    const first = ingestChatJsonl(db, { jhtHome: home, agents: ["capitano"] });
    // Quanti ne entrino al primo giro lo decide la coda di 96 KB; quel che
    // conta è che siano più di mille, cioè oltre la vecchia finestra.
    expect(first.inserted).toBeGreaterThan(1000);

    // Una battuta nuova qualsiasi rimette in moto la lettura del file: da qui
    // in poi deve entrare SOLO quella.
    appendFileSync(
      chatFileFor(home, "capitano"),
      jsonlLine({ role: "user", text: "battuta nuova", ts: 1753799999 }),
      "utf-8",
    );
    const second = ingestChatJsonl(db, { jhtHome: home, agents: ["capitano"] });
    expect(second.inserted).toBe(1);
    expect(rowsOf()).toHaveLength(first.inserted + 1);
    expect(
      db
        .prepare(
          "SELECT chat_ts FROM pending_user_messages GROUP BY chat_ts HAVING COUNT(*) > 1",
        )
        .all(),
    ).toEqual([]);
  });

  it("due giri in parallelo non fanno entrare il turno due volte", () => {
    // [CHAT-DUPLICATES-BORN-INSIDE-THE-BOX] La dedup pre-giro è una LETTURA, e
    // fra quella e la scrittura ci può stare la scrittura di un altro
    // processo: `jht cloud chat-sync` è un comando pubblico e chi indaga sulla
    // chat lo lancia a mano mentre il daemon gira il suo giro da 5 secondi.
    // Qui si riproduce quel cieco rendendo muta la sola query di dedup: la
    // guardia che deve tenere è quella DENTRO l'INSERT.
    writeChat("capitano", [jsonlLine({ role: "user", text: "ciao", ts: 1753790000 })]);
    expect(ingestChatJsonl(db, { jhtHome: home, agents: ["capitano"] }).inserted).toBe(1);

    const blind = {
      prepare(sql: string) {
        const real = db.prepare(sql);
        // È la query di `mirroredChatTs`: la facciamo rispondere "non ho
        // niente", come se l'altro processo non avesse ancora scritto.
        if (sql.includes("chat_ts IN (")) return { ...real, all: () => [] };
        return real;
      },
    } as unknown as InstanceType<typeof DatabaseSync>;

    const second = ingestChatJsonl(blind, { jhtHome: home, agents: ["capitano"] });
    expect(second.inserted).toBe(0);
    expect(rowsOf()).toHaveLength(1);
  });

  it("il cursore evita di rileggere un file fermo", () => {
    writeChat("capitano", [jsonlLine({ role: "user", text: "ciao", ts: 1 })]);
    const first = ingestChatJsonl(db, { jhtHome: home, agents: ["capitano"] });
    expect(first.inserted).toBe(1);
    expect(first.cursor.capitano).toBeTruthy();
    // Con il cursore in mano il file non viene nemmeno aperto.
    const second = ingestChatJsonl(db, {
      jhtHome: home,
      agents: ["capitano"],
      cursor: first.cursor,
    });
    expect(second.inserted).toBe(0);
  });
});

describe("SQLite → chat.jsonl", () => {
  it("porta nel file la notifica scritta con jht-notify-user", () => {
    db.prepare(
      "INSERT INTO pending_user_messages (agent, body, author, created_at) VALUES ('mentor', 'Guarda i pattern', 'agent', datetime('now'))",
    ).run();
    const res = mirrorDbTurnsToJsonl(db, { jhtHome: home, agents: ["mentor"] });
    expect(res.mirrored).toBe(1);

    const line = parseChatLine(readFileSync(chatFileFor(home, "mentor"), "utf-8").trim());
    expect(line?.role).toBe("assistant");
    expect(line?.text).toBe("Guarda i pattern");
  });

  it("NON fa ping-pong: la riga specchiata non torna indietro", () => {
    db.prepare(
      "INSERT INTO pending_user_messages (agent, body, author, created_at) VALUES ('mentor', 'una volta sola', 'agent', datetime('now'))",
    ).run();
    mirrorDbTurnsToJsonl(db, { jhtHome: home, agents: ["mentor"] });
    // Il giro successivo rilegge il file: deve riconoscere la propria riga.
    const back = ingestChatJsonl(db, { jhtHome: home, agents: ["mentor"] });
    expect(back.inserted).toBe(0);
    expect(rowsOf()).toHaveLength(1);
    // …e non riscriverla di nuovo nel file.
    expect(mirrorDbTurnsToJsonl(db, { jhtHome: home, agents: ["mentor"] }).mirrored).toBe(0);
    expect(readFileSync(chatFileFor(home, "mentor"), "utf-8").trim().split("\n")).toHaveLength(1);
  });

  it("un giro morto fra la scrittura e il timbro non lascia un gemello", () => {
    // [CHAT-DUPLICATES-BORN-INSIDE-THE-BOX] La finestra fra `appendFileSync` e
    // l'UPDATE di `chat_ts` è reale: un SIGTERM (docker stop, redeploy) o un
    // lock sulla jobs.db in quell'istante lasciano la riga nel file e la
    // colonna NULL. Il giro dopo la riscriveva: stesso testo, due bolle nella
    // chat del gioco, per sempre. Si riproduce annullando il timbro.
    db.prepare(
      "INSERT INTO pending_user_messages (agent, body, author, created_at) VALUES ('mentor', 'scritta una volta', 'agent', '2026-07-29 10:00:00')",
    ).run();
    const at = Date.parse("2026-07-29T10:00:00Z") + 60_000;
    expect(mirrorDbTurnsToJsonl(db, { jhtHome: home, agents: ["mentor"], now: at }).mirrored).toBe(1);
    // Il giro è morto qui: la riga è nel file, `chat_ts` non è mai stato scritto.
    db.prepare("UPDATE pending_user_messages SET chat_ts = NULL").run();

    const retry = mirrorDbTurnsToJsonl(db, { jhtHome: home, agents: ["mentor"], now: at });
    expect(retry.mirrored).toBe(0);
    expect(readFileSync(chatFileFor(home, "mentor"), "utf-8").trim().split("\n")).toHaveLength(1);
    // …e il lavoro si chiude: la colonna torna valorizzata, così l'ingest
    // continua a riconoscere quella riga come propria.
    expect(rowsOf()[0].chat_ts).not.toBeNull();
  });

  it("due notifiche nello stesso secondo restano due turni distinti", () => {
    // created_at ha risoluzione al secondo: senza l'id nei millesimi le due
    // righe collasserebbero sulla stessa chiave di dedup e una sparirebbe.
    for (const body of ["prima", "seconda"]) {
      db.prepare(
        "INSERT INTO pending_user_messages (agent, body, author, created_at) VALUES ('mentor', ?, 'agent', '2026-07-29 10:00:00')",
      ).run(body);
    }
    // `now` iniettato, come fanno gli altri test del file: senza, il caso
    // dipende dall'orologio di chi lo esegue. La data qui è fissa e
    // `MIRROR_MAX_AGE_MS` è 48h, quindi dal 2026-07-31 in poi queste due
    // righe cadevano nel ramo "storico vecchio" (marcate, non specchiate) e
    // `mirrored` tornava 0 — un rosso che non parla del difetto che il test
    // descrive. Quello che si vuole provare è la chiave di dedup, non la
    // finestra: l'istante di osservazione va fissato insieme al dato.
    const res = mirrorDbTurnsToJsonl(db, {
      jhtHome: home,
      agents: ["mentor"],
      now: Date.parse("2026-07-29T10:00:30Z"),
    });
    expect(res.mirrored).toBe(2);
    const ts = rowsOf().map((r) => r.chat_ts);
    expect(new Set(ts).size).toBe(2);
  });

  it("il ts del mirror porta l'id nei millesimi: è la firma che dice da dove viene una riga", () => {
    // [CHAT-DUPLICATES-BORN-INSIDE-THE-BOX] Questa non è una curiosità: è
    // l'unico modo di stabilire, guardando SOLO il dato, se una riga è nata
    // da `jht-notify-user` (mirror) o da `jht-send` (ingest da chat.jsonl) —
    // e quindi se una coppia di doppioni è entrata da due bocche diverse.
    // `scripts/analysis/chat_duplicate_origin.sql` si appoggia a questo.
    // Se la derivazione del ts cambia, quella query smette di discriminare
    // in silenzio: qui la si inchioda.
    db.prepare(
      "INSERT INTO pending_user_messages (id, agent, body, author, created_at) VALUES (38, 'mentor', 'notificata', 'agent', '2026-07-29 10:00:00')",
    ).run();
    mirrorDbTurnsToJsonl(db, {
      jhtHome: home,
      agents: ["mentor"],
      now: Date.parse("2026-07-29T10:00:30Z"),
    });
    const row = rowsOf()[0];
    const chatTs = Number(row.chat_ts);
    expect(Number((chatTs % 1).toFixed(3))).toBe((Number(row.id) % 1000) / 1000);

    // Una riga entrata da chat.jsonl NON ce l'ha: porta il `time.time()` di
    // chi l'ha scritta, che non ha ragione di coincidere con il proprio id.
    writeChat("capitano", [
      jsonlLine({ role: "assistant", text: "risposta", ts: 1753790000.5678902 }),
    ]);
    ingestChatJsonl(db, { jhtHome: home, agents: ["capitano"] });
    const ingested = rowsOf().find((r) => r.agent === "capitano")!;
    expect(Number(ingested.chat_ts) % 1).not.toBe((Number(ingested.id) % 1000) / 1000);
  });

  it("al primo giro NON riversa lo storico vecchio nel file", () => {
    db.prepare(
      "INSERT INTO pending_user_messages (agent, body, author, created_at) VALUES ('mentor', 'notifica di due mesi fa', 'agent', '2026-05-20 09:00:00')",
    ).run();
    const res = mirrorDbTurnsToJsonl(db, {
      jhtHome: home,
      agents: ["mentor"],
      now: Date.parse("2026-07-29T10:00:00Z"),
    });
    expect(res.mirrored).toBe(0);
    expect(res.backfilled).toBe(1);
    // Marcata come già specchiata: non tornerà a bussare a ogni giro.
    expect(rowsOf()[0].chat_ts).not.toBeNull();
  });
});

// ── Turni nati sul cloud ───────────────────────────────────────────────

describe("turni scritti dal web", () => {
  it("il ts deriva dal legacy_id negativo ed è stabile", () => {
    const row = { legacy_id: -1753790000123, created_at: "2026-07-29T10:00:00Z" };
    expect(chatTsOf(row)).toBe(1753790000.123);
    expect(chatTsOf(row)).toBe(chatTsOf(row));
  });

  it("senza legacy_id negativo ricade su created_at", () => {
    expect(chatTsOf({ legacy_id: 42, created_at: "2026-07-29T10:00:00Z" })).toBe(
      Date.parse("2026-07-29T10:00:00Z") / 1000,
    );
  });

  it("entrano in SQLite non consegnati e non da ripushare", () => {
    const ids = importCloudUserTurns(db, [
      { id: "uuid-1", legacy_id: -1753790000000, agent: "capitano", body: "che ore sono?" },
    ]);
    expect(ids).toEqual(["uuid-1"]);

    const row = rowsOf()[0];
    expect(row.author).toBe("user");
    // Da consegnare: è esattamente il passo che mancava.
    expect(row.delivered_at).toBeNull();
    // Già sul cloud (riga nativa): ripusharla creerebbe un doppione con un
    // legacy_id diverso.
    expect(row.cloud_synced_at).not.toBeNull();
  });

  it("finiscono SUBITO anche nel file che legge il videogioco", () => {
    // Trovato dallo smoke end-to-end: il mirror (passo 3) lavora sulle
    // righe con chat_ts NULL, e qui il valore è già impostato perché è la
    // chiave di dedup. Senza scrivere il file qui, il messaggio mandato dal
    // sito arrivava all'agente ma restava invisibile nella chat del gioco —
    // le due storie tornavano a divergere.
    importCloudUserTurns(
      db,
      [{ id: "uuid-1", legacy_id: -1753790000000, agent: "capitano", body: "e domani?" }],
      { jhtHome: home },
    );
    const line = parseChatLine(
      readFileSync(chatFileFor(home, "capitano"), "utf-8").trim(),
    );
    expect(line).toEqual({ role: "user", text: "e domani?", ts: 1753790000 });
  });

  it("importare due volte lo stesso turno non lo duplica, nemmeno nel file", () => {
    const turn = { id: "uuid-1", legacy_id: -1753790000000, agent: "capitano", body: "ciao" };
    importCloudUserTurns(db, [turn], { jhtHome: home });
    const second = importCloudUserTurns(db, [turn], { jhtHome: home });
    expect(rowsOf()).toHaveLength(1);
    expect(
      readFileSync(chatFileFor(home, "capitano"), "utf-8").trim().split("\n"),
    ).toHaveLength(1);
    // Va comunque marcato consegnato lato cloud, o resta in coda per sempre.
    expect(second).toEqual(["uuid-1"]);
  });

  it("il turno importato non torna indietro al giro dell'ingest", () => {
    importCloudUserTurns(
      db,
      [{ id: "uuid-1", legacy_id: -1753790000000, agent: "capitano", body: "ciao" }],
      { jhtHome: home },
    );
    const back = ingestChatJsonl(db, { jhtHome: home, agents: ["capitano"] });
    expect(back.inserted).toBe(0);
    expect(rowsOf()).toHaveLength(1);
  });

  it("un mittente fuori dalle tre chat non si finge consegnato", () => {
    const ids = importCloudUserTurns(db, [
      { id: "uuid-9", legacy_id: -1, agent: "scout", body: "ehi" },
    ]);
    expect(ids).toEqual([]);
    expect(rowsOf()).toHaveLength(0);
  });
});

// ── Consegna al pane ───────────────────────────────────────────────────

describe("consegna al pane tmux", () => {
  const seedUserTurn = (agent = "capitano", body = "che ore sono?") =>
    db
      .prepare(
        "INSERT INTO pending_user_messages (agent, body, author, created_at) VALUES (?, ?, 'user', datetime('now'))",
      )
      .run(agent, body);

  it("consegna e timbra delivered_at", async () => {
    seedUserTurn();
    const seen: [string, string][] = [];
    const res = await deliverPendingUserTurns(db, {
      sendFn: async (agent: string, text: string) => {
        seen.push([agent, text]);
        return { ok: true, code: 0, error: "" };
      },
    });
    expect(res).toEqual({ delivered: 1, failed: 0 });
    expect(seen).toEqual([["capitano", "che ore sono?"]]);
    expect(rowsOf()[0].delivered_at).toBeTruthy();
  });

  it("pane occupato (exit 4) = messaggio NON perso, delivered_at resta NULL", async () => {
    // exit 4 di jht-tmux-send = TUI occupata oltre il budget, agente VIVO.
    // Scartare qui vorrebbe dire perdere il messaggio dell'utente.
    seedUserTurn();
    const res = await deliverPendingUserTurns(db, {
      sendFn: async () => ({ ok: false, code: 4, error: "busy" }),
    });
    expect(res).toEqual({ delivered: 0, failed: 1 });
    expect(rowsOf()[0].delivered_at).toBeNull();

    // Al giro dopo, con il pane libero, riparte.
    const retry = await deliverPendingUserTurns(db, {
      sendFn: async () => ({ ok: true, code: 0, error: "" }),
    });
    expect(retry.delivered).toBe(1);
  });

  it("un pane morto non blocca la coda degli altri agenti", async () => {
    seedUserTurn("capitano", "al capitano");
    seedUserTurn("mentor", "al mentor");
    const res = await deliverPendingUserTurns(db, {
      sendFn: async (agent: string) =>
        agent === "capitano"
          ? { ok: false, code: 1, error: "no session" }
          : { ok: true, code: 0, error: "" },
    });
    expect(res).toEqual({ delivered: 1, failed: 1 });
  });

  it("non riconsegna un turno già consegnato", async () => {
    seedUserTurn();
    await deliverPendingUserTurns(db, {
      sendFn: async () => ({ ok: true, code: 0, error: "" }),
    });
    const again = await deliverPendingUserTurns(db, {
      sendFn: async () => {
        throw new Error("non deve essere chiamato");
      },
    });
    expect(again).toEqual({ delivered: 0, failed: 0 });
  });
});

// ── Push verso il cloud ────────────────────────────────────────────────

describe("push dei turni nuovi", () => {
  it("prende solo ciò che non è ancora salito, e una volta sola", () => {
    db.prepare(
      "INSERT INTO pending_user_messages (agent, body, author) VALUES ('capitano', 'nuovo', 'agent')",
    ).run();
    db.prepare(
      "INSERT INTO pending_user_messages (agent, body, author, cloud_synced_at) VALUES ('capitano', 'gia salito', 'agent', datetime('now'))",
    ).run();

    const batch = takeChatRowsToPush(db);
    expect(batch.map((r) => r.body)).toEqual(["nuovo"]);

    markChatRowsPushed(db, batch.map((r) => r.id));
    expect(takeChatRowsToPush(db)).toHaveLength(0);
  });

  it("i timestamp SQLite salgono come UTC espliciti", () => {
    // `YYYY-MM-DD HH:MM:SS` senza suffisso: PostgREST lo leggerebbe come ora
    // locale del server e il turno comparirebbe spostato di ore sul web.
    const cloud = toCloudRow(
      {
        id: 7,
        agent: "capitano",
        body: "x",
        author: "user",
        created_at: "2026-07-29 10:00:00",
        delivered_at: null,
      },
      "user-uuid",
    );
    expect(cloud.created_at).toBe("2026-07-29T10:00:00Z");
    expect(cloud.legacy_id).toBe(7);
    expect(cloud.author).toBe("user");
    expect(cloud.delivered_at).toBeNull();
  });

  it("un timestamp già ISO non viene toccato", () => {
    const cloud = toCloudRow(
      { id: 1, agent: "mentor", body: "x", created_at: "2026-07-29T10:00:00.000Z" },
      "u",
    );
    expect(cloud.created_at).toBe("2026-07-29T10:00:00.000Z");
    expect(cloud.author).toBe("agent");
  });
});

// ── Rendezvous ─────────────────────────────────────────────────────────

describe("rendezvous chat", () => {
  it("pendente finché la consegna non supera la richiesta", () => {
    expect(chatPending(null, null)).toBe(false);
    expect(chatPending("2026-07-29T10:00:00Z", null)).toBe(true);
    expect(chatPending("2026-07-29T10:00:00Z", "2026-07-29T09:59:00Z")).toBe(true);
    expect(chatPending("2026-07-29T10:00:00Z", "2026-07-29T10:00:01Z")).toBe(false);
  });

  it("confronta le date, non le stringhe", () => {
    // `+00:00` e `Z` ordinano diversamente da come si datano: è la trappola
    // del cursore congelato del 15/07, e qui costerebbe una chat muta.
    expect(chatPending("2026-07-29T10:00:00+00:00", "2026-07-29T09:00:00Z")).toBe(true);
    expect(chatPending("2026-07-29T09:00:00+00:00", "2026-07-29T10:00:00Z")).toBe(false);
  });
});

// ── Diagnosi della corsia ──────────────────────────────────────────────
//
// Il 24/07 tre turni scritti dal web sono rimasti in coda sei ore senza una
// riga di log: da fuori il box sembrava sano. Questi test proteggono la
// proprietà che chiude quel buco — la corsia sa dire quando NON funziona —
// e la sua gemella: non deve dirlo mille volte, o il rumore riproduce lo
// stesso effetto per la via opposta.

describe("diagnosi della corsia chat", () => {
  it("corsia che lavora: nessun allarme", () => {
    expect(diagnoseChatLane({ pending: false, canRead: true, queued: 0 })).toBeNull();
  });

  it("il campanello del web suona e non c'è canale per rispondere", () => {
    // È l'incidente: `chat_requested_at` avanti, nessun modo di leggere i
    // turni. Aspettare non fa comparire il canale → nessuna grazia.
    const now = Date.parse("2026-07-24T15:31:00Z");
    const stall = diagnoseChatLane({
      pending: true,
      canRead: false,
      requestedAt: "2026-07-24T09:31:00Z",
      now,
    });
    expect(stall?.reason).toBe("no-inbound-channel");
    expect(stall?.message).toContain("6h 0m");
    expect(stall?.message).toContain("cannot arrive");
  });

  it("lettura dal cloud fallita: il motivo arriva fino al log", () => {
    const stall = diagnoseChatLane({
      pending: true,
      canRead: true,
      readError: "HTTP 401 invalid refresh token",
      requestedAt: "2026-07-24T09:31:00Z",
      now: Date.parse("2026-07-24T09:36:00Z"),
    });
    expect(stall?.reason).toBe("inbound-read-failed");
    expect(stall?.summary).toContain("invalid refresh token");
  });

  it("turni in coda da poco: si aspetta, non si grida", () => {
    // Un pane occupato da un turno lungo rimanda la consegna di minuti ed è
    // normale: sotto la soglia non c'è niente da segnalare.
    const now = Date.parse("2026-07-24T10:00:00Z");
    expect(
      diagnoseChatLane({
        queued: 2,
        oldestQueuedAt: "2026-07-24 09:59:00",
        deliverFailed: 1,
        now,
        graceMs: 300_000,
      }),
    ).toBeNull();
  });

  it("turni in coda oltre la soglia: guasto dichiarato, col conto", () => {
    const now = Date.parse("2026-07-24T10:00:00Z");
    const stall = diagnoseChatLane({
      queued: 3,
      oldestQueuedAt: "2026-07-24 09:30:00",
      deliverFailed: 1,
      now,
      graceMs: 300_000,
    });
    expect(stall?.reason).toBe("delivery-stuck");
    expect(stall?.count).toBe(3);
    expect(stall?.summary).toContain("3 user turns");
    expect(stall?.message).toContain("30m");
  });

  it("il summary NON contiene la durata (scrive team_state.last_error)", () => {
    // `last_error` finisce nel trigger di audit di mig 019: un valore che
    // cambia a ogni segnalazione scriverebbe storia a vuoto per sempre.
    const base = {
      queued: 1,
      oldestQueuedAt: "2026-07-24 09:00:00",
      graceMs: 300_000,
    };
    const a = diagnoseChatLane({ ...base, now: Date.parse("2026-07-24T10:00:00Z") });
    const b = diagnoseChatLane({ ...base, now: Date.parse("2026-07-24T14:00:00Z") });
    expect(a?.summary).toBe(b?.summary);
    expect(a?.message).not.toBe(b?.message);
  });

  it("conta i turni non consegnati leggendo la coda vera", () => {
    db.prepare(
      "INSERT INTO pending_user_messages (agent, body, author, created_at) VALUES ('capitano', 'primo', 'user', '2026-07-24 09:31:00')",
    ).run();
    db.prepare(
      "INSERT INTO pending_user_messages (agent, body, author, created_at) VALUES ('mentor', 'secondo', 'user', '2026-07-24 09:32:00')",
    ).run();
    // Consegnato: fuori dal conto.
    db.prepare(
      "INSERT INTO pending_user_messages (agent, body, author, delivered_at) VALUES ('mentor', 'terzo', 'user', datetime('now'))",
    ).run();
    // Turno dell'AGENTE: non è roba che aspetta un pane.
    db.prepare(
      "INSERT INTO pending_user_messages (agent, body, author) VALUES ('mentor', 'notifica', 'agent')",
    ).run();

    const queue = undeliveredUserTurns(db);
    expect(queue.count).toBe(2);
    expect(queue.oldest).toBe("2026-07-24 09:31:00");
  });
});

describe("frequenza delle segnalazioni", () => {
  const now = Date.parse("2026-07-24T10:00:00Z");

  it("un guasto nuovo si dice subito", () => {
    expect(shouldAnnounceStall(null, "chat: guasto", { now })).toBe(true);
  });

  it("lo stesso guasto non si ripete a ogni giro del daemon", () => {
    // Il giro è ~5s: senza questo cancello sarebbero ~700 righe identiche
    // all'ora, cioè rumore che nessuno legge — di nuovo un guasto invisibile.
    const prev = { summary: "chat: guasto", at: now };
    expect(shouldAnnounceStall(prev, "chat: guasto", { now: now + 5_000, everyMs: 900_000 })).toBe(false);
    expect(shouldAnnounceStall(prev, "chat: guasto", { now: now + 900_000, everyMs: 900_000 })).toBe(true);
  });

  it("un guasto DIVERSO passa comunque, anche dentro l'intervallo", () => {
    const prev = { summary: "chat: guasto", at: now };
    expect(shouldAnnounceStall(prev, "chat: altro guasto", { now: now + 1_000, everyMs: 900_000 })).toBe(true);
  });
});

describe("perimetro delle chat web", () => {
  it("le tre conversazioni sono quelle che il web mostra", () => {
    // Se questa lista divergesse da web/lib/chat-agents.ts, la route
    // accetterebbe un messaggio che nessun pane riceverà mai.
    expect([...CHAT_AGENTS].sort()).toEqual(["assistente", "capitano", "mentor"]);
  });
});

// ── Il canale col cloud: il caso del fleet ─────────────────────────────
//
// Il difetto che questi test avrebbero preso (diagnosticato sul box di
// produzione il 2026-07-30): il pull dei turni scritti dal web viveva SOLO
// sul lettore Supabase-diretto, che è opt-in (`JHT_SUPABASE_DIRECT=1`) e sul
// fleet è spento — 4 box su 5. Con `reader = null` il ramo di pull non
// partiva mai: il messaggio restava su Supabase e la chat web→agente era
// morta in silenzio, senza un errore in log. Il verso opposto funzionava,
// il che rendeva il guasto ancora più difficile da vedere.
//
// Da qui in poi la corsia deve consegnare ANCHE senza lettore diretto.

const BOX_CONFIG = {
  base_url: "https://jobhunterteam.ai",
  token: "jht_sync_esempio",
  user_id: "00000000-0000-4000-8000-000000000000",
  enabled: true,
};

type FetchCall = { url: string; method: string; auth?: string; body?: unknown };

/** Cloud finto: serve i turni sul GET e registra l'ack del POST. */
function fakeCloud(messages: Record<string, unknown>[]) {
  const calls: FetchCall[] = [];
  const fetchFn = async (url: string, init?: Record<string, any>) => {
    const method = (init?.method as string) || "GET";
    calls.push({
      url: String(url),
      method,
      auth: init?.headers?.Authorization,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    if (method === "GET") {
      return { ok: true, status: 200, json: async () => ({ ok: true, messages }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, delivered: messages.length }) };
  };
  return { fetchFn, calls };
}

describe("canale della chat senza lettore diretto", () => {
  it("un box senza JHT_SUPABASE_DIRECT ha comunque un canale", () => {
    const channel = chatChannelFor(BOX_CONFIG, null, { fetchFn: async () => ({}) as any });
    expect(channel?.kind).toBe("vercel");
  });

  it("col lettore diretto resta il canale diretto (costa meno)", () => {
    const reader = { readUndeliveredUserChat: async () => [], markUserChatDelivered: async () => {}, patchTeamState: async () => {} };
    expect(chatChannelFor(BOX_CONFIG, reader as any)?.kind).toBe("direct");
  });

  it("anche il canale diretto chiude via CAS e preserva gli ID se A e' superseded", async () => {
    const marked: string[][] = [];
    let blindPatches = 0;
    let body: Record<string, unknown> | undefined;
    const reader = {
      readUndeliveredUserChat: async () => [],
      markUserChatDelivered: async (ids: string[]) => { marked.push(ids); },
      patchTeamState: async () => { blindPatches += 1; },
    };
    const channel = chatChannelFor(BOX_CONFIG, reader as any, {
      fetchFn: async (_url: string, init?: Record<string, any>) => {
        body = JSON.parse(init?.body || "{}");
        return { ok: false, status: 409 } as Response;
      },
    });
    const result = await channel!.acknowledgeDelivery(["00000000-0000-4000-8000-000000000001"], {
      closeRendezvous: true,
      expectedRequestedAt: "2026-08-04T10:00:00Z",
    });
    expect(marked).toEqual([["00000000-0000-4000-8000-000000000001"]]);
    expect(blindPatches).toBe(0);
    expect(body).toEqual({
      delivered_ids: [],
      close_rendezvous: true,
      expected_requested_at: "2026-08-04T10:00:00Z",
    });
    expect(result).toEqual({ closed: false, superseded: true });
  });

  it("senza token non c'è cloud da cui ritirare nulla", () => {
    expect(chatChannelFor({ base_url: "https://jobhunterteam.ai" }, null)).toBeNull();
  });

  it("il turno scritto dal web arriva al pane anche con reader = null", async () => {
    const cloud = fakeCloud([
      {
        id: "11111111-1111-4111-8111-111111111111",
        legacy_id: -1753790000000,
        agent: "capitano",
        body: "ci sei?",
        created_at: "2026-07-30T10:00:00Z",
      },
    ]);
    const channel = chatChannelFor(BOX_CONFIG, null, { fetchFn: cloud.fetchFn });

    // La condizione in cui gira il pull: il web ha suonato il campanello e
    // il box non ha ancora consegnato.
    expect(chatPending("2026-07-30T10:00:00Z", null)).toBe(true);

    // ── La corsia, negli stessi passi del daemon ──
    const rows = await channel!.readUndeliveredUserChat({ limit: 50 });
    const importedIds = importCloudUserTurns(db, rows, { jhtHome: home });
    const sends: string[][] = [];
    const sent = await deliverPendingUserTurns(db, {
      sendFn: async (agent: string, body: string) => {
        sends.push([agent, body]);
        return { ok: true, code: 0 };
      },
    });

    // Il punto: consegnato davvero, non "in coda".
    expect(sent).toEqual({ delivered: 1, failed: 0 });
    expect(sends).toEqual([["capitano", "ci sei?"]]);
    expect(rowsOf()[0].delivered_at).not.toBeNull();
    // …e visibile anche nella chat del videogioco.
    expect(readFileSync(chatFileFor(home, "capitano"), "utf-8")).toContain("ci sei?");

    // ── Ack + chiusura del rendezvous ──
    await channel!.closeRendezvous(importedIds);

    const get = cloud.calls.find((c) => c.method === "GET");
    expect(get?.url).toContain("/api/cloud-sync/chat");
    // Stessa autenticazione del push: il token del box, non un secondo schema.
    expect(get?.auth).toBe("Bearer jht_sync_esempio");
    const post = cloud.calls.find((c) => c.method === "POST");
    expect(post?.auth).toBe("Bearer jht_sync_esempio");
    expect(post?.body).toEqual({
      delivered_ids: ["11111111-1111-4111-8111-111111111111"],
      close_rendezvous: true,
      expected_requested_at: null,
    });
  });

  it("a chat ferma non parte NESSUNA chiamata verso Vercel", async () => {
    // Il costo Vercel del progetto scala con i poller dei box (~75% di
    // riduzione ottenuta proprio togliendo chiamate a vuoto): il giro veloce
    // passa di qui ogni ~5s, cioè ~17k volte al giorno per box. Costruire il
    // canale non deve toccare la rete, e il pull parte SOLO col campanello
    // suonato — `chatPending` falso ⇒ zero richieste, come oggi.
    const cloud = fakeCloud([]);
    const channel = chatChannelFor(BOX_CONFIG, null, { fetchFn: cloud.fetchFn });
    expect(channel).not.toBeNull();
    expect(cloud.calls).toHaveLength(0);

    // Nessun messaggio mai scritto, e messaggio già consegnato: i due modi
    // in cui una chat sta ferma.
    expect(chatPending(null, null)).toBe(false);
    expect(chatPending("2026-07-30T10:00:00Z", "2026-07-30T10:00:01Z")).toBe(false);
    expect(cloud.calls).toHaveLength(0);
  });

  it("un errore HTTP non finge la consegna", async () => {
    // Se il pull ingoiasse l'errore ritornando [], il rendezvous verrebbe
    // chiuso su una coda vuota e il turno dell'utente sarebbe perso.
    const channel = chatChannelFor(BOX_CONFIG, null, {
      fetchFn: async () => ({ ok: false, status: 500, json: async () => ({}) }) as any,
    });
    await expect(channel!.readUndeliveredUserChat({ limit: 10 })).rejects.toThrow(/500/);
    await expect(channel!.closeRendezvous(["x"])).rejects.toThrow(/500/);
  });

  it("GET e ACK hanno una deadline e gli errori restano sanitizzati", async () => {
    const signals: AbortSignal[] = [];
    const channel = chatChannelFor(BOX_CONFIG, null, {
      timeoutMs: 10_000,
      fetchFn: async (_url: string, init?: Record<string, any>) => {
        signals.push(init?.signal);
        return init?.method === "POST"
          ? ({ ok: true, status: 200 } as Response)
          : ({ ok: true, status: 200, json: async () => ({ messages: [] }) } as any);
      },
    });
    await channel!.readUndeliveredUserChat();
    await channel!.closeRendezvous([]);
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);

    const timeout = Object.assign(new Error("host-riservato"), { name: "TimeoutError" });
    expect(cloudRequestFailure(timeout)).toBe("timeout");
    expect(cloudRequestFailure(new Error("url-riservato"))).toBe("request_failed");
  });

  it("la corsia in cloud.js non è più gatata sul lettore diretto", () => {
    // Il difetto era una sola condizione: `if (pending && reader)`. Questo
    // controllo è sul SORGENTE perché typecheck e lint non lo vedrebbero.
    const src = readFileSync(
      join(__dirname, "../../../cli/src/commands/cloud.js"),
      "utf-8",
    );
    expect(src).not.toMatch(/pending\s*&&\s*reader/);
    expect(src).toContain("chat.chatChannelFor(config, reader)");
    // La guardia che tiene a zero le chiamate a chat ferma.
    expect(src).toContain("if (pending && channel)");
  });

  it("il worker importa node:sqlite prima di aprire il DB", () => {
    // Regressione del guasto live: `new DatabaseSync` senza import cadeva nel
    // catch silenzioso del daemon e la corsia non girava mai.
    const src = readFileSync(
      join(__dirname, "../../../cli/src/commands/cloud.js"),
      "utf-8",
    );
    const start = src.indexOf("export async function handleChatSync");
    const end = src.indexOf("let chatLaneAlert", start);
    const worker = src.slice(start, end);
    const importAt = worker.indexOf("await import('node:sqlite')");
    const openAt = worker.indexOf("new DatabaseSync(dbPath");
    expect(importAt).toBeGreaterThan(0);
    expect(openAt).toBeGreaterThan(importAt);
    expect(worker).toContain("log('error', `chat-sync: cycle failed");
  });

  it("la chat resta nel giro veloce del daemon (~5s), non in quello pesante", () => {
    // Spostarla sotto `doHeavy` la porterebbe da 5s a 60s di latenza: è il
    // contrario dell'obiettivo, e non lo vedrebbe nessun altro test.
    const src = readFileSync(
      join(__dirname, "../../../cli/src/commands/cloud.js"),
      "utf-8",
    );
    const chatCall = src.indexOf(
      "await handleChatSync({ silent: true, config, state: rendezvousState })",
    );
    const rendezvousRead = src.indexOf(
      "rendezvousState = await readRendezvousState(config, { silent: true })",
    );
    expect(rendezvousRead).toBeGreaterThan(-1);
    // Dopo la lettura di team_state (che è già pagata dal pulsante "Sync
    // now") e prima del blocco pesante che la segue.
    expect(chatCall).toBeGreaterThan(rendezvousRead);
    const heavyAfter = src.indexOf("if (doHeavy) {", rendezvousRead);
    expect(chatCall).toBeLessThan(heavyAfter);
  });
  // Il difetto che il merge dei due lavori paralleli ha quasi prodotto: la
  // diagnosi del guasto e' nata quando il pull esisteva SOLO sul lettore
  // diretto, quindi classificava "nessun canale" guardando `reader`. Da
  // quando il ripiego via Vercel esiste, quella lettura e' sbagliata: 4 box
  // su 5 non hanno letture dirette e ritirano benissimo i turni. L'allarme
  // sarebbe rimasto acceso per sempre su una corsia sana — e un allarme
  // sempre acceso e' un allarme che nessuno legge piu'.
  it("non grida 'nessun canale' quando il ripiego via Vercel c'e'", () => {
    const sano = diagnoseChatLane({
      pending: true,
      requestedAt: new Date(Date.now() - 60_000).toISOString(),
      canRead: true, // il canale esiste: e' quello col token del box
      readError: null,
      queued: 0,
      oldestQueuedAt: null,
      deliverFailed: 0,
    });
    expect(sano?.reason).not.toBe("no-inbound-channel");

    const rotto = diagnoseChatLane({
      pending: true,
      requestedAt: new Date(Date.now() - 60_000).toISOString(),
      canRead: false, // nessun canale davvero
      readError: null,
      queued: 0,
      oldestQueuedAt: null,
      deliverFailed: 0,
    });
    expect(rotto?.reason).toBe("no-inbound-channel");
  });

  // E che la diagnosi sia alimentata dal CANALE, non dal lettore diretto:
  // e' l'unico punto in cui i due lavori si toccano, e un ritorno indietro
  // qui non lo vedrebbe nessun test di comportamento.
  it("alimenta la diagnosi con il canale, non con il lettore diretto", () => {
    const src = readFileSync(
      join(__dirname, "../../../cli/src/commands/cloud.js"),
      "utf-8",
    );
    expect(src).toContain("canRead: !!channel");
    expect(src).not.toContain("canRead: !!reader");
  });
});
