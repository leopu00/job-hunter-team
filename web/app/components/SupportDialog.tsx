"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useLocale } from "@/lib/use-locale";
import { useFocusTrap } from "@/app/components/use-focus-trap";
import { feedbackDeliveryOutcome } from "@/lib/feedback-delivery";
import type { Locale } from "@/i18n/config";

/**
 * Segnalazione dall'area privata.
 *
 * Chiede una sola cosa: il racconto. L'identità dell'account non è contesto
 * tecnico, quindi non parte con la segnalazione. La pagina di origine sì, ed è
 * mostrata prima dell'invio perché l'utente deve poter verificare ogni dato.
 *
 * Il dettaglio che fa la differenza in triage è proprio la pagina: "non si
 * vede niente" detto da /positions e detto da /dashboard sono due bug diversi,
 * e l'utente non penserà mai a specificarlo.
 */

type Strings = {
  title: string;
  intro: string;
  message: string;
  message_ph: string;
  data_title: string;
  data_body: string;
  data_page: string;
  data_language: string;
  data_client: string;
  send: string;
  sending: string;
  cancel: string;
  close: string;
  sent_title: string;
  sent_body: string;
  sent_ticket: string;
  error_short: string;
  error_send: string;
  error_offline: string;
  error_rate: string;
};

const T: Record<Locale, Strings> = {
  it: {
    title: "Segnala un problema",
    intro:
      "Raccontaci cosa non funziona: bastano due righe. Puoi inviare senza lasciare dati di contatto.",
    message: "Messaggio",
    message_ph: "Cosa è successo e cosa ti aspettavi",
    data_title: "Dati inviati",
    data_body:
      "Inviamo il testo che scrivi, questa pagina e la lingua dell'interfaccia. Non inviamo email, nome, CV, contatti, file o log.",
    data_page: "Pagina",
    data_language: "Lingua",
    data_client: "Dashboard web",
    send: "Invia",
    sending: "Invio…",
    cancel: "Annulla",
    close: "Chiudi",
    sent_title: "Segnalazione inviata",
    sent_body: "La segnalazione è arrivata al supporto.",
    sent_ticket: "Riferimento: %s",
    error_short: "Il messaggio è troppo corto.",
    error_send: "La segnalazione non è stata inviata. Riprova tra poco.",
    error_offline:
      "Sembri offline: non abbiamo inviato nulla. Ricollegati e riprova.",
    error_rate: "Hai inviato troppe segnalazioni. Riprova fra qualche minuto.",
  },
  en: {
    title: "Report a problem",
    intro:
      "Tell us what is not working — two lines are enough. You can send it without sharing contact details.",
    message: "Message",
    message_ph: "What happened and what you expected",
    data_title: "Data being sent",
    data_body:
      "We send the text you write, this page and the interface language. We do not send your email, name, CV, contacts, files or logs.",
    data_page: "Page",
    data_language: "Language",
    data_client: "Web dashboard",
    send: "Send",
    sending: "Sending…",
    cancel: "Cancel",
    close: "Close",
    sent_title: "Report sent",
    sent_body: "Your report reached support.",
    sent_ticket: "Reference: %s",
    error_short: "The message is too short.",
    error_send: "Your report was not sent. Please try again shortly.",
    error_offline:
      "You appear to be offline: nothing was sent. Reconnect and try again.",
    error_rate: "Too many reports sent. Try again in a few minutes.",
  },
  es: {
    title: "Informar de un problema",
    intro:
      "Cuéntanos qué no funciona: bastan dos líneas. Puedes enviarlo sin dejar datos de contacto.",
    message: "Mensaje",
    message_ph: "Qué ha pasado y qué esperabas",
    data_title: "Datos enviados",
    data_body:
      "Enviamos el texto que escribes, esta página y el idioma de la interfaz. No enviamos tu correo, nombre, CV, contactos, archivos ni registros.",
    data_page: "Página",
    data_language: "Idioma",
    data_client: "Panel web",
    send: "Enviar",
    sending: "Enviando…",
    cancel: "Cancelar",
    close: "Cerrar",
    sent_title: "Informe enviado",
    sent_body: "Tu informe ha llegado al soporte.",
    sent_ticket: "Referencia: %s",
    error_short: "El mensaje es demasiado corto.",
    error_send:
      "El informe no se ha enviado. Inténtalo de nuevo dentro de poco.",
    error_offline:
      "Parece que no tienes conexión: no hemos enviado nada. Vuelve a conectarte e inténtalo de nuevo.",
    error_rate: "Has enviado demasiados informes. Inténtalo en unos minutos.",
  },
  fr: {
    title: "Signaler un problème",
    intro:
      "Dis-nous ce qui ne marche pas : deux lignes suffisent. Tu peux l'envoyer sans donner tes coordonnées.",
    message: "Message",
    message_ph: "Ce qui s'est passé et ce que tu attendais",
    data_title: "Données envoyées",
    data_body:
      "Nous envoyons le texte que tu écris, cette page et la langue de l'interface. Nous n'envoyons ni email, ni nom, ni CV, ni contacts, ni fichiers, ni journaux.",
    data_page: "Page",
    data_language: "Langue",
    data_client: "Tableau de bord web",
    send: "Envoyer",
    sending: "Envoi…",
    cancel: "Annuler",
    close: "Fermer",
    sent_title: "Signalement envoyé",
    sent_body: "Ton signalement est arrivé au support.",
    sent_ticket: "Référence : %s",
    error_short: "Le message est trop court.",
    error_send: "Le signalement n'a pas été envoyé. Réessaie dans un instant.",
    error_offline:
      "Tu sembles hors ligne : rien n'a été envoyé. Reconnecte-toi et réessaie.",
    error_rate: "Trop de signalements envoyés. Réessaie dans quelques minutes.",
  },
  de: {
    title: "Problem melden",
    intro:
      "Sag uns, was nicht funktioniert — zwei Zeilen genügen. Du kannst es ohne Kontaktdaten senden.",
    message: "Nachricht",
    message_ph: "Was passiert ist und was du erwartet hast",
    data_title: "Gesendete Daten",
    data_body:
      "Wir senden deinen Text, diese Seite und die Sprache der Oberfläche. Wir senden keine E-Mail-Adresse, keinen Namen, keinen Lebenslauf, keine Kontakte, Dateien oder Logs.",
    data_page: "Seite",
    data_language: "Sprache",
    data_client: "Web-Dashboard",
    send: "Senden",
    sending: "Wird gesendet…",
    cancel: "Abbrechen",
    close: "Schließen",
    sent_title: "Meldung gesendet",
    sent_body: "Deine Meldung ist beim Support angekommen.",
    sent_ticket: "Referenz: %s",
    error_short: "Die Nachricht ist zu kurz.",
    error_send:
      "Deine Meldung wurde nicht gesendet. Versuch es gleich noch einmal.",
    error_offline:
      "Du scheinst offline zu sein: Es wurde nichts gesendet. Verbinde dich und versuche es erneut.",
    error_rate: "Zu viele Meldungen gesendet. Versuch es in ein paar Minuten.",
  },
  hu: {
    title: "Hiba jelentése",
    intro:
      "Írd meg, mi nem működik — két sor is elég. Elküldheted elérhetőségek megadása nélkül.",
    message: "Üzenet",
    message_ph: "Mi történt és mire számítottál",
    data_title: "Elküldött adatok",
    data_body:
      "Az általad írt szöveget, ezt az oldalt és a felület nyelvét küldjük el. Nem küldünk e-mail-címet, nevet, CV-t, kapcsolatokat, fájlokat vagy naplókat.",
    data_page: "Oldal",
    data_language: "Nyelv",
    data_client: "Webes vezérlőpult",
    send: "Küldés",
    sending: "Küldés…",
    cancel: "Mégse",
    close: "Bezárás",
    sent_title: "Bejelentés elküldve",
    sent_body: "A bejelentésed megérkezett az ügyfélszolgálathoz.",
    sent_ticket: "Hivatkozás: %s",
    error_short: "Az üzenet túl rövid.",
    error_send: "A bejelentés nem lett elküldve. Próbáld újra hamarosan.",
    error_offline:
      "Úgy tűnik, nincs kapcsolatod: semmit nem küldtünk el. Csatlakozz újra, majd próbáld meg ismét.",
    error_rate: "Túl sok bejelentést küldtél. Próbáld pár perc múlva.",
  },
  pt: {
    title: "Comunicar um problema",
    intro:
      "Conta-nos o que não funciona: bastam duas linhas. Podes enviar sem deixar dados de contacto.",
    message: "Mensagem",
    message_ph: "O que aconteceu e o que esperavas",
    data_title: "Dados enviados",
    data_body:
      "Enviamos o texto que escreves, esta página e o idioma da interface. Não enviamos email, nome, CV, contactos, ficheiros ou registos.",
    data_page: "Página",
    data_language: "Idioma",
    data_client: "Painel web",
    send: "Enviar",
    sending: "A enviar…",
    cancel: "Cancelar",
    close: "Fechar",
    sent_title: "Comunicação enviada",
    sent_body: "A tua comunicação chegou ao suporte.",
    sent_ticket: "Referência: %s",
    error_short: "A mensagem é demasiado curta.",
    error_send:
      "A comunicação não foi enviada. Tenta novamente dentro de instantes.",
    error_offline:
      "Parece que estás sem ligação: não enviámos nada. Volta a ligar-te e tenta de novo.",
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

export default function SupportDialog({ onClose }: { onClose: () => void }) {
  const locale = useLocale();
  const t = T[locale];
  const pathname = usePathname();
  const [message, setMessage] = useState("");
  const [stato, setStato] = useState<"idle" | "invio" | "ok">("idle");
  const [errore, setErrore] = useState("");
  const [ticket, setTicket] = useState("");
  const primo = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const currentPage = pathname || "/";

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
    if (message.trim().length < 10) return setErrore(t.error_short);
    setStato("invio");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: "web-dashboard",
          happened: message,
          // La pagina di partenza è il contesto che l'utente non penserebbe
          // mai a scrivere, ed è quello che rende il report riproducibile.
          doing: `Web dashboard: ${currentPage}`,
          platform: "web",
          locale,
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
      // Una risposta 2xx senza riferimento non attesta la consegna: il
      // contratto del canale restituisce il ticket solo dopo almeno un invio.
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
            <p className="text-xs text-[var(--color-dim)] mb-6 font-mono">
              {t.sent_ticket.replace("%s", ticket)}
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
              <label className={LABEL} htmlFor="s-msg">
                {t.message}
              </label>
              <textarea
                id="s-msg"
                ref={primo}
                className={`${INPUT} min-h-[130px] resize-y`}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t.message_ph}
                maxLength={4000}
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
                <dd className="text-[var(--color-muted)]">web-dashboard</dd>
                <dt>{t.data_page}</dt>
                <dd className="text-[var(--color-muted)]">{currentPage}</dd>
                <dt>{t.data_language}</dt>
                <dd className="text-[var(--color-muted)]">{locale}</dd>
              </dl>
            </section>

            {errore && (
              <p role="alert" className="text-[11px] text-[var(--color-red)]">
                {errore}
              </p>
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
