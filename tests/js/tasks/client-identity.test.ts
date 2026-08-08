/**
 * Test unitari — identità del client sulle chiamate cloud-sync (vitest)
 *
 * [CLIENT-VERSION-INVISIBLE] Nessun client dichiarava la propria build: sul
 * server l'unico user-agent che arrivava era quello dell'infrastruttura, e
 * capire cosa girasse su una macchina attiva voleva dire incrociare la data
 * di pairing con `git tag` per fermarsi a «probabilmente».
 *
 * Due cose vanno protette qui, e sono diverse fra loro. La prima è il
 * **contratto fra due linguaggi**: chi scrive l'header è JavaScript nel CLI,
 * chi lo legge è TypeScript nel web, e nulla obbliga i due formati a
 * coincidere se non un test che li fa parlare davvero (round-trip, non due
 * asserzioni parallele su costanti scritte a mano). La seconda è il
 * **confine dello scope**: questa telemetria è tecnica e basta, quindi il
 * parser deve scartare tutto ciò che non è nella whitelist invece di
 * accogliere qualunque campo un client decida di aggiungere.
 *
 * L'ultimo blocco asserisce sul sorgente: una corsia cloud-sync aggiunta
 * senza passare dall'helper non fallirebbe nessun test funzionale — quel box
 * sparirebbe soltanto dalle statistiche, in silenzio, che è esattamente il
 * difetto da cui nasce la voce di backlog.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLIENT_CAPABILITIES,
  clientHeaderValue,
  clientIdentity,
  cloudSyncHeaders,
  formatClientHeader,
  normalizePlatform,
} from "../../../cli/src/lib/client-identity.js";
import {
  CLIENT_COLUMNS,
  clientIdentityChanged,
  clientIdentityPatch,
  missingClientColumns,
  parseClientHeader,
} from "@/lib/cloud-sync/client-identity";

const CLI_ROOT = join(__dirname, "../../../cli/src");

describe("dichiarazione del client (CLI)", () => {
  it("normalizza process.platform in una famiglia di sistema, mai il valore grezzo", () => {
    expect(normalizePlatform("darwin")).toBe("macos");
    expect(normalizePlatform("win32")).toBe("windows");
    expect(normalizePlatform("linux")).toBe("linux");
    // Un sistema che non conosciamo non è un errore: è `unknown`. Il CHECK
    // della migration 064 rifiuterebbe qualunque altra stringa.
    expect(normalizePlatform("freebsd")).toBe("unknown");
    expect(normalizePlatform(undefined)).toBe("unknown");
  });

  it("dichiara la versione del pacchetto CLI, non una costante scritta a mano", () => {
    const pkg = JSON.parse(
      readFileSync(join(CLI_ROOT, "../package.json"), "utf-8"),
    );
    expect(clientIdentity().version).toBe(pkg.version);
  });

  it("firma la chiamata senza perdere il token né gli header di chi chiama", () => {
    const headers = cloudSyncHeaders("jht_sync_abc", {
      "Content-Type": "application/json",
    });
    expect(headers.Authorization).toBe("Bearer jht_sync_abc");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-JHT-Client"]).toContain("version=");
  });
});

describe("lettura della dichiarazione (web)", () => {
  it("legge la riga prodotta dal CLI — il contratto fra i due linguaggi", () => {
    const parsed = parseClientHeader(clientHeaderValue());
    const declared = clientIdentity();
    expect(parsed).toEqual({
      version: declared.version,
      platform: declared.platform,
      capabilities: declared.capabilities,
    });
    // La capability su cui il web gatea il composer deve esistere davvero:
    // dichiararla è ciò che distingue un box che riceve la chat da uno muto.
    expect(parsed?.capabilities).toContain("chat");
    expect(CLIENT_CAPABILITIES).toContain("chat");
  });

  it("tollera spaziature e maiuscole senza inventare valori", () => {
    expect(parseClientHeader("  Version = 0.3.5 ;PLATFORM=Linux ")).toEqual({
      version: "0.3.5",
      platform: "linux",
      capabilities: [],
    });
  });

  it("scarta i campi fuori whitelist invece di accoglierli", () => {
    // Il confine dello scope non è una convenzione fra noi: un client che
    // provasse a mandare un hostname non deve avere un posto dove metterlo.
    const parsed = parseClientHeader(
      "version=0.3.5; platform=linux; hostname=vps-di-qualcuno; ip=203.0.113.7",
    );
    expect(parsed).toEqual({
      version: "0.3.5",
      platform: "linux",
      capabilities: [],
    });
    expect(JSON.stringify(parsed)).not.toContain("203.0.113.7");
  });

  it("rifiuta valori malformati e header abnormi", () => {
    expect(parseClientHeader("version=0.3.5 ../../etc/passwd")).toBeNull();
    expect(parseClientHeader("platform=solaris")).toBeNull();
    expect(parseClientHeader(null)).toBeNull();
    expect(parseClientHeader("")).toBeNull();
    expect(parseClientHeader(`version=${"9".repeat(64)}`)).toBeNull();
    expect(parseClientHeader(`version=0.3.5; x=${"a".repeat(600)}`)).toBeNull();
  });

  it("deduplica le capability e ne limita il numero", () => {
    expect(parseClientHeader("capabilities=chat,chat,file-bridge")).toEqual({
      version: null,
      platform: null,
      capabilities: ["chat", "file-bridge"],
    });
    const many = Array.from({ length: 50 }, (_, i) => `cap-${i}`).join(",");
    expect(parseClientHeader(`capabilities=${many}`)?.capabilities).toHaveLength(
      32,
    );
    // Una capability sporca cade da sola, senza portarsi via le altre.
    expect(
      parseClientHeader("capabilities=chat,NON valida!,tickets")?.capabilities,
    ).toEqual(["chat", "tickets"]);
  });
});

describe("scrittura su cloud_sync_tokens", () => {
  const declared = { version: "0.3.5", platform: "linux", capabilities: ["chat"] };

  it("non riscrive una dichiarazione identica", () => {
    // Il box ripete lo stesso header per settimane: senza questo confronto
    // pagheremmo una UPDATE a ogni tocco di last_used_at (il Disk IO Budget
    // è già stato saturato una volta, vedi la sessione del 2026-05-18).
    expect(
      clientIdentityChanged(
        {
          client_version: "0.3.5",
          client_platform: "linux",
          client_capabilities: ["chat"],
        },
        declared,
      ),
    ).toBe(false);
  });

  it("riconosce un aggiornamento del box in ognuno dei tre campi", () => {
    expect(
      clientIdentityChanged({ client_version: "0.3.4" }, declared),
    ).toBe(true);
    expect(
      clientIdentityChanged(
        { client_version: "0.3.5", client_platform: "macos" },
        declared,
      ),
    ).toBe(true);
    expect(
      clientIdentityChanged(
        {
          client_version: "0.3.5",
          client_platform: "linux",
          client_capabilities: [],
        },
        declared,
      ),
    ).toBe(true);
  });

  it("riconosce il primo box che si presenta (colonne ancora NULL)", () => {
    expect(clientIdentityChanged({}, declared)).toBe(true);
  });

  it("scrive solo le quattro colonne previste", () => {
    const patch = clientIdentityPatch(declared, "2026-08-08T10:00:00.000Z");
    expect(Object.keys(patch).sort()).toEqual([
      "client_capabilities",
      "client_platform",
      "client_seen_at",
      "client_version",
    ]);
  });
});

describe("il web può arrivare prima della migration", () => {
  // Deploy del codice e deploy dello schema sono due gesti distinti, e non
  // c'è nulla che imponga l'ordine. Se una `select` sulle colonne di
  // telemetria facesse fallire `verifyBearerToken`, il primo effetto di
  // questo lavoro sarebbe spegnere la cloud-sync di tutti — un prezzo
  // assurdo per una stringa di versione. Le query degradano, e questi test
  // tengono fermo il riconoscimento del caso.
  it("riconosce la colonna che non c'è ancora", () => {
    expect(missingClientColumns({ code: "42703" })).toBe(true);
    expect(
      missingClientColumns({
        message: 'column cloud_sync_tokens.client_version does not exist',
      }),
    ).toBe(true);
  });

  it("non scambia un guasto vero per una migration mancante", () => {
    // Un errore di connessione o di permessi deve restare un errore: se lo
    // trattassimo come "colonne assenti" nasconderemmo il guasto dietro un
    // secondo tentativo identico.
    expect(missingClientColumns(null)).toBe(false);
    expect(missingClientColumns({ code: "PGRST301", message: "JWT expired" })).toBe(
      false,
    );
    expect(missingClientColumns({ message: "connection refused" })).toBe(false);
  });

  it("le colonne di telemetria sono un elenco a parte, non sparse nelle query", () => {
    // Se venissero scritte a mano in ogni `select`, la prossima
    // aggiungerebbe una colonna senza il suo fallback.
    for (const column of [
      "client_version",
      "client_platform",
      "client_capabilities",
      "client_seen_at",
    ]) {
      expect(CLIENT_COLUMNS).toContain(column);
    }
  });
});

describe("nessuna corsia cloud-sync senza firma", () => {
  // Sorgenti che parlano con le NOSTRE route cloud-sync. Fuori lista restano
  // supabase-direct.js (PostgREST) e l'upload su signed URL del file bridge:
  // lì l'header non ha un lettore e sarebbe solo rumore.
  const SIGNED = [
    "commands/cloud.js",
    "lib/chat-sync.js",
    "lib/file-bridge-poller.js",
    "lib/user-messages-poller.js",
    "lib/team-commands-poller.js",
    "lib/team-state-reconciler.js",
    "lib/sync-rendezvous.js",
  ];

  it.each(SIGNED)("%s costruisce gli header dall'helper", (relative) => {
    const source = readFileSync(join(CLI_ROOT, relative), "utf-8");
    expect(source).toContain("cloudSyncHeaders");
    // Un `Authorization` scritto a mano è una corsia che non dichiara nulla:
    // il box resterebbe autenticato e invisibile insieme.
    expect(source).not.toMatch(/Authorization: `Bearer/);
  });
});
