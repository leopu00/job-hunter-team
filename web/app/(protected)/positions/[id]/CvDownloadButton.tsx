"use client";

import { useCallback, useEffect, useState } from "react";
import { useReadOnlyActions } from "@/lib/read-only-actions";

/**
 * Pulsante di download del CV/Cover Letter generato per una posizione.
 *
 * I binari NON stanno nel DB: vivono sul disco della VPS/container. Due modi:
 *   • cloud (web pubblico, niente filesystem) → BRIDGE on-demand: crea una
 *     richiesta, il poller VPS carica il file nel bucket effimero Supabase,
 *     poi si apre la signed URL (che viene purgata dopo un TTL corto). Il file
 *     NON viene mai cancellato dalla VPS/computer: il bucket è solo un ponte.
 *   • local (desktop, filesystem accessibile) → link diretto al file.
 * Vedi docs/internal/file-bridge-on-demand-2026-06-07.md
 */
type ButtonState = "idle" | "loading" | "error";

/** The desktop listens to this event and saves the PDF natively (desktop/src/lib/team-document.ts). */
const SAVE_DOCUMENT_EVENT = "jht:save-document";
/**
 * The desktop also shows the document inside the app. The button asks first (`probe`): only a desktop that answers
 * `supported` gets the «Preview» button; the web never does. The request carries two plain file names and the kind.
 */
const PREVIEW_DOCUMENT_EVENT = "jht:preview-document";

// Scarica via <a> anchor invece di window.open: l'apertura del file avviene
// DOPO il polling async (fuori dal gesto del click) e in quel contesto i
// popup-blocker del browser fermano window.open. Un anchor senza target verso
// una URL con Content-Disposition: attachment scarica il file senza aprire
// finestre → nessun blocco.
function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function CvDownloadButton({
  fileName,
  cloudMode,
  color,
  labels,
  previewKind,
  textName = null,
}: {
  fileName: string;
  cloudMode: boolean;
  color: string;
  labels: { idle: string; preparing: string; error: string; preview?: string };
  /** What kind of document this is; the preview button needs it and the desktop. */
  previewKind?: "cv" | "letter";
  /** The markdown the PDF was made from, when the application has one. */
  textName?: string | null;
}) {
  const readOnly = useReadOnlyActions();
  const [state, setState] = useState<ButtonState>("idle");
  const [reason, setReason] = useState<string | null>(null);
  const [canPreview, setCanPreview] = useState(false);

  useEffect(() => {
    if (!previewKind || !labels.preview) return;
    const detail: { probe: boolean; supported?: boolean } = { probe: true };
    window.dispatchEvent(new CustomEvent(PREVIEW_DOCUMENT_EVENT, { detail, cancelable: true }));
    setCanPreview(detail.supported === true);
  }, [previewKind, labels.preview]);

  const preview = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent(PREVIEW_DOCUMENT_EVENT, { detail: { name: fileName, textName, kind: previewKind }, cancelable: true }),
    );
  }, [fileName, textName, previewKind]);

  // In the desktop the PDF is read from the team and saved where the person picks (the bridge below needs a
  // key the app does not have). Nobody listening (the web): false, and the button goes on as it did.
  const saveInDesktop = useCallback(async (): Promise<boolean> => {
    const detail: { name: string; result?: Promise<string> } = {
      name: fileName,
    };
    const handled = !window.dispatchEvent(
      new CustomEvent(SAVE_DOCUMENT_EVENT, { detail, cancelable: true }),
    );
    if (!handled || !detail.result) return false;
    setState("loading");
    setReason(null);
    try {
      await detail.result;
      setState("idle");
    } catch (error) {
      const message = (error as { message?: unknown } | null)?.message;
      setReason(typeof message === "string" ? message : null);
      setState("error");
    }
    return true;
  }, [fileName]);

  const openLocal = useCallback(() => {
    window.open(
      `/api/profile/files/${encodeURIComponent(fileName)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }, [fileName]);

  const openViaBridge = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch("/api/profile/files/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: fileName }),
      });
      const data = await res.json();
      if (!res.ok || !data.requestId) {
        throw new Error(data.error || "request failed");
      }

      // Poll: ~60 tentativi × 2s = 120s max. Il poller VPS idle polla ≤30s e
      // scende a 5s appena c'è una richiesta → prima consegna entro ~40s, le
      // successive entro ~10s. Il margine a 120s copre il worst-case idle.
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const pr = await fetch(`/api/profile/files/request/${data.requestId}`);
        const pd = await pr.json();
        if (pd.status === "ready" && pd.url) {
          triggerDownload(pd.url);
          setState("idle");
          return;
        }
        if (pd.status === "error" || pd.status === "expired") {
          throw new Error(pd.error || pd.status);
        }
      }
      throw new Error("timeout");
    } catch {
      setState("error");
    }
  }, [fileName]);

  const onClick = async () => {
    if (await saveInDesktop()) return;
    // Saving the PDF is a read, so it works on a team the desktop only reads; the bridge writes a request.
    if (readOnly.readOnly) return;
    await (cloudMode ? openViaBridge() : openLocal());
  };
  const text =
    state === "loading"
      ? labels.preparing
      : state === "error"
        ? labels.error
        : labels.idle;
  const isError = state === "error";

  return (
    <>
      <button
        type="button"
        onClick={() => void onClick()}
        disabled={state === "loading"}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] font-semibold no-underline transition-colors hover:bg-[var(--color-row)] disabled:cursor-wait bg-transparent cursor-pointer"
        style={{
          borderColor: isError ? "var(--color-red)" : color,
          color: isError ? "var(--color-red)" : color,
        }}
      >
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <span className={state === "loading" ? "animate-pulse" : undefined}>
          {text}
        </span>
      </button>
      {canPreview && previewKind && labels.preview && (
        <button
          type="button"
          onClick={preview}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] font-semibold no-underline transition-colors hover:bg-[var(--color-row)] bg-transparent cursor-pointer"
          style={{ borderColor: color, color }}
        >
          {labels.preview}
        </button>
      )}
      {isError && reason && (
        <p role="alert" className="w-full text-[10px] text-[var(--color-red)]">
          {reason}
        </p>
      )}
    </>
  );
}
