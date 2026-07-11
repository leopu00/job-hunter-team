"use client";

import { useCallback, useState } from "react";

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

export function CvDownloadButton({
  fileName,
  cloudMode,
  color,
  labels,
}: {
  fileName: string;
  cloudMode: boolean;
  color: string;
  labels: { idle: string; preparing: string; error: string };
}) {
  const [state, setState] = useState<ButtonState>("idle");

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
          window.open(pd.url, "_blank", "noopener,noreferrer");
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

  const onClick = cloudMode ? openViaBridge : openLocal;
  const text =
    state === "loading"
      ? labels.preparing
      : state === "error"
        ? labels.error
        : labels.idle;
  const isError = state === "error";

  return (
    <button
      type="button"
      onClick={onClick}
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
  );
}
