"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useLocale } from "@/lib/use-locale";
import { useFocusTrap } from "@/app/components/use-focus-trap";
import type { Locale } from "@/i18n/config";

/**
 * Segnalazione dall'area privata.
 *
 * Rispetto al modulo pubblico chiede molto meno, perché molto lo sappiamo già:
 * chi scrive è autenticato, quindi l'indirizzo non va chiesto, e la pagina da
 * cui parte la segnalazione la leggiamo da sola. Restano oggetto e messaggio.
 *
 * Il dettaglio che fa la differenza in triage è proprio la pagina: "non si
 * vede niente" detto da /positions e detto da /dashboard sono due bug diversi,
 * e l'utente non penserà mai a specificarlo.
 */

type Strings = {
  title: string;
  intro: string;
  subject: string;
  subject_ph: string;
  message: string;
  message_ph: string;
  page_note: string;
  send: string;
  sending: string;
  cancel: string;
  close: string;
  sent_title: string;
  sent_body: string;
  error_subject: string;
  error_short: string;
  error_send: string;
  error_rate: string;
};

const T: Record<Locale, Strings> = {
  it: {
    title: "Segnala un problema",
    intro:
      "Raccontaci cosa non funziona: bastano due righe. Ti rispondiamo alla tua email.",
    subject: "Oggetto",
    subject_ph: "Di cosa si tratta",
    message: "Messaggio",
    message_ph: "Cosa è successo e cosa ti aspettavi",
    page_note: "Alleghiamo la pagina da cui scrivi:",
    send: "Invia",
    sending: "Invio…",
    cancel: "Annulla",
    close: "Chiudi",
    sent_title: "Segnalazione inviata",
    sent_body: "Grazie. Ti rispondiamo alla tua email.",
    error_subject: "Aggiungi un oggetto.",
    error_short: "Il messaggio è troppo corto.",
    error_send:
      "Invio non riuscito. Riprova o scrivi a support@jobhunterteam.ai.",
    error_rate: "Hai inviato troppe segnalazioni. Riprova fra qualche minuto.",
  },
  en: {
    title: "Report a problem",
    intro:
      "Tell us what is not working — two lines are enough. We'll reply to your email.",
    subject: "Subject",
    subject_ph: "What is it about",
    message: "Message",
    message_ph: "What happened and what you expected",
    page_note: "We attach the page you are writing from:",
    send: "Send",
    sending: "Sending…",
    cancel: "Cancel",
    close: "Close",
    sent_title: "Report sent",
    sent_body: "Thank you. We'll reply to your email.",
    error_subject: "Add a subject.",
    error_short: "The message is too short.",
    error_send:
      "Sending failed. Try again or write to support@jobhunterteam.ai.",
    error_rate: "Too many reports sent. Try again in a few minutes.",
  },
  es: {
    title: "Informar de un problema",
    intro:
      "Cuéntanos qué no funciona: bastan dos líneas. Te respondemos a tu email.",
    subject: "Asunto",
    subject_ph: "De qué se trata",
    message: "Mensaje",
    message_ph: "Qué ha pasado y qué esperabas",
    page_note: "Adjuntamos la página desde la que escribes:",
    send: "Enviar",
    sending: "Enviando…",
    cancel: "Cancelar",
    close: "Cerrar",
    sent_title: "Informe enviado",
    sent_body: "Gracias. Te respondemos a tu email.",
    error_subject: "Añade un asunto.",
    error_short: "El mensaje es demasiado corto.",
    error_send:
      "Error al enviar. Inténtalo o escribe a support@jobhunterteam.ai.",
    error_rate: "Has enviado demasiados informes. Inténtalo en unos minutos.",
  },
  fr: {
    title: "Signaler un problème",
    intro:
      "Dis-nous ce qui ne marche pas : deux lignes suffisent. Nous répondons à ton email.",
    subject: "Objet",
    subject_ph: "De quoi s'agit-il",
    message: "Message",
    message_ph: "Ce qui s'est passé et ce que tu attendais",
    page_note: "Nous joignons la page depuis laquelle tu écris :",
    send: "Envoyer",
    sending: "Envoi…",
    cancel: "Annuler",
    close: "Fermer",
    sent_title: "Signalement envoyé",
    sent_body: "Merci. Nous répondons à ton email.",
    error_subject: "Ajoute un objet.",
    error_short: "Le message est trop court.",
    error_send:
      "Échec de l'envoi. Réessaie ou écris à support@jobhunterteam.ai.",
    error_rate: "Trop de signalements envoyés. Réessaie dans quelques minutes.",
  },
  de: {
    title: "Problem melden",
    intro:
      "Sag uns, was nicht funktioniert — zwei Zeilen genügen. Wir antworten an deine E-Mail.",
    subject: "Betreff",
    subject_ph: "Worum geht es",
    message: "Nachricht",
    message_ph: "Was passiert ist und was du erwartet hast",
    page_note: "Wir hängen die Seite an, von der du schreibst:",
    send: "Senden",
    sending: "Wird gesendet…",
    cancel: "Abbrechen",
    close: "Schließen",
    sent_title: "Meldung gesendet",
    sent_body: "Danke. Wir antworten an deine E-Mail.",
    error_subject: "Bitte einen Betreff angeben.",
    error_short: "Die Nachricht ist zu kurz.",
    error_send:
      "Senden fehlgeschlagen. Versuch es erneut oder schreib an support@jobhunterteam.ai.",
    error_rate: "Zu viele Meldungen gesendet. Versuch es in ein paar Minuten.",
  },
  hu: {
    title: "Hiba jelentése",
    intro:
      "Írd meg, mi nem működik — két sor is elég. Az e-mail címedre válaszolunk.",
    subject: "Tárgy",
    subject_ph: "Miről van szó",
    message: "Üzenet",
    message_ph: "Mi történt és mire számítottál",
    page_note: "Csatoljuk az oldalt, ahonnan írsz:",
    send: "Küldés",
    sending: "Küldés…",
    cancel: "Mégse",
    close: "Bezárás",
    sent_title: "Bejelentés elküldve",
    sent_body: "Köszönjük. Az e-mail címedre válaszolunk.",
    error_subject: "Adj meg egy tárgyat.",
    error_short: "Az üzenet túl rövid.",
    error_send:
      "A küldés nem sikerült. Próbáld újra, vagy írj a support@jobhunterteam.ai címre.",
    error_rate: "Túl sok bejelentést küldtél. Próbáld pár perc múlva.",
  },
  pt: {
    title: "Comunicar um problema",
    intro:
      "Conta-nos o que não funciona: bastam duas linhas. Respondemos ao teu email.",
    subject: "Assunto",
    subject_ph: "Sobre o que é",
    message: "Mensagem",
    message_ph: "O que aconteceu e o que esperavas",
    page_note: "Anexamos a página de onde escreves:",
    send: "Enviar",
    sending: "A enviar…",
    cancel: "Cancelar",
    close: "Fechar",
    sent_title: "Comunicação enviada",
    sent_body: "Obrigado. Respondemos ao teu email.",
    error_subject: "Adiciona um assunto.",
    error_short: "A mensagem é demasiado curta.",
    error_send:
      "Falha no envio. Tenta de novo ou escreve para support@jobhunterteam.ai.",
    error_rate:
      "Enviaste demasiadas comunicações. Tenta daqui a alguns minutos.",
  },
};

const INPUT =
  "w-full bg-[var(--color-bg)] border border-[var(--color-border)] px-3 py-2.5 " +
  "text-sm text-[var(--color-bright)] placeholder:text-[var(--color-dim)] " +
  "focus:outline-none focus:border-[var(--color-green)] transition-colors";
const LABEL =
  "block text-[10px] font-semibold tracking-[0.15em] uppercase " +
  "text-[var(--color-muted)] mb-2";

export default function SupportDialog({
  email,
  onClose,
}: {
  email: string;
  onClose: () => void;
}) {
  const t = T[useLocale()];
  const pathname = usePathname();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [stato, setStato] = useState<"idle" | "invio" | "ok">("idle");
  const [errore, setErrore] = useState("");
  const primo = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Il trap gira prima dell'effetto sotto, che riporta il focus sul primo
  // campo: l'ordine degli effetti decide chi vince, e deve vincere il campo.
  useFocusTrap(dialogRef, true);

  useEffect(() => {
    primo.current?.focus();
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  async function invia(e: React.FormEvent) {
    e.preventDefault();
    setErrore("");
    if (subject.trim().length < 3) return setErrore(t.error_subject);
    if (message.trim().length < 10) return setErrore(t.error_short);
    setStato("invio");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: "web-dashboard",
          subject,
          happened: message,
          // La pagina di partenza è il contesto che l'utente non penserebbe
          // mai a scrivere, ed è quello che rende il report riproducibile.
          doing: `Dalla dashboard, pagina ${pathname}`,
          contact: email,
          platform: "web",
          locale: navigator.language?.slice(0, 2) || "it",
        }),
      });
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
      setStato("ok");
    } catch {
      setErrore(t.error_send);
      setStato("idle");
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t.title}
        className="w-full max-w-lg"
        style={{
          background: "var(--color-panel)",
          border: "1px solid var(--color-border)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
          animation: "fade-in 0.18s ease both",
        }}
      >
        <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--color-bright)]">
            {t.title}
          </h2>
          <button
            onClick={onClose}
            aria-label={t.close}
            className="text-[var(--color-dim)] hover:text-[var(--color-bright)] transition-colors cursor-pointer text-lg leading-none"
          >
            ×
          </button>
        </div>

        {stato === "ok" ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm font-semibold text-[var(--color-green)] mb-2">
              {t.sent_title}
            </p>
            <p className="text-[12px] text-[var(--color-muted)] mb-6">
              {t.sent_body}
            </p>
            <button
              onClick={onClose}
              className="px-5 py-2 text-[11px] font-semibold tracking-wide uppercase border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)] transition-colors cursor-pointer"
            >
              {t.close}
            </button>
          </div>
        ) : (
          <form onSubmit={invia} className="px-6 py-5 space-y-4" noValidate>
            <p className="text-[12px] text-[var(--color-muted)] leading-relaxed">
              {t.intro}
            </p>

            <div>
              <label className={LABEL} htmlFor="s-oggetto">
                {t.subject}
              </label>
              <input
                id="s-oggetto"
                ref={primo}
                className={INPUT}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={t.subject_ph}
                maxLength={120}
              />
            </div>

            <div>
              <label className={LABEL} htmlFor="s-msg">
                {t.message}
              </label>
              <textarea
                id="s-msg"
                className={`${INPUT} min-h-[130px] resize-y`}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t.message_ph}
                maxLength={4000}
              />
            </div>

            {/* Mostrato, non nascosto: quello che alleghiamo l'utente deve
                poterlo leggere prima di premere invia. */}
            <p className="text-[11px] text-[var(--color-dim)]">
              {t.page_note}{" "}
              <span className="text-[var(--color-muted)]">{pathname}</span>
              {" · "}
              <span className="text-[var(--color-muted)]">{email}</span>
            </p>

            {errore && (
              <p className="text-[11px] text-[var(--color-red)]">{errore}</p>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={stato === "invio"}
                className="px-5 py-2.5 text-[11px] font-semibold tracking-wide uppercase border border-[var(--color-green)] text-[var(--color-green)] hover:bg-[var(--color-green)] hover:text-[var(--color-bg)] disabled:opacity-40 transition-colors cursor-pointer"
              >
                {stato === "invio" ? t.sending : t.send}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="text-[11px] text-[var(--color-dim)] hover:text-[var(--color-muted)] transition-colors cursor-pointer"
              >
                {t.cancel}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
