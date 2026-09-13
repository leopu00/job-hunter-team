"use client";

import Link from "next/link";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useLocale } from "@/lib/use-locale";
import { makeT } from "@/lib/i18n-dict";
import type { ApplyRequestState } from "@/lib/apply-request-rule";
import { T } from "./ApplyRequestButton.i18n";

// [JHT-CLOSER] Il bottone con cui l'utente autorizza la candidatura dal sito.
//
// Il click È l'autorizzazione a inviare: il CLOSER non chiede un secondo
// consenso prima di Invia. Per questo il dialogo di conferma lo dice in
// chiaro, e la decisione su cosa sia autorizzabile non sta qui ma nella route
// (che legge `shared/cloud/apply-request-rule.json`): il bottone mostra lo
// stato che il server ha calcolato e riporta il rifiuto della route, non ne
// ricalcola uno suo.

type Translate = (key: string) => string;

export async function submitApplyRequest(
  legacyId: number,
  requested: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetchImpl(`/api/positions/${legacyId}/apply-request`, {
    method: requested ? "POST" : "DELETE",
  });
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, error: body?.error ?? `HTTP ${res.status}` };
}

export function refusalText(t: Translate, error: string): string {
  if (error === "already_submitted") return t("refused_already_submitted");
  if (error === "position_not_ready") return t("refused_position_not_ready");
  return error;
}

export function ApplyRequestView({
  state,
  t,
  busy = false,
  error = null,
  confirming = false,
  onAuthorise,
  onConfirm,
  onDismiss,
  onWithdraw,
  portal,
}: {
  portal?: (dialog: ReactNode) => ReactNode;
  state: ApplyRequestState;
  t: Translate;
  busy?: boolean;
  error?: string | null;
  confirming?: boolean;
  onAuthorise?: () => void;
  onConfirm?: () => void;
  onDismiss?: () => void;
  onWithdraw?: () => void;
}) {
  if (state.kind === "hidden") return null;

  const button = (
    label: string,
    onClick: (() => void) | undefined,
    tone: "primary" | "quiet",
    action: string,
  ) => (
    <button
      type="button"
      data-action={action}
      onClick={onClick}
      disabled={busy}
      className="rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-colors hover:bg-[var(--color-row)] disabled:cursor-not-allowed disabled:opacity-60"
      style={{
        borderColor:
          tone === "primary" ? "var(--color-green)" : "var(--color-border)",
        color: tone === "primary" ? "var(--color-green)" : "var(--color-muted)",
      }}
    >
      {label}
    </button>
  );

  let description: string;
  let accent = "var(--color-border)";
  const actions: ReactNode[] = [];
  let detail: ReactNode = null;
  switch (state.kind) {
    case "available":
      description = t("available_desc");
      actions.push(button(t("authorise"), onAuthorise, "primary", "authorise"));
      break;
    case "authorised":
      description = t("authorised_desc");
      accent = "var(--color-green)";
      actions.push(button(t("withdraw"), onWithdraw, "quiet", "withdraw"));
      break;
    case "sending":
      description = t("sending_desc").replace("{step}", state.step);
      accent = "var(--color-blue)";
      break;
    case "stopped":
      description = t("stopped_desc");
      accent = "var(--color-yellow)";
      detail = (
        <p className="mt-1 whitespace-pre-line break-words text-[10px] leading-relaxed text-[var(--color-muted)]">
          {state.reason}
        </p>
      );
      if (state.messageId) {
        actions.push(
          <Link
            key="messages"
            href="/messages"
            data-action="messages"
            className="rounded-lg border px-3 py-1.5 text-[11px] font-semibold no-underline"
            style={{
              borderColor: "var(--color-yellow)",
              color: "var(--color-yellow)",
            }}
          >
            {t("open_messages")}
          </Link>,
        );
      }
      actions.push(
        button(t("reauthorise"), onAuthorise, "primary", "reauthorise"),
      );
      actions.push(button(t("withdraw"), onWithdraw, "quiet", "withdraw"));
      break;
    case "sent":
      description = state.withReceipt ? t("sent_receipt_desc") : t("sent_desc");
      accent = "var(--color-green)";
      break;
  }

  return (
    <section
      data-apply-state={state.kind}
      className="rounded-lg border p-3"
      style={{ borderColor: accent }}
    >
      <div className="text-[12px] font-semibold text-[var(--color-white)]">
        {t("title")}
      </div>
      <p className="mt-0.5 text-[10px] leading-relaxed text-[var(--color-muted)]">
        {description}
      </p>
      {detail}
      {actions.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {actions.map((node, i) => (
            <span key={i}>{node}</span>
          ))}
        </div>
      )}
      {error && (
        <p className="mt-1 text-[10px]" style={{ color: "var(--color-red)" }}>
          {error}
        </p>
      )}
      {confirming &&
        (portal ?? ((dialog: ReactNode) => dialog))(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.6)" }}
            onClick={(e) => {
              if (e.target === e.currentTarget) onDismiss?.();
            }}
          >
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="apply-request-confirm-title"
              aria-describedby="apply-request-confirm-body"
              className="w-full max-w-md rounded-lg border p-5"
              style={{
                background: "var(--color-panel)",
                borderColor: "var(--color-border)",
              }}
            >
              <h2
                id="apply-request-confirm-title"
                className="text-sm font-semibold text-[var(--color-bright)]"
              >
                {t("confirm_title")}
              </h2>
              <p
                id="apply-request-confirm-body"
                className="mt-2 text-[12px] leading-relaxed text-[var(--color-muted)]"
              >
                {t("confirm_body")}
              </p>
              <div className="mt-4 flex justify-end gap-2">
                {button(t("confirm_no"), onDismiss, "quiet", "dismiss")}
                {button(t("confirm_yes"), onConfirm, "primary", "confirm")}
              </div>
            </div>
          </div>,
        )}
    </section>
  );
}

export function ApplyRequestButton({
  legacyId,
  state,
}: {
  legacyId: number;
  state: ApplyRequestState;
}) {
  const t = makeT(T, useLocale());
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Mentre il CLOSER lavora lo stato cambia senza che l'utente tocchi niente:
  // si rilegge dal server finché la candidatura non parte o non si ferma.
  const waiting = state.kind === "authorised" || state.kind === "sending";
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => router.refresh(), 20_000);
    return () => clearInterval(timer);
  }, [waiting, router]);

  const send = async (requested: boolean) => {
    setConfirming(false);
    setError(null);
    setSending(true);
    try {
      const outcome = await submitApplyRequest(legacyId, requested);
      if (!outcome.ok) {
        setError(refusalText(t, outcome.error));
        return;
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : t("network_error"));
    } finally {
      setSending(false);
    }
  };

  return (
    <ApplyRequestView
      state={state}
      t={t}
      busy={sending || isPending}
      error={error}
      confirming={confirming}
      onAuthorise={() => setConfirming(true)}
      onConfirm={() => void send(true)}
      onDismiss={() => setConfirming(false)}
      onWithdraw={() => void send(false)}
      // Il dialogo esce dall'albero della pagina: un antenato con `transform`
      // (l'animazione d'ingresso) farebbe di `fixed` un riquadro, non lo schermo.
      portal={(dialog) => createPortal(dialog, document.body)}
    />
  );
}
