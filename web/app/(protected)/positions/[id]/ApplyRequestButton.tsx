"use client";

import Link from "next/link";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useLocale } from "@/lib/use-locale";
import { makeT } from "@/lib/i18n-dict";
import { useReadOnlyActions } from "@/lib/read-only-actions";
import type { ApplyRequestState } from "@/lib/apply-request-rule";
import {
  requestFailureMessage,
  requestFailureReason,
  sendPositionRequest,
} from "@/lib/position-request";
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

// Autorizzata (o ritirata) solo se la route lo conferma con
// `apply_requested`: un 2xx qualunque non basta, perché il bottone direbbe
// «autorizzata» a una candidatura che il CLOSER non vedrà, o «ritirata» a una
// che può ancora partire. `error` è il codice della route, mai una sua frase.
export async function submitApplyRequest(
  legacyId: number,
  requested: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<
  { ok: true } | { ok: false; error: string | null; status: number | null }
> {
  const outcome = await sendPositionRequest(
    `/api/positions/${legacyId}/apply-request`,
    // The click is the authorisation, given in the dialog: it says so. The web route reads the
    // session; the desktop's link to a VPS team asks for this word before it writes there.
    requested
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmed: true }),
        }
      : { method: "DELETE" },
    (body) => body.apply_requested === requested,
    fetchImpl,
  );
  if (outcome.ok) return { ok: true };
  return { ok: false, error: outcome.code, status: outcome.status };
}

// Sul sito l'autorizzazione è a due tempi (porta unica `request_action`): la prima chiamata crea la
// conferma e il database ne compone il testo dalla riga vera (il ruolo e l'azienda); la seconda porta
// solo l'id di quella conferma. Il testo mostrato è SEMPRE quello della risposta, mai uno costruito qui.
const JSON_HEADERS = { "Content-Type": "application/json" };

export type AuthorisationStep =
  | {
      ok: true;
      step: "confirm";
      id: string;
      summary: string;
      expiresAt: string | null;
    }
  | { ok: true; step: "done" }
  | { ok: false; error: string | null; status: number | null };

async function twoStepCall(
  legacyId: number,
  init: RequestInit,
  expected: "awaiting_confirm" | "queued",
  fetchImpl: typeof fetch,
): Promise<AuthorisationStep> {
  const outcome = await sendPositionRequest(
    `/api/positions/${legacyId}/apply-request`,
    { ...init, headers: JSON_HEADERS },
    (body) =>
      body.ok === true &&
      (body.state === expected ||
        (expected === "queued" && body.state === "done")),
    fetchImpl,
  );
  if (!outcome.ok) {
    return { ok: false, error: outcome.code, status: outcome.status };
  }
  if (expected === "queued") return { ok: true, step: "done" };
  const { id, summary, expiresAt } = outcome.body;
  if (
    typeof id !== "string" ||
    typeof summary !== "string" ||
    !summary.trim()
  ) {
    return { ok: false, error: null, status: 500 };
  }
  return {
    ok: true,
    step: "confirm",
    id,
    summary,
    expiresAt: typeof expiresAt === "string" ? expiresAt : null,
  };
}

/** Primo tempo: chiede la conferma. Non autorizza niente. */
export function startAuthorisation(
  legacyId: number,
  fetchImpl: typeof fetch = fetch,
) {
  return twoStepCall(
    legacyId,
    { method: "POST", body: "{}" },
    "awaiting_confirm",
    fetchImpl,
  );
}

/** Secondo tempo: porta solo l'id della conferma ricevuta. */
export function confirmAuthorisation(
  legacyId: number,
  confirmId: string,
  fetchImpl: typeof fetch = fetch,
) {
  return twoStepCall(
    legacyId,
    { method: "POST", body: JSON.stringify({ confirmId }) },
    "queued",
    fetchImpl,
  );
}

/** Il ritiro (l'annullo): vale subito, senza conferma. */
export function withdrawAuthorisation(
  legacyId: number,
  fetchImpl: typeof fetch = fetch,
) {
  return twoStepCall(
    legacyId,
    { method: "DELETE", body: "{}" },
    "queued",
    fetchImpl,
  );
}

/** La frase per un rifiuto che la route motiva con un codice noto. */
export function refusalText(t: Translate, error: string | null): string | null {
  if (error === "already_submitted") return t("refused_already_submitted");
  if (error === "position_not_ready") return t("refused_position_not_ready");
  if (error === "reauth_required") return t("refused_reauth_required");
  if (error === "rate_limited") return t("refused_rate_limited");
  if (
    error === "confirm_expired" ||
    error === "confirm_used" ||
    error === "confirm_not_found" ||
    error === "confirm_session_mismatch" ||
    error === "confirm_action_mismatch"
  ) {
    return t("refused_confirm_stale");
  }
  return null;
}

export function ApplyRequestView({
  state,
  t,
  busy = false,
  error = null,
  confirming = false,
  confirmation = null,
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
  /** Il testo che il server ha composto per questa conferma (il ruolo e l'azienda) e fin quando vale. */
  confirmation?: { summary: string; expiresText: string | null } | null;
  onAuthorise?: () => void;
  onConfirm?: () => void;
  onDismiss?: () => void;
  onWithdraw?: () => void;
}) {
  const readOnly = useReadOnlyActions();
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
      disabled={busy || readOnly.readOnly}
      title={readOnly.readOnly ? readOnly.reason : undefined}
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
        <p
          role="alert"
          className="mt-1 text-[10px]"
          style={{ color: "var(--color-red)" }}
        >
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
              {confirmation && (
                <div
                  data-server-summary
                  className="mt-2 rounded-lg border p-2"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <div className="text-[10px] text-[var(--color-muted)]">
                    {t("confirm_summary_label")}
                  </div>
                  <div className="mt-0.5 break-words text-[12px] font-semibold text-[var(--color-white)]">
                    {confirmation.summary}
                  </div>
                  {confirmation.expiresText && (
                    <div className="mt-1 text-[10px] text-[var(--color-muted)]">
                      {confirmation.expiresText}
                    </div>
                  )}
                </div>
              )}
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
  twoStep = false,
}: {
  legacyId: number;
  state: ApplyRequestState;
  /** Sul sito: l'autorizzazione è a due tempi e il testo della conferma lo compone il server. */
  twoStep?: boolean;
}) {
  const locale = useLocale();
  const t = makeT(T, locale);
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<{
    id: string;
    summary: string;
    expiresAt: string | null;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  const fail = (
    action: "authorise" | "withdraw",
    outcome: { error: string | null; status: number | null },
  ) => {
    const reason =
      refusalText(t, outcome.error) ??
      requestFailureReason(locale, outcome.status);
    setError(requestFailureMessage(locale, action, reason));
  };

  // Primo tempo: il server compone il testo e lo legge l'utente; nessuna autorizzazione ancora.
  const startTwoStep = async () => {
    setError(null);
    setSending(true);
    try {
      const outcome = await startAuthorisation(legacyId);
      if (!outcome.ok) return fail("authorise", outcome);
      if (outcome.step === "confirm") setPending(outcome);
    } finally {
      setSending(false);
    }
  };

  // Secondo tempo: solo l'id della conferma, entro la sua scadenza.
  const confirmTwoStep = async () => {
    if (!pending) return;
    const { id } = pending;
    setPending(null);
    setError(null);
    setSending(true);
    try {
      const outcome = await confirmAuthorisation(legacyId, id);
      if (!outcome.ok) return fail("authorise", outcome);
      startTransition(() => router.refresh());
    } finally {
      setSending(false);
    }
  };

  const withdrawTwoStep = async () => {
    setError(null);
    setSending(true);
    try {
      const outcome = await withdrawAuthorisation(legacyId);
      if (!outcome.ok) return fail("withdraw", outcome);
      startTransition(() => router.refresh());
    } finally {
      setSending(false);
    }
  };

  const expiresText =
    pending?.expiresAt && !Number.isNaN(Date.parse(pending.expiresAt))
      ? t("confirm_expires").replace(
          "{time}",
          new Date(pending.expiresAt).toLocaleTimeString(locale, {
            hour: "2-digit",
            minute: "2-digit",
          }),
        )
      : null;

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
        const reason =
          refusalText(t, outcome.error) ??
          requestFailureReason(locale, outcome.status);
        setError(
          requestFailureMessage(
            locale,
            requested ? "authorise" : "withdraw",
            reason,
          ),
        );
        return;
      }
      startTransition(() => router.refresh());
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
      confirming={twoStep ? pending !== null : confirming}
      confirmation={
        twoStep && pending ? { summary: pending.summary, expiresText } : null
      }
      onAuthorise={
        twoStep ? () => void startTwoStep() : () => setConfirming(true)
      }
      onConfirm={twoStep ? () => void confirmTwoStep() : () => void send(true)}
      onDismiss={twoStep ? () => setPending(null) : () => setConfirming(false)}
      onWithdraw={
        twoStep ? () => void withdrawTwoStep() : () => void send(false)
      }
      // Il dialogo esce dall'albero della pagina: un antenato con `transform`
      // (l'animazione d'ingresso) farebbe di `fixed` un riquadro, non lo schermo.
      portal={(dialog) => createPortal(dialog, document.body)}
    />
  );
}
