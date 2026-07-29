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
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CHAT_AGENTS,
  authorFromRole,
  chatEnvelope,
  chatFileFor,
  chatPending,
  chatTsOf,
  deliverPendingUserTurns,
  fileChanged,
  importCloudUserTurns,
  ingestChatJsonl,
  jsonlLine,
  markChatRowsPushed,
  mirrorDbTurnsToJsonl,
  parseChatLine,
  pickUnmirrored,
  readTailLines,
  takeChatRowsToPush,
  tmuxSessionFor,
  toCloudRow,
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

  it("due notifiche nello stesso secondo restano due turni distinti", () => {
    // created_at ha risoluzione al secondo: senza l'id nei millesimi le due
    // righe collasserebbero sulla stessa chiave di dedup e una sparirebbe.
    for (const body of ["prima", "seconda"]) {
      db.prepare(
        "INSERT INTO pending_user_messages (agent, body, author, created_at) VALUES ('mentor', ?, 'agent', '2026-07-29 10:00:00')",
      ).run(body);
    }
    const res = mirrorDbTurnsToJsonl(db, { jhtHome: home, agents: ["mentor"] });
    expect(res.mirrored).toBe(2);
    const ts = rowsOf().map((r) => r.chat_ts);
    expect(new Set(ts).size).toBe(2);
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

  it("un mittente fuori dalle tre chat si marca senza scriverlo", () => {
    const ids = importCloudUserTurns(db, [
      { id: "uuid-9", legacy_id: -1, agent: "scout", body: "ehi" },
    ]);
    expect(ids).toEqual(["uuid-9"]);
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

describe("perimetro delle chat web", () => {
  it("le tre conversazioni sono quelle che il web mostra", () => {
    // Se questa lista divergesse da web/lib/chat-agents.ts, la route
    // accetterebbe un messaggio che nessun pane riceverà mai.
    expect([...CHAT_AGENTS].sort()).toEqual(["assistente", "capitano", "mentor"]);
  });
});
