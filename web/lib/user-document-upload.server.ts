import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { JHT_USER_UPLOADS_DIR } from "./jht-paths";

const CONTAINER_UPLOAD_DIR = "/jht_user/allegati";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".txt",
  ".md",
  ".png",
  ".jpg",
  ".jpeg",
  ".csv",
  ".xlsx",
  ".xls",
  ".json",
  ".yaml",
  ".yml",
]);

export type SavedUserDocument = {
  name: string;
  path: string;
  bytes: number;
};

export class UserDocumentUploadError extends Error {}

function safeFilename(name: string): string {
  const cleaned = path
    .basename(name)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^\.+/, "");
  return cleaned || "document";
}

function assertUploadDirectory(directoryDescriptor: number): void {
  const held = fs.fstatSync(directoryDescriptor);
  const current = fs.lstatSync(JHT_USER_UPLOADS_DIR);
  if (
    !held.isDirectory() ||
    !current.isDirectory() ||
    current.isSymbolicLink() ||
    held.dev !== current.dev ||
    held.ino !== current.ino
  ) {
    throw new Error("upload directory changed");
  }
}

/**
 * Apre la drop-zone senza seguire il componente `allegati`. Il descriptor
 * resta vivo fino a scrittura conclusa e viene confrontato prima e dopo
 * l'apertura del file: un cambio di directory non può diventare un successo.
 */
function openUploadDirectory(): number {
  fs.mkdirSync(path.dirname(JHT_USER_UPLOADS_DIR), { recursive: true });
  try {
    fs.mkdirSync(JHT_USER_UPLOADS_DIR, { mode: 0o755 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const descriptor = fs.openSync(
    JHT_USER_UPLOADS_DIR,
    fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
  );
  try {
    assertUploadDirectory(descriptor);
    return descriptor;
  } catch (error) {
    fs.closeSync(descriptor);
    throw error;
  }
}

type ArtifactUploadResult = {
  ok?: boolean;
  path?: string;
  name?: string;
  bytes?: number;
};

function artifactSkillPath(): string {
  const candidates = [
    path.resolve(process.cwd(), "shared/skills/artifact.py"),
    path.resolve(process.cwd(), "../shared/skills/artifact.py"),
    path.resolve(process.cwd(), "../../shared/skills/artifact.py"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("artifact skill unavailable");
  return found;
}

/**
 * Il write effettivo passa dalla skill canonica, che apre root/directory/file
 * con openat. Node non espone openat: un path assoluto verificato prima della
 * open avrebbe comunque una finestra TOCTOU.
 */
function writeWithArtifactSkill(
  safeName: string,
  bytes: Buffer,
): ArtifactUploadResult {
  const shellVia = process.env.JHT_SHELL_VIA;
  const dockerContainer = shellVia?.startsWith("docker:")
    ? shellVia.slice("docker:".length)
    : null;
  const command = dockerContainer ? "docker" : "python3";
  const args = dockerContainer
    ? [
        "exec",
        "-i",
        dockerContainer,
        "python3",
        "/app/shared/skills/artifact.py",
        "upload",
        "--name",
        safeName,
        "--raw",
      ]
    : [artifactSkillPath(), "upload", "--name", safeName, "--raw"];
  const result = spawnSync(command, args, {
    input: bytes,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    env: dockerContainer
      ? process.env
      : {
          ...process.env,
          JHT_ARTIFACT_ROOT: path.dirname(JHT_USER_UPLOADS_DIR),
        },
  });
  let payload: ArtifactUploadResult = {};
  try {
    payload = JSON.parse(result.stdout || "{}") as ArtifactUploadResult;
  } catch {
    // Il controllo comune sotto rende anche output tronco/non JSON fail-closed.
  }
  if (
    result.error ||
    result.status !== 0 ||
    payload.ok !== true ||
    payload.name !== safeName ||
    payload.path !== `${CONTAINER_UPLOAD_DIR}/${safeName}` ||
    payload.bytes !== bytes.length
  ) {
    throw new Error("artifact upload failed");
  }
  return payload;
}

/**
 * Trasporto web verso la stessa drop-zone di artifact.py e del desktop.
 * O_NOFOLLOW impedisce che una collisione con un symlink scriva fuori
 * dall'area dati; il path restituito è sempre quello visto dal container.
 */
export async function saveUserDocument(file: File): Promise<SavedUserDocument> {
  const safeName = safeFilename(file.name);
  const extension = path.extname(safeName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new UserDocumentUploadError(`${file.name}: tipo non consentito`);
  }
  if (file.size === 0) {
    throw new UserDocumentUploadError(`${file.name}: file vuoto`);
  }
  if (file.size > MAX_BYTES) {
    throw new UserDocumentUploadError(
      `${file.name}: file troppo grande (max 10MB)`,
    );
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await file.arrayBuffer());
  } catch {
    throw new UserDocumentUploadError(`${file.name}: file non leggibile`);
  }
  if (bytes.length !== file.size) {
    throw new UserDocumentUploadError(`${file.name}: lettura incompleta`);
  }

  let directoryDescriptor: number | null = null;
  try {
    directoryDescriptor = openUploadDirectory();
    fs.closeSync(directoryDescriptor);
    directoryDescriptor = null;
    writeWithArtifactSkill(safeName, bytes);
  } catch {
    throw new UserDocumentUploadError(`${file.name}: errore di scrittura`);
  } finally {
    if (directoryDescriptor !== null) fs.closeSync(directoryDescriptor);
  }

  return {
    name: safeName,
    path: `${CONTAINER_UPLOAD_DIR}/${safeName}`,
    bytes: file.size,
  };
}
