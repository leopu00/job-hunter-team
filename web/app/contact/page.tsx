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
 * Le conversazioni che hanno bisogno di risposta restano sui link mailto.
 * Il modulo è invece un report tecnico anonimo: deve funzionare anche quando
 * un utente non può o non vuole lasciare dati personali.
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
      "Per domande o proposte scrivi a {MAIL}. Per le segnalazioni di sicurezza: {SEC}.",
    intro_app:
      "Hai già installato JHT? Per i problemi tecnici usa «Segnala un problema» dentro l'app: allega in automatico una diagnostica anonimizzata.",
    privacy_note:
      "L'email è facoltativa: senza, il report resta anonimo; se la inserisci, viene usata solo per risponderti.",
    kind_label: "Argomento",
    kind_support: "Supporto tecnico",
    kind_question: "Domanda generale",
    kind_partnership: "Collaborazioni",
    kind_privacy: "Privacy e dati",
    name: "Nome",
    name_ph: "Il tuo nome",
    email: "Email (facoltativa)",
    email_ph: "nome@esempio.it",
    subject: "Oggetto",
    subject_ph: "Di cosa vuoi parlarci",
    report_intro:
      "Hai trovato un bug o un malfunzionamento? Descrivilo qui. Lascia l'email solo se vuoi ricevere una risposta.",
    message: "Messaggio",
    message_ph: "Cosa è successo e cosa ti aspettavi",
    data_title: "Dati inviati",
    data_body:
      "Inviamo il testo che scrivi, questa pagina, la lingua dell'interfaccia e, se la inserisci, l'email soltanto come indirizzo di risposta. Non inviamo nome, CV, altri contatti, file o log.",
    data_page: "Pagina",
    data_language: "Lingua",
    data_client: "Sito web",
    send: "Invia",
    sending: "Invio…",
    sent_title: "Segnalazione inviata",
    sent_body: "La segnalazione è arrivata al supporto.",
    sent_ticket: "Riferimento: %s",
    sent_again: "Invia un'altra segnalazione",
    error_subject: "Aggiungi un oggetto.",
    error_short: "Il messaggio è troppo corto.",
    error_email: "Indirizzo email non valido.",
    error_send: "La segnalazione non è stata inviata. Riprova tra poco.",
    error_offline:
      "Sembri offline: non abbiamo inviato nulla. Ricollegati e riprova.",
    error_rate: "Hai inviato troppe segnalazioni. Riprova fra qualche minuto.",
  },
  en: {
    title: "Contact",
    intro:
      "For questions or proposals, write to {MAIL}. For security reports: {SEC}.",
    intro_app:
      "Already using JHT? For technical issues use «Report a problem» inside the app: it automatically attaches an anonymised diagnostic.",
    privacy_note:
      "Email is optional: without it, the report stays anonymous; if you enter it, we use it only to reply to you.",
    kind_label: "Topic",
    kind_support: "Technical support",
    kind_question: "General question",
    kind_partnership: "Partnerships",
    kind_privacy: "Privacy & data",
    name: "Name",
    name_ph: "Your name",
    email: "Email (optional)",
    email_ph: "name@example.com",
    subject: "Subject",
    subject_ph: "What is it about",
    report_intro:
      "Found a bug or something not working? Describe it here. Add your email only if you want a reply.",
    message: "Message",
    message_ph: "What happened and what you expected",
    data_title: "Data being sent",
    data_body:
      "We send the text you write, this page, the interface language and, if entered, your email only as a reply address. We do not send your name, CV, other contacts, files or logs.",
    data_page: "Page",
    data_language: "Language",
    data_client: "Website",
    send: "Send",
    sending: "Sending…",
    sent_title: "Report sent",
    sent_body: "Your report reached support.",
    sent_ticket: "Reference: %s",
    sent_again: "Send another report",
    error_subject: "Add a subject.",
    error_short: "The message is too short.",
    error_email: "Invalid email address.",
    error_send: "Your report was not sent. Please try again shortly.",
    error_offline:
      "You appear to be offline: nothing was sent. Reconnect and try again.",
    error_rate: "Too many reports sent. Try again in a few minutes.",
  },
  es: {
    title: "Contacto",
    intro:
      "Para dudas o propuestas escribe a {MAIL}. Para avisos de seguridad: {SEC}.",
    intro_app:
      "¿Ya usas JHT? Para problemas técnicos usa «Informar de un problema» dentro de la app: adjunta automáticamente un diagnóstico anonimizado.",
    privacy_note:
      "El correo es opcional: sin él, el informe sigue siendo anónimo; si lo indicas, solo lo usamos para responderte.",
    kind_label: "Asunto",
    kind_support: "Soporte técnico",
    kind_question: "Consulta general",
    kind_partnership: "Colaboraciones",
    kind_privacy: "Privacidad y datos",
    name: "Nombre",
    name_ph: "Tu nombre",
    email: "Correo (opcional)",
    email_ph: "nombre@ejemplo.com",
    subject: "Asunto",
    subject_ph: "De qué quieres hablarnos",
    report_intro:
      "¿Has encontrado un error o algo que no funciona? Descríbelo aquí. Indica tu correo solo si quieres recibir una respuesta.",
    message: "Mensaje",
    message_ph: "Qué ha pasado y qué esperabas",
    data_title: "Datos enviados",
    data_body:
      "Enviamos el texto que escribes, esta página, el idioma de la interfaz y, si lo indicas, tu correo solo como dirección de respuesta. No enviamos nombre, CV, otros contactos, archivos ni registros.",
    data_page: "Página",
    data_language: "Idioma",
    data_client: "Sitio web",
    send: "Enviar",
    sending: "Enviando…",
    sent_title: "Informe enviado",
    sent_body: "Tu informe ha llegado al soporte.",
    sent_ticket: "Referencia: %s",
    sent_again: "Enviar otro informe",
    error_subject: "Añade un asunto.",
    error_short: "El mensaje es demasiado corto.",
    error_email: "Dirección de correo no válida.",
    error_send:
      "El informe no se ha enviado. Inténtalo de nuevo dentro de poco.",
    error_offline:
      "Parece que no tienes conexión: no hemos enviado nada. Vuelve a conectarte e inténtalo de nuevo.",
    error_rate: "Has enviado demasiados informes. Inténtalo en unos minutos.",
  },
  fr: {
    title: "Contact",
    intro:
      "Pour toute question ou proposition, écris à {MAIL}. Pour les signalements de sécurité : {SEC}.",
    intro_app:
      "Tu utilises déjà JHT ? Pour les problèmes techniques, utilise « Signaler un problème » dans l'app : elle joint automatiquement un diagnostic anonymisé.",
    privacy_note:
      "L'email est facultatif : sans lui, le signalement reste anonyme ; si tu le saisis, nous l'utilisons uniquement pour te répondre.",
    kind_label: "Sujet",
    kind_support: "Support technique",
    kind_question: "Question générale",
    kind_partnership: "Partenariats",
    kind_privacy: "Confidentialité",
    name: "Nom",
    name_ph: "Ton nom",
    email: "Email (facultatif)",
    email_ph: "nom@exemple.com",
    subject: "Objet",
    subject_ph: "De quoi veux-tu nous parler",
    report_intro:
      "Tu as trouvé un bug ou quelque chose qui ne marche pas ? Décris-le ici. Indique ton email uniquement si tu souhaites une réponse.",
    message: "Message",
    message_ph: "Ce qui s'est passé et ce que tu attendais",
    data_title: "Données envoyées",
    data_body:
      "Nous envoyons le texte que tu écris, cette page, la langue de l'interface et, si tu le saisis, ton email uniquement comme adresse de réponse. Nous n'envoyons ni nom, ni CV, ni autres coordonnées, ni fichiers, ni journaux.",
    data_page: "Page",
    data_language: "Langue",
    data_client: "Site web",
    send: "Envoyer",
    sending: "Envoi…",
    sent_title: "Signalement envoyé",
    sent_body: "Ton signalement est arrivé au support.",
    sent_ticket: "Référence : %s",
    sent_again: "Envoyer un autre signalement",
    error_subject: "Ajoute un objet.",
    error_short: "Le message est trop court.",
    error_email: "Adresse email invalide.",
    error_send: "Le signalement n'a pas été envoyé. Réessaie dans un instant.",
    error_offline:
      "Tu sembles hors ligne : rien n'a été envoyé. Reconnecte-toi et réessaie.",
    error_rate: "Trop de signalements envoyés. Réessaie dans quelques minutes.",
  },
  de: {
    title: "Kontakt",
    intro:
      "Bei Fragen oder Vorschlägen schreib an {MAIL}. Für Sicherheitsmeldungen: {SEC}.",
    intro_app:
      "Du nutzt JHT bereits? Für technische Probleme nimm «Problem melden» in der App: sie hängt automatisch eine anonymisierte Diagnose an.",
    privacy_note:
      "Die E-Mail-Adresse ist optional: Ohne sie bleibt die Meldung anonym; wenn du sie eingibst, verwenden wir sie nur, um dir zu antworten.",
    kind_label: "Thema",
    kind_support: "Technischer Support",
    kind_question: "Allgemeine Frage",
    kind_partnership: "Kooperationen",
    kind_privacy: "Datenschutz",
    name: "Name",
    name_ph: "Dein Name",
    email: "E-Mail (optional)",
    email_ph: "name@beispiel.de",
    subject: "Betreff",
    subject_ph: "Worum geht es",
    report_intro:
      "Du hast einen Fehler oder etwas entdeckt, das nicht funktioniert? Beschreibe es hier. Gib deine E-Mail-Adresse nur an, wenn du eine Antwort möchtest.",
    message: "Nachricht",
    message_ph: "Was passiert ist und was du erwartet hast",
    data_title: "Gesendete Daten",
    data_body:
      "Wir senden deinen Text, diese Seite, die Sprache der Oberfläche und, falls angegeben, deine E-Mail-Adresse nur als Antwortadresse. Wir senden keinen Namen, keinen Lebenslauf, keine weiteren Kontaktdaten, Dateien oder Logs.",
    data_page: "Seite",
    data_language: "Sprache",
    data_client: "Website",
    send: "Senden",
    sending: "Wird gesendet…",
    sent_title: "Meldung gesendet",
    sent_body: "Deine Meldung ist beim Support angekommen.",
    sent_ticket: "Referenz: %s",
    sent_again: "Weitere Meldung senden",
    error_subject: "Bitte einen Betreff angeben.",
    error_short: "Die Nachricht ist zu kurz.",
    error_email: "Ungültige E-Mail-Adresse.",
    error_send:
      "Deine Meldung wurde nicht gesendet. Versuch es gleich noch einmal.",
    error_offline:
      "Du scheinst offline zu sein: Es wurde nichts gesendet. Verbinde dich und versuche es erneut.",
    error_rate: "Zu viele Meldungen gesendet. Versuch es in ein paar Minuten.",
  },
  pt: {
    title: "Contacto",
    intro:
      "Para dúvidas ou propostas escreve para {MAIL}. Para comunicações de segurança: {SEC}.",
    intro_app:
      "Já usas o JHT? Para problemas técnicos usa «Comunicar um problema» dentro da app: anexa automaticamente um diagnóstico anonimizado.",
    privacy_note:
      "O email é opcional: sem ele, a comunicação permanece anónima; se o indicares, usamos apenas para te responder.",
    kind_label: "Assunto",
    kind_support: "Suporte técnico",
    kind_question: "Questão geral",
    kind_partnership: "Parcerias",
    kind_privacy: "Privacidade e dados",
    name: "Nome",
    name_ph: "O teu nome",
    email: "Email (opcional)",
    email_ph: "nome@exemplo.com",
    subject: "Assunto",
    subject_ph: "Sobre o que nos queres falar",
    report_intro:
      "Encontraste um erro ou algo que não funciona? Descreve-o aqui. Indica o teu email apenas se quiseres receber uma resposta.",
    message: "Mensagem",
    message_ph: "O que aconteceu e o que esperavas",
    data_title: "Dados enviados",
    data_body:
      "Enviamos o texto que escreves, esta página, o idioma da interface e, se o indicares, o teu email apenas como endereço de resposta. Não enviamos nome, CV, outros contactos, ficheiros ou registos.",
    data_page: "Página",
    data_language: "Idioma",
    data_client: "Site web",
    send: "Enviar",
    sending: "A enviar…",
    sent_title: "Comunicação enviada",
    sent_body: "A tua comunicação chegou ao suporte.",
    sent_ticket: "Referência: %s",
    sent_again: "Enviar outra comunicação",
    error_subject: "Adiciona um assunto.",
    error_short: "A mensagem é demasiado curta.",
    error_email: "Endereço de email inválido.",
    error_send:
      "A comunicação não foi enviada. Tenta novamente dentro de instantes.",
    error_offline:
      "Parece que estás sem ligação: não enviámos nada. Volta a ligar-te e tenta de novo.",
    error_rate:
      "Enviaste demasiadas comunicações. Tenta daqui a alguns minutos.",
  },
  hu: {
    title: "Kapcsolat",
    intro:
      "Kérdés vagy javaslat esetén írj a {MAIL} címre. Biztonsági bejelentés: {SEC}.",
    intro_app:
      "Már használod a JHT-t? Technikai problémához használd az app «Hiba jelentése» gombját: automatikusan csatol egy anonimizált diagnosztikát.",
    privacy_note:
      "Az e-mail-cím megadása nem kötelező: nélküle a bejelentés névtelen marad; ha megadod, csak válaszadásra használjuk.",
    kind_label: "Téma",
    kind_support: "Technikai támogatás",
    kind_question: "Általános kérdés",
    kind_partnership: "Együttműködés",
    kind_privacy: "Adatvédelem",
    name: "Név",
    name_ph: "A neved",
    email: "E-mail (nem kötelező)",
    email_ph: "nev@pelda.hu",
    subject: "Tárgy",
    subject_ph: "Miről szeretnél írni",
    report_intro:
      "Hibát vagy nem működő funkciót találtál? Írd le itt. Csak akkor add meg az e-mail-címedet, ha választ szeretnél kapni.",
    message: "Üzenet",
    message_ph: "Mi történt és mire számítottál",
    data_title: "Elküldött adatok",
    data_body:
      "Az általad írt szöveget, ezt az oldalt, a felület nyelvét és — ha megadod — az e-mail-címedet csak válaszcímként küldjük el. Nevet, CV-t, más elérhetőséget, fájlokat vagy naplókat nem küldünk.",
    data_page: "Oldal",
    data_language: "Nyelv",
    data_client: "Webhely",
    send: "Küldés",
    sending: "Küldés…",
    sent_title: "Bejelentés elküldve",
    sent_body: "A bejelentésed megérkezett az ügyfélszolgálathoz.",
    sent_ticket: "Hivatkozás: %s",
    sent_again: "Másik bejelentés küldése",
    error_subject: "Adj meg egy tárgyat.",
    error_short: "Az üzenet túl rövid.",
    error_email: "Érvénytelen e-mail cím.",
    error_send: "A bejelentés nem lett elküldve. Próbáld újra hamarosan.",
    error_offline:
      "Úgy tűnik, nincs kapcsolatod: semmit nem küldtünk el. Csatlakozz újra, majd próbáld meg ismét.",
    error_rate: "Túl sok bejelentést küldtél. Próbáld pár perc múlva.",
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
