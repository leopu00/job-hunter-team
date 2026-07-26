"use client";

import { useState } from "react";

/**
 * Modulo di contatto pubblico.
 *
 * Parla con `/api/feedback`, lo stesso endpoint del pulsante "Segnala un
 * problema" dell'app desktop: una sola porta, una sola casella, un solo posto
 * dove le cose non si perdono.
 *
 * Differenza importante rispetto all'app: da qui NON arriva nessuna
 * diagnostica — il browser non vede i log del container. Per questo, a chi
 * segnala un bug avendo già l'app installata, la pagina suggerisce il pulsante
 * in-app: là il report arriva con dentro la fotografia della macchina, qui no.
 */

export interface ContactStrings {
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
  message: string;
  message_ph: string;
  send: string;
  sending: string;
  sent_title: string;
  sent_body: string;
  sent_again: string;
  error_subject: string;
  error_short: string;
  error_email: string;
  error_send: string;
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
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [kind, setKind] = useState("supporto");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  // Campo trappola: invisibile a un umano, irresistibile per un bot.
  const [website, setWebsite] = useState("");
  const [stato, setStato] = useState<"idle" | "invio" | "ok">("idle");
  const [errore, setErrore] = useState("");
  const [ticket, setTicket] = useState("");

  async function invia(e: React.FormEvent) {
    e.preventDefault();
    setErrore("");
    if (subject.trim().length < 3) {
      setErrore(t.error_subject);
      return;
    }
    if (message.trim().length < 10) {
      setErrore(t.error_short);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErrore(t.error_email);
      return;
    }
    setStato("invio");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: "web-contact",
          kind,
          subject,
          locale,
          platform: "web",
          // Il messaggio dell'utente va nel campo che l'endpoint considera
          // obbligatorio: è il racconto, qualunque forma abbia.
          happened: message,
          doing: name ? `Modulo di contatto — ${name}` : "Modulo di contatto",
          contact: email,
          website,
        }),
      });
      const dati = await res.json().catch(() => ({}));
      if (res.status === 429) {
        setErrore(t.error_rate);
        setStato("idle");
        return;
      }
      if (!res.ok) {
        setErrore(t.error_send);
        setStato("idle");
        return;
      }
      setTicket(String(dati.ticket || ""));
      setStato("ok");
    } catch {
      setErrore(t.error_send);
      setStato("idle");
    }
  }

  if (stato === "ok") {
    return (
      <div className="border border-[var(--color-green)] p-8 text-center">
        <p className="text-lg font-semibold mb-2">{t.sent_title}</p>
        <p className="text-sm text-[var(--color-muted)] mb-4">{t.sent_body}</p>
        {ticket && (
          <p className="text-xs text-[var(--color-dim)] mb-6 font-mono">
            {ticket}
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setStato("idle");
            setSubject("");
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
      <fieldset>
        <legend className={LABEL}>{t.kind_label}</legend>
        <div className="flex gap-2 flex-wrap">
          {[
            // Gli id restano in italiano: finiscono nell'oggetto della mail
            // che leggiamo noi, non nella pagina che legge chi scrive.
            { id: "supporto", testo: t.kind_support },
            { id: "domanda", testo: t.kind_question },
            { id: "collaborazione", testo: t.kind_partnership },
            { id: "privacy", testo: t.kind_privacy },
          ].map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setKind(o.id)}
              aria-pressed={kind === o.id}
              className={`px-4 py-2 text-[11px] tracking-wide border transition-colors ${
                kind === o.id
                  ? "border-[var(--color-green)] text-[var(--color-green)]"
                  : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)]"
              }`}
            >
              {o.testo}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className={LABEL} htmlFor="c-nome">
            {t.name}
          </label>
          <input
            id="c-nome"
            className={INPUT}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.name_ph}
            maxLength={80}
            autoComplete="name"
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="c-email">
            {t.email}
          </label>
          <input
            id="c-email"
            type="email"
            className={INPUT}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t.email_ph}
            maxLength={180}
            autoComplete="email"
            required
          />
        </div>
      </div>
      <div>
        <label className={LABEL} htmlFor="c-oggetto">
          {t.subject}
        </label>
        <input
          id="c-oggetto"
          className={INPUT}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={t.subject_ph}
          maxLength={120}
          required
        />
      </div>

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

      {/* Trappola anti-bot: fuori dallo schermo e invisibile agli screen
          reader, così nessun umano può compilarla per sbaglio. */}
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

      {errore && <p className="text-xs text-[#f85149]">{errore}</p>}

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
