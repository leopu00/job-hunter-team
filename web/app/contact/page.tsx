"use client";

import Link from "next/link";
import {
  LandingI18nProvider,
  useLandingI18n,
} from "../components/landing/LandingI18n";
import LandingNav from "../components/landing/LandingNav";
import { LandingFooter } from "../components/landing/LandingCTA";
import ScrollToTop from "../components/landing/ScrollToTop";
import ContactForm, { type ContactStrings } from "./ContactForm";

/**
 * Pagina di contatto pubblica.
 *
 * Categoria e oggetto fanno due lavori diversi e stanno bene insieme: la
 * categoria smista (un click, e in casella diventa un filtro), l'oggetto
 * descrive. Entrambi finiscono nell'intestazione della mail che riceviamo.
 */

type Testi = ContactStrings & {
  title: string;
  intro: string;
  intro_app: string;
  privacy_note: string;
};

const T: Record<string, Testi> = {
  it: {
    title: "Contatti",
    intro:
      "Per domande, problemi o proposte scrivi a {MAIL} o usa il modulo qui sotto. Per le segnalazioni di sicurezza: {SEC}.",
    intro_app:
      "Hai già installato JHT? Per i problemi tecnici usa «Segnala un problema» dentro l'app: allega in automatico una diagnostica anonimizzata.",
    privacy_note:
      "Usiamo il tuo indirizzo solo per rispondere a questo messaggio.",
    kind_label: "Argomento",
    kind_support: "Supporto tecnico",
    kind_question: "Domanda generale",
    kind_partnership: "Collaborazioni",
    kind_privacy: "Privacy e dati",
    name: "Nome",
    name_ph: "Il tuo nome",
    email: "Email",
    email_ph: "nome@esempio.it",
    subject: "Oggetto",
    subject_ph: "Di cosa vuoi parlarci",
    message: "Messaggio",
    message_ph: "Scrivi qui il tuo messaggio",
    send: "Invia",
    sending: "Invio…",
    sent_title: "Messaggio inviato",
    sent_body: "Ti risponderemo all'indirizzo che hai indicato.",
    sent_again: "Scrivi un altro messaggio",
    error_subject: "Aggiungi un oggetto.",
    error_short: "Il messaggio è troppo corto.",
    error_email: "Indirizzo email non valido.",
    error_send:
      "Invio non riuscito. Riprova o scrivi a support@jobhunterteam.ai.",
    error_rate: "Hai inviato troppi messaggi. Riprova fra qualche minuto.",
  },
  en: {
    title: "Contact",
    intro:
      "For questions, issues or proposals write to {MAIL} or use the form below. For security reports: {SEC}.",
    intro_app:
      "Already using JHT? For technical issues use «Report a problem» inside the app: it automatically attaches an anonymised diagnostic.",
    privacy_note: "We use your address only to reply to this message.",
    kind_label: "Topic",
    kind_support: "Technical support",
    kind_question: "General question",
    kind_partnership: "Partnerships",
    kind_privacy: "Privacy & data",
    name: "Name",
    name_ph: "Your name",
    email: "Email",
    email_ph: "name@example.com",
    subject: "Subject",
    subject_ph: "What is it about",
    message: "Message",
    message_ph: "Write your message here",
    send: "Send",
    sending: "Sending…",
    sent_title: "Message sent",
    sent_body: "We'll reply to the address you provided.",
    sent_again: "Write another message",
    error_subject: "Add a subject.",
    error_short: "The message is too short.",
    error_email: "Invalid email address.",
    error_send:
      "Sending failed. Try again or write to support@jobhunterteam.ai.",
    error_rate: "Too many messages sent. Try again in a few minutes.",
  },
  es: {
    title: "Contacto",
    intro:
      "Para dudas, problemas o propuestas escribe a {MAIL} o usa el formulario. Para avisos de seguridad: {SEC}.",
    intro_app:
      "¿Ya usas JHT? Para problemas técnicos usa «Informar de un problema» dentro de la app: adjunta automáticamente un diagnóstico anonimizado.",
    privacy_note: "Usamos tu dirección solo para responder a este mensaje.",
    kind_label: "Asunto",
    kind_support: "Soporte técnico",
    kind_question: "Consulta general",
    kind_partnership: "Colaboraciones",
    kind_privacy: "Privacidad y datos",
    name: "Nombre",
    name_ph: "Tu nombre",
    email: "Email",
    email_ph: "nombre@ejemplo.com",
    subject: "Asunto",
    subject_ph: "De qué quieres hablarnos",
    message: "Mensaje",
    message_ph: "Escribe aquí tu mensaje",
    send: "Enviar",
    sending: "Enviando…",
    sent_title: "Mensaje enviado",
    sent_body: "Te responderemos a la dirección indicada.",
    sent_again: "Escribir otro mensaje",
    error_subject: "Añade un asunto.",
    error_short: "El mensaje es demasiado corto.",
    error_email: "Dirección de correo no válida.",
    error_send:
      "Error al enviar. Inténtalo o escribe a support@jobhunterteam.ai.",
    error_rate: "Has enviado demasiados mensajes. Inténtalo en unos minutos.",
  },
  fr: {
    title: "Contact",
    intro:
      "Pour toute question, problème ou proposition, écris à {MAIL} ou utilise le formulaire. Pour les signalements de sécurité : {SEC}.",
    intro_app:
      "Tu utilises déjà JHT ? Pour les problèmes techniques, utilise « Signaler un problème » dans l'app : elle joint automatiquement un diagnostic anonymisé.",
    privacy_note:
      "Nous utilisons ton adresse uniquement pour répondre à ce message.",
    kind_label: "Sujet",
    kind_support: "Support technique",
    kind_question: "Question générale",
    kind_partnership: "Partenariats",
    kind_privacy: "Confidentialité",
    name: "Nom",
    name_ph: "Ton nom",
    email: "Email",
    email_ph: "nom@exemple.com",
    subject: "Objet",
    subject_ph: "De quoi veux-tu nous parler",
    message: "Message",
    message_ph: "Écris ton message ici",
    send: "Envoyer",
    sending: "Envoi…",
    sent_title: "Message envoyé",
    sent_body: "Nous répondrons à l'adresse indiquée.",
    sent_again: "Écrire un autre message",
    error_subject: "Ajoute un objet.",
    error_short: "Le message est trop court.",
    error_email: "Adresse email invalide.",
    error_send:
      "Échec de l'envoi. Réessaie ou écris à support@jobhunterteam.ai.",
    error_rate: "Trop de messages envoyés. Réessaie dans quelques minutes.",
  },
  de: {
    title: "Kontakt",
    intro:
      "Bei Fragen, Problemen oder Vorschlägen schreib an {MAIL} oder nutze das Formular. Für Sicherheitsmeldungen: {SEC}.",
    intro_app:
      "Du nutzt JHT bereits? Für technische Probleme nimm «Problem melden» in der App: sie hängt automatisch eine anonymisierte Diagnose an.",
    privacy_note:
      "Wir verwenden deine Adresse nur für die Antwort auf diese Nachricht.",
    kind_label: "Thema",
    kind_support: "Technischer Support",
    kind_question: "Allgemeine Frage",
    kind_partnership: "Kooperationen",
    kind_privacy: "Datenschutz",
    name: "Name",
    name_ph: "Dein Name",
    email: "E-Mail",
    email_ph: "name@beispiel.de",
    subject: "Betreff",
    subject_ph: "Worum geht es",
    message: "Nachricht",
    message_ph: "Schreib hier deine Nachricht",
    send: "Senden",
    sending: "Wird gesendet…",
    sent_title: "Nachricht gesendet",
    sent_body: "Wir antworten an die angegebene Adresse.",
    sent_again: "Weitere Nachricht schreiben",
    error_subject: "Bitte einen Betreff angeben.",
    error_short: "Die Nachricht ist zu kurz.",
    error_email: "Ungültige E-Mail-Adresse.",
    error_send:
      "Senden fehlgeschlagen. Versuch es erneut oder schreib an support@jobhunterteam.ai.",
    error_rate:
      "Zu viele Nachrichten gesendet. Versuch es in ein paar Minuten.",
  },
  pt: {
    title: "Contacto",
    intro:
      "Para dúvidas, problemas ou propostas escreve para {MAIL} ou usa o formulário. Para comunicações de segurança: {SEC}.",
    intro_app:
      "Já usas o JHT? Para problemas técnicos usa «Comunicar um problema» dentro da app: anexa automaticamente um diagnóstico anonimizado.",
    privacy_note:
      "Usamos o teu endereço apenas para responder a esta mensagem.",
    kind_label: "Assunto",
    kind_support: "Suporte técnico",
    kind_question: "Questão geral",
    kind_partnership: "Parcerias",
    kind_privacy: "Privacidade e dados",
    name: "Nome",
    name_ph: "O teu nome",
    email: "Email",
    email_ph: "nome@exemplo.com",
    subject: "Assunto",
    subject_ph: "Sobre o que nos queres falar",
    message: "Mensagem",
    message_ph: "Escreve aqui a tua mensagem",
    send: "Enviar",
    sending: "A enviar…",
    sent_title: "Mensagem enviada",
    sent_body: "Responderemos ao endereço indicado.",
    sent_again: "Escrever outra mensagem",
    error_subject: "Adiciona um assunto.",
    error_short: "A mensagem é demasiado curta.",
    error_email: "Endereço de email inválido.",
    error_send:
      "Falha no envio. Tenta de novo ou escreve para support@jobhunterteam.ai.",
    error_rate: "Enviaste demasiadas mensagens. Tenta daqui a alguns minutos.",
  },
  hu: {
    title: "Kapcsolat",
    intro:
      "Kérdés, probléma vagy javaslat esetén írj a {MAIL} címre, vagy használd az űrlapot. Biztonsági bejelentés: {SEC}.",
    intro_app:
      "Már használod a JHT-t? Technikai problémához használd az app «Hiba jelentése» gombját: automatikusan csatol egy anonimizált diagnosztikát.",
    privacy_note:
      "A címedet kizárólag erre az üzenetre adott válaszhoz használjuk.",
    kind_label: "Téma",
    kind_support: "Technikai támogatás",
    kind_question: "Általános kérdés",
    kind_partnership: "Együttműködés",
    kind_privacy: "Adatvédelem",
    name: "Név",
    name_ph: "A neved",
    email: "E-mail",
    email_ph: "nev@pelda.hu",
    subject: "Tárgy",
    subject_ph: "Miről szeretnél írni",
    message: "Üzenet",
    message_ph: "Írd ide az üzeneted",
    send: "Küldés",
    sending: "Küldés…",
    sent_title: "Üzenet elküldve",
    sent_body: "A megadott címre válaszolunk.",
    sent_again: "Új üzenet írása",
    error_subject: "Adj meg egy tárgyat.",
    error_short: "Az üzenet túl rövid.",
    error_email: "Érvénytelen e-mail cím.",
    error_send:
      "A küldés nem sikerült. Próbáld újra, vagy írj a support@jobhunterteam.ai címre.",
    error_rate: "Túl sok üzenetet küldtél. Próbáld pár perc múlva.",
  },
};

const SUPPORT = "support@jobhunterteam.ai";
const SECURITY = "security@jobhunterteam.ai";

/** Rende cliccabili i due indirizzi dentro il testo: chi preferisce il proprio
 *  client di posta al modulo non deve copiarli a mano. */
function conIndirizzi(testo: string) {
  return testo.split(/(\{MAIL\}|\{SEC\})/).map((pezzo, i) => {
    const indirizzo =
      pezzo === "{MAIL}" ? SUPPORT : pezzo === "{SEC}" ? SECURITY : null;
    if (!indirizzo) return <span key={i}>{pezzo}</span>;
    return (
      <a
        key={i}
        href={`mailto:${indirizzo}`}
        className="text-[var(--color-green)] underline underline-offset-2"
      >
        {indirizzo}
      </a>
    );
  });
}

function ContactContent() {
  const { lang } = useLandingI18n();
  const tx = T[lang] ?? T.en;

  return (
    <main
      style={{
        position: "relative",
        zIndex: 1,
        animation: "fade-in 0.35s ease both",
      }}
    >
      <LandingNav />
      <div className="max-w-3xl mx-auto px-5 pt-32 pb-20">
        <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2 mb-3">
            <Link
              href="/"
              className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
            >
              Home
            </Link>
            <span className="text-[var(--color-border)]">/</span>
            <span className="text-[10px] text-[var(--color-muted)]">
              {tx.title}
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
            {tx.title}
          </h1>
        </div>

        <p className="text-[13px] text-[var(--color-muted)] leading-relaxed mb-3">
          {conIndirizzi(tx.intro)}
        </p>
        <p className="text-[12px] text-[var(--color-dim)] leading-relaxed mb-10">
          {tx.intro_app}
        </p>

        <ContactForm t={tx} locale={lang} />

        <p className="mt-6 text-[11px] text-[var(--color-dim)]">
          {tx.privacy_note}{" "}
          <Link
            href="/privacy"
            className="underline hover:text-[var(--color-muted)]"
          >
            Privacy
          </Link>
        </p>
      </div>
      <LandingFooter />
      <ScrollToTop />
    </main>
  );
}

export default function ContactPage() {
  return (
    <LandingI18nProvider>
      <ContactContent />
    </LandingI18nProvider>
  );
}
