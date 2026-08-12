import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import {
  splitTicketRequest,
  ticketRequestWithAttachment,
} from "../../../web/lib/ticket-attachment";

const repo = join(__dirname, "../../..");
const home = mkdtempSync(join(tmpdir(), "jht-ticket-file-home-"));
const userDir = mkdtempSync(join(tmpdir(), "jht-ticket-file-user-"));
process.env.JHT_HOME = home;
process.env.JHT_USER_DIR = userDir;

const requireFromWeb = createRequire(join(repo, "web/package.json"));
const Database = requireFromWeb("better-sqlite3");
const db = new Database(join(home, "jobs.db"));
db.exec(`
  CREATE TABLE positions (id INTEGER PRIMARY KEY, title TEXT, company TEXT);
  CREATE TABLE position_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    position_id INTEGER NOT NULL,
    request_text TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'custom',
    status TEXT NOT NULL DEFAULT 'open',
    assigned_agent TEXT,
    response_text TEXT,
    cloud_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    assigned_at TEXT,
    resolved_at TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO positions (id, title, company) VALUES (643, 'Role', 'Company');
`);

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => null),
  requireLocalWrite: vi.fn(async () => null),
}));
vi.mock("@/lib/team-state/auth", () => ({
  resolveUser: vi.fn(() => {
    throw new Error("il path cloud non deve essere chiamato nel test locale");
  }),
}));
vi.mock("@/lib/local-token", () => ({
  LOCAL_TOKEN_COOKIE: "jht_local_token",
  isLocalTokenAuthenticated: vi.fn(() => false),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn() })),
}));

const { POST: openTicket } =
  await import("@/app/api/positions/[legacyId]/ticket/route");
const { POST: profileUpload } = await import("@/app/api/profile/upload/route");
const { saveUserDocument } = await import("@/lib/user-document-upload.server");

function ticketRequest(file: File) {
  const form = new FormData();
  form.append("request_text", "Confronta il brief con i requisiti");
  form.append("attachment", file);
  return openTicket(
    new Request("http://localhost/api/positions/643/ticket", {
      method: "POST",
      body: form,
    }) as never,
    { params: Promise.resolve({ legacyId: "643" }) },
  );
}

beforeEach(() => {
  db.exec("DELETE FROM position_tickets");
  rmSync(join(userDir, "allegati"), { recursive: true, force: true });
});

afterAll(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
  rmSync(userDir, { recursive: true, force: true });
});

describe("allegato ticket web sul trasporto documenti esistente", () => {
  it("salva i byte e registra nel ticket il path visto dal team", async () => {
    const bytes = new TextEncoder().encode("synthetic document");
    const response = await ticketRequest(
      new File([bytes], "brief con spazi.pdf", { type: "application/pdf" }),
    );

    expect(response.status).toBe(200);
    expect(
      readFileSync(join(userDir, "allegati", "brief_con_spazi.pdf")),
    ).toEqual(Buffer.from(bytes));
    const row = db
      .prepare("SELECT request_text FROM position_tickets")
      .get() as { request_text: string };
    expect(row.request_text).toBe(
      "Confronta il brief con i requisiti\n\n" +
        "[FILE ALLEGATI]\n/jht_user/allegati/brief_con_spazi.pdf",
    );
  });

  it("un file rifiutato non crea il ticket", async () => {
    const response = await ticketRequest(new File(["x"], "payload.exe"));

    expect(response.status).toBe(400);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM position_tickets").get(),
    ).toMatchObject({ n: 0 });
  });

  it("una lettura fallita non tronca un file omonimo già salvato", async () => {
    const uploads = join(userDir, "allegati");
    const first = new FormData();
    first.append("files", new File(["original"], "brief.pdf"));
    await profileUpload(
      new Request("http://localhost/api/profile/upload", {
        method: "POST",
        body: first,
      }) as never,
    );
    const unreadable = new File(["replacement"], "brief.pdf");
    Object.defineProperty(unreadable, "arrayBuffer", {
      value: async () => {
        throw new Error("synthetic read failure");
      },
    });

    await expect(saveUserDocument(unreadable)).rejects.toThrow(
      "file non leggibile",
    );
    expect(readFileSync(join(uploads, "brief.pdf"), "utf8")).toBe("original");
  });

  it("non segue un symlink della directory allegati", async () => {
    const outside = mkdtempSync(join(tmpdir(), "jht-ticket-file-outside-"));
    const uploads = join(userDir, "allegati");
    rmSync(uploads, { recursive: true, force: true });
    symlinkSync(outside, uploads, "dir");
    try {
      await expect(
        saveUserDocument(new File(["synthetic"], "boundary.pdf")),
      ).rejects.toThrow("errore di scrittura");
      expect(existsSync(join(outside, "boundary.pdf"))).toBe(false);
    } finally {
      rmSync(uploads, { force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("non crea fuori root se allegati cambia dopo l'attestazione", async () => {
    const outside = mkdtempSync(join(tmpdir(), "jht-ticket-race-outside-"));
    const uploads = join(userDir, "allegati");
    const held = join(userDir, "allegati-held");
    let swapped = false;
    const originalClose = fs.closeSync.bind(fs);
    const closeSpy = vi.spyOn(fs, "closeSync").mockImplementation((fd) => {
      originalClose(fd);
      if (!swapped) {
        swapped = true;
        fs.renameSync(uploads, held);
        fs.symlinkSync(outside, uploads, "dir");
      }
    });
    try {
      await expect(
        saveUserDocument(new File(["synthetic"], "boundary-race.pdf")),
      ).rejects.toThrow("errore di scrittura");
      expect(existsSync(join(outside, "boundary-race.pdf"))).toBe(false);
    } finally {
      closeSpy.mockRestore();
      rmSync(uploads, { force: true });
      rmSync(held, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("anche il profilo passa dallo stesso writer", async () => {
    const form = new FormData();
    form.append("files", new File(["sheet"], "dati.csv"));

    const response = await profileUpload(
      new Request("http://localhost/api/profile/upload", {
        method: "POST",
        body: form,
      }) as never,
    );

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      saved: ["dati.csv"],
      errors: [],
    });
    expect(readFileSync(join(userDir, "allegati", "dati.csv"), "utf8")).toBe(
      "sheet",
    );
  });
});

describe("presentazione del protocollo ticket", () => {
  it("separa testo e nome senza mostrare il path operativo", () => {
    const stored = ticketRequestWithAttachment(
      "Leggi questo",
      "/jht_user/allegati/brief.pdf",
    );
    expect(splitTicketRequest(stored)).toEqual({
      text: "Leggi questo",
      attachmentPath: "/jht_user/allegati/brief.pdf",
      attachmentName: "brief.pdf",
    });
  });

  it("non interpreta un marker scritto a mano con path non canonico", () => {
    const raw = "testo\n\n[FILE ALLEGATI]\n/jht_user/allegati/../segreto.pdf";
    expect(splitTicketRequest(raw)).toEqual({
      text: raw,
      attachmentPath: null,
      attachmentName: null,
    });
  });
});
