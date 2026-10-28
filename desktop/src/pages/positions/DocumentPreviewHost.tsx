import { useEffect, useState } from "react";
import { onDocumentPreviewRequest, type DocumentPreviewApi, type DocumentPreviewRequest } from "../../lib/team-document";
import DocumentPreview from "./DocumentPreview";

/**
 * Where the preview window lives: inside the page of the signed-in app, so that leaving the page or the account
 * (the page is keyed by its path, and the whole shell goes with the account) closes it. It shows what a click on
 * the position page's «Preview» asked for, one document at a time.
 */
export default function DocumentPreviewHost({ api }: { api?: DocumentPreviewApi }) {
  const [request, setRequest] = useState<DocumentPreviewRequest | null>(null);
  useEffect(() => onDocumentPreviewRequest(setRequest), []);
  return request ? <DocumentPreview request={request} onClose={() => setRequest(null)} api={api} /> : null;
}
