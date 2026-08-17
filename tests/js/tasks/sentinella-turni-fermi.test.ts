/**
 * O-101, la parte che gira sulla macchina: la Sentinella legge le due
 * sorgenti LOCALI e dice quali turni nessuno ha raccolto.
 *
 * La decisione sta in `shared/agents/turn-pickup.js` e ha i suoi test; qui si
 * guarda l'altra metà, quella che di solito nessuno collauda: che le due
 * letture prendano davvero i dati dove stanno, con i nomi che hanno.
 *
 * ⚠️ Le due liste dei bot vivono in due linguaggi e non possono importarsi:
 * quella JS che la Sentinella usa e quella Python di `jht-notify-user`, da cui
 * dipende da quale bot esce ogni agente. Se divergono, l'allarme diventa
 * silenzioso proprio per l'agente che ha cambiato bot — quindi il primo test
 * qui sotto le confronta leggendole dai due sorgenti.
 */
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { BOT_ROLES, DEFAULT_BOT_ROLE } from "../../../cli/src/lib/bot-roles.js";

const root = resolve(__dirname, "../../..");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function casaSintetica() {
  const home = mkdtempSync(join(tmpdir(), "jht-turni-fermi-"));
  dirs.push(home);
  mkdirSync(join(home, "logs"), { recursive: true });
  const db = new DatabaseSync(join(home, "jobs.db"));
  db.exec(`
    CREATE TABLE pending_user_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, agent TEXT NOT NULL,
      body TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'notification',
      author TEXT NOT NULL DEFAULT 'agent', chat_ts REAL,
      delivered_via TEXT, delivered_at TIMESTAMP, acknowledged_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO pending_user_messages
      (id, agent, body, author, delivered_via, delivered_at, created_at)
    VALUES
      (367, 'mentor', 'Synthetic one', 'user', 'telegram',
       '2026-08-17T11:17:46Z', '2026-08-17T11:17:38Z'),
      (369, 'mentor', 'Synthetic two', 'user', 'telegram',
       '2026-08-17T13:57:15Z', '2026-08-17T13:57:07Z'),
      (401, 'capitano', 'Synthetic three', 'user', 'telegram',
       '2026-08-17T13:57:15Z', '2026-08-17T13:57:07Z'),
      -- Un messaggio dell'AGENTE all'utente: non è un turno da raccogliere,
      -- e se finisse nella lista l'allarme suonerebbe su metà della coda.
      (402, 'mentor', 'Synthetic four', 'agent', 'telegram',
       '2026-08-17T13:57:15Z', '2026-08-17T13:57:07Z');
  `);
  db.close();
  // Il Capitano ha scritto 50 secondi dopo la consegna: il falso positivo
  // misurato sul campo, che qui deve restare fuori dall'elenco.
  writeFileSync(
    join(home, "logs", "telegram-sent.jsonl"),
    [
      '{"ts":"2026-08-17T13:58:05Z","from":"capitano","kind":"text","ok":true}',
      '{"ts":"2026-08-17T11:19:00Z","from":"mentor","kind":"text","ok":true}',
    ].join("\n") + "\n",
  );
  return home;
}

function sentinella(home: string, args: string[]) {
  return execFileSync(
    process.execPath,
    [join(root, "cli/bin/jht.js"), "sentinella", ...args],
    {
      encoding: "utf8",
      env: { ...process.env, JHT_HOME: home, NO_COLOR: "1" },
    },
  );
}

describe("la Sentinella vede i turni che nessuno ha raccolto", () => {
  it("le due liste dei bot non possono divergere in silenzio", () => {
    const python = readFileSync(
      join(root, "agents/_tools/jht-notify-user"),
      "utf8",
    );
    const dichiarati = python.match(/BOT_ROLES = \(([^)]*)\)/);
    expect(dichiarati).not.toBeNull();
    const ruoli = [...dichiarati![1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);

    expect(ruoli).toEqual(BOT_ROLES);
    expect(python).toContain(`DEFAULT_BOT_ROLE = "${DEFAULT_BOT_ROLE}"`);
  });

  it("elenca il turno del Mentor e tace su quello del Capitano", () => {
    const home = casaSintetica();
    // Il log e il jobs.db stanno dove il comando li cerca: se cambiasse un
    // path, il comando direbbe «nessun turno fermo» invece di rompersi, ed è
    // il modo più silenzioso di perdere un allarme.
    writeFileSync(
      join(home, "logs", "telegram-sent.jsonl"),
      '{"ts":"2026-08-17T13:58:05Z","from":"capitano","kind":"text","ok":true}\n',
    );

    const uscita = sentinella(home, ["stalled-turns"]);

    expect(uscita).toContain("mentor");
    expect(uscita).toContain("369");
    expect(uscita).not.toContain("capitano");
    // Il messaggio dell'agente all'utente non è un turno consegnato a lui.
    expect(uscita).not.toContain("402");
  });

  it("in --json rende ogni verdetto, anche gli indecidibili", () => {
    const home = casaSintetica();
    writeFileSync(join(home, "logs", "telegram-sent.jsonl"), "");
    const db = new DatabaseSync(join(home, "jobs.db"));
    db.exec(
      "INSERT INTO pending_user_messages (id, agent, body, author, delivered_at) " +
        "VALUES (500, 'scout', 'Synthetic five', 'user', '2026-08-17T13:57:15Z')",
    );
    db.close();

    const verdetti = JSON.parse(sentinella(home, ["stalled-turns", "--json"]));
    const scout = verdetti.find((v: { agent: string }) => v.agent === "scout");

    expect(scout).toMatchObject({
      verdict: "undecidable",
      reason: "shared_bot",
    });
  });

  it("senza jobs.db non si rompe e non inventa allarmi", () => {
    const home = mkdtempSync(join(tmpdir(), "jht-turni-vuoto-"));
    dirs.push(home);

    expect(sentinella(home, ["stalled-turns"])).toContain("No delivered turn");
  });
});
