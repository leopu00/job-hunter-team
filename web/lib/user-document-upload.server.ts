import fs from "node:fs";
import path from "node:path";
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

  fs.mkdirSync(JHT_USER_UPLOADS_DIR, { recursive: true });
  const destination = path.join(JHT_USER_UPLOADS_DIR, safeName);
  const flags =
    fs.constants.O_WRONLY |
    fs.constants.O_CREAT |
    fs.constants.O_TRUNC |
    fs.constants.O_NOFOLLOW;
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(destination, flags, 0o644);
    const bytes = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(descriptor, bytes);
  } catch {
    throw new UserDocumentUploadError(`${file.name}: errore di scrittura`);
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }

  return {
    name: safeName,
    path: `${CONTAINER_UPLOAD_DIR}/${safeName}`,
    bytes: file.size,
  };
}
