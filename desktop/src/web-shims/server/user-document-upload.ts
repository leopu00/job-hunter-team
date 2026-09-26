/**
 * Stand-in for web/lib/user-document-upload.server.ts, which saves an
 * attachment in the user's folder on the box (filesystem, child_process).
 * The ticket route saves one only on its local branch; on the cloud branch it
 * answers `attachment_unavailable` before getting here.
 */
export type SavedUserDocument = {
  name: string;
  path: string;
  bytes: number;
};

export class UserDocumentUploadError extends Error {}

export async function saveUserDocument(_file: File): Promise<SavedUserDocument> {
  throw new UserDocumentUploadError("attachments are saved on the user's box, not in the desktop");
}
