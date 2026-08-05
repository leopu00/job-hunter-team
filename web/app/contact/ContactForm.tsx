"use client";

import { useState } from "react";
import { feedbackDeliveryOutcome } from "@/lib/feedback-delivery";

/**
 * Segnalazione tecnica pubblica, intenzionalmente separata dai contatti via
 * email sopra il modulo. Non raccoglie un'identità e non manda allegati: una
 * persona deve poter dire che qualcosa è rotto anche prima di aver creato un
 * account, senza rischiare CV o recapiti.
 */
export interface ContactStrings {
  // Legacy labels retained in the page catalogue while the public contact
  // page offers both mail links and the anonymous technical-report flow.
  kind_label: string;
  kind_support: string;
  kind_question: string;
  kind_partnership: string;
  kind_privacy: string;
  name: string;
  name_ph: string;
  email: string;
  email_ph: string;
  subject: string;
  subject_ph: string;
  report_intro: string;
  message: string;
  message_ph: string;
  data_title: string;
  data_body: string;
  data_page: string;
  data_language: string;
  data_client: string;
  send: string;
  sending: string;
  sent_title: string;
  sent_body: string;
  sent_ticket: string;
  sent_again: string;
  error_subject: string;
  error_email: string;
  error_short: string;
  error_send: string;
  error_offline: string;
  error_rate: string;
}

const INPUT =
  "w-full bg-[var(--color-bg)] border border-[var(--color-border)] " +
  "px-3 py-2.5 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-dim)] " +
  "focus:outline-none focus:border-[var(--color-green)] transition-colors";
const LABEL =
  "block text-[10px] font-semibold tracking-[0.15em] uppercase " +
  "text-[var(--color-muted)] mb-2";

export default function ContactForm({
  t,
  locale,
}: {
  t: ContactStrings;
  locale: string;
}) {
  const [message, setMessage] = useState("");
  // Campo trappola: fuori dalla vista e dall'albero accessibile. Non è un
  // dato dell'utente: un valore compilato segnala un bot al server.
  const [website, setWebsite] = useState("");
  const [stato, setStato] = useState<"idle" | "invio" | "ok">("idle");
  const [errore, setErrore] = useState("");
  const [ticket, setTicket] = useState("");

  async function invia(e: React.FormEvent) {
    e.preventDefault();
    setErrore("");
    if (message.trim().length < 10) {
      setErrore(t.error_short);
      return;
    }
    setStato("invio");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: "web-contact",
          kind: "bug",
          happened: message,
          doing: "Public web report: /contact",
          platform: "web",
          locale,
          website,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        ticket?: unknown;
      } | null;
      const outcome = feedbackDeliveryOutcome(res, data?.ticket);
      if (outcome.kind === "offline") {
        setErrore(t.error_offline);
        setStato("idle");
        return;
      }
      if (outcome.kind === "rate-limited") {
        setErrore(t.error_rate);
        setStato("idle");
        return;
      }
      // Nessuna conferma senza riferimento: è la prova leggibile che il
      // server ha consegnato la segnalazione ad almeno un canale di supporto.
      if (outcome.kind === "not-delivered") {
        setErrore(t.error_send);
        setStato("idle");
        return;
      }
      setTicket(outcome.ticket);
      setStato("ok");
    } catch {
      setErrore(t.error_offline);
      setStato("idle");
    }
  }

  if (stato === "ok") {
    return (
      <div className="border border-[var(--color-green)] p-8 text-center">
        <p className="text-lg font-semibold mb-2">{t.sent_title}</p>
        <p className="text-sm text-[var(--color-muted)] mb-4">{t.sent_body}</p>
        <p className="text-xs text-[var(--color-dim)] mb-6 font-mono">
          {t.sent_ticket.replace("%s", ticket)}
        </p>
        <button
          type="button"
          onClick={() => {
            setStato("idle");
            setMessage("");
            setTicket("");
          }}
          className="text-xs underline text-[var(--color-muted)] hover:text-[var(--color-fg)]"
        >
          {t.sent_again}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={invia} className="space-y-5" noValidate>
      <p className="text-[13px] text-[var(--color-muted)] leading-relaxed">
        {t.report_intro}
      </p>

      <div>
        <label className={LABEL} htmlFor="c-msg">
          {t.message}
        </label>
        <textarea
          id="c-msg"
          className={`${INPUT} min-h-[160px] resize-y`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t.message_ph}
          maxLength={4000}
          required
        />
      </div>

      <section
        aria-label={t.data_title}
        className="border border-[var(--color-border)] p-3 text-[11px] text-[var(--color-dim)] space-y-2"
      >
        <p className="font-semibold text-[var(--color-muted)]">
          {t.data_title}
        </p>
        <p>{t.data_body}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt>{t.data_client}</dt>
          <dd className="text-[var(--color-muted)]">web-contact</dd>
          <dt>{t.data_page}</dt>
          <dd className="text-[var(--color-muted)]">/contact</dd>
          <dt>{t.data_language}</dt>
          <dd className="text-[var(--color-muted)]">{locale}</dd>
        </dl>
      </section>

      {/* Trappola anti-bot: non richiede né raccoglie informazioni umane. */}
      <div aria-hidden="true" className="absolute left-[-9999px] opacity-0">
        <label htmlFor="c-website">Website</label>
        <input
          id="c-website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      {errore && (
        <p role="alert" className="text-xs text-[#f85149]">
          {errore}
        </p>
      )}

      <button
        type="submit"
        disabled={stato === "invio"}
        className="px-6 py-3 text-xs font-semibold tracking-wide uppercase
                   border border-[var(--color-green)] text-[var(--color-green)]
                   hover:bg-[var(--color-green)] hover:text-[var(--color-bg)]
                   disabled:opacity-40 transition-colors"
      >
        {stato === "invio" ? t.sending : t.send}
      </button>
    </form>
  );
}
