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
 * Esiste perché non tutti quelli che hanno qualcosa da dirci hanno un account
 * GitHub, e perché chi non ha ancora installato niente non ha un pulsante
 * "Segnala un problema" da premere. Da qui il messaggio arriva nella casella
 * del progetto come una mail normale.
 */

type Testi = ContactStrings & {
  nav: string;
  title: string;
  intro: string;
  inapp_title: string;
  inapp_body: string;
  security_title: string;
  security_body: string;
  privacy_note: string;
};

const T: Record<string, Testi> = {
  it: {
    nav: "Contatti",
    title: "Scrivici",
    intro:
      "Domande, problemi, proposte: qui arriva tutto nella stessa casella e ti rispondiamo all'indirizzo che lasci.",
    inapp_title: "Hai già installato JHT e vuoi segnalare un bug?",
    inapp_body:
      "Conviene usare «Segnala un problema» dentro l'app: allega da solo una diagnostica del computer già ripulita dai tuoi dati personali, e senza quella capire un bug è molto più difficile.",
    security_title: "Hai trovato una vulnerabilità?",
    security_body:
      "Non usare questo modulo e non aprire una issue pubblica: scrivi a security@jobhunterteam.ai.",
    privacy_note:
      "L'indirizzo che lasci lo usiamo solo per risponderti a questo messaggio.",
    kind_label: "Di cosa si tratta",
    kind_question: "Una domanda",
    kind_bug: "Un problema",
    kind_other: "Altro",
    name: "Nome (facoltativo)",
    name_ph: "come ti chiamiamo",
    email: "Email",
    email_ph: "dove ti rispondiamo",
    email_hint: "Senza indirizzo non possiamo risponderti.",
    message: "Messaggio",
    message_ph: "Raccontaci pure: non serve essere tecnici.",
    send: "Invia",
    sending: "Invio…",
    sent_title: "Messaggio inviato",
    sent_body:
      "Lo leggiamo davvero. Ti rispondiamo all'indirizzo che ci hai lasciato.",
    sent_again: "Scrivi un altro messaggio",
    error_short: "Scrivi qualche parola in più, così capiamo.",
    error_email: "Controlla l'indirizzo email.",
    error_send:
      "Invio non riuscito. Riprova, o scrivi a support@jobhunterteam.ai.",
    error_rate: "Troppi messaggi ravvicinati: riprova fra qualche minuto.",
  },
  en: {
    nav: "Contact",
    title: "Write to us",
    intro:
      "Questions, problems, ideas: it all lands in the same mailbox and we reply to the address you leave.",
    inapp_title: "Already running JHT and want to report a bug?",
    inapp_body:
      "Use «Report a problem» inside the app: it attaches a diagnostic of your machine, already stripped of personal data. Without it, understanding a bug is much harder.",
    security_title: "Found a vulnerability?",
    security_body:
      "Don't use this form and don't open a public issue: write to security@jobhunterteam.ai.",
    privacy_note: "We use the address you leave only to reply to this message.",
    kind_label: "What is it about",
    kind_question: "A question",
    kind_bug: "A problem",
    kind_other: "Something else",
    name: "Name (optional)",
    name_ph: "what to call you",
    email: "Email",
    email_ph: "where we reply",
    email_hint: "Without an address we cannot answer you.",
    message: "Message",
    message_ph: "Tell us anything — no need to be technical.",
    send: "Send",
    sending: "Sending…",
    sent_title: "Message sent",
    sent_body: "We do read these. We'll reply to the address you left.",
    sent_again: "Write another message",
    error_short: "Write a few more words so we can understand.",
    error_email: "Check the email address.",
    error_send:
      "Sending failed. Try again, or write to support@jobhunterteam.ai.",
    error_rate: "Too many messages in a row: try again in a few minutes.",
  },
  es: {
    nav: "Contacto",
    title: "Escríbenos",
    intro:
      "Dudas, problemas, propuestas: todo llega al mismo buzón y respondemos a la dirección que dejes.",
    inapp_title: "¿Ya tienes JHT instalado y quieres informar de un fallo?",
    inapp_body:
      "Mejor usa «Informar de un problema» dentro de la app: adjunta un diagnóstico de tu ordenador ya limpio de datos personales, y sin eso entender un fallo es mucho más difícil.",
    security_title: "¿Has encontrado una vulnerabilidad?",
    security_body:
      "No uses este formulario ni abras una issue pública: escribe a security@jobhunterteam.ai.",
    privacy_note:
      "Usamos la dirección que dejas solo para responder a este mensaje.",
    kind_label: "De qué se trata",
    kind_question: "Una pregunta",
    kind_bug: "Un problema",
    kind_other: "Otra cosa",
    name: "Nombre (opcional)",
    name_ph: "cómo te llamamos",
    email: "Email",
    email_ph: "dónde te respondemos",
    email_hint: "Sin dirección no podemos responderte.",
    message: "Mensaje",
    message_ph: "Cuéntanos: no hace falta ser técnico.",
    send: "Enviar",
    sending: "Enviando…",
    sent_title: "Mensaje enviado",
    sent_body:
      "Los leemos de verdad. Te respondemos a la dirección que dejaste.",
    sent_again: "Escribir otro mensaje",
    error_short: "Escribe algunas palabras más para que podamos entender.",
    error_email: "Revisa la dirección de correo.",
    error_send:
      "El envío ha fallado. Inténtalo o escribe a support@jobhunterteam.ai.",
    error_rate: "Demasiados mensajes seguidos: inténtalo en unos minutos.",
  },
  fr: {
    nav: "Contact",
    title: "Écris-nous",
    intro:
      "Questions, problèmes, propositions : tout arrive dans la même boîte et nous répondons à l'adresse que tu laisses.",
    inapp_title: "Tu as déjà installé JHT et veux signaler un bug ?",
    inapp_body:
      "Utilise plutôt « Signaler un problème » dans l'app : elle joint un diagnostic de ta machine, déjà débarrassé de tes données personnelles. Sans ça, comprendre un bug est bien plus difficile.",
    security_title: "Tu as trouvé une vulnérabilité ?",
    security_body:
      "N'utilise pas ce formulaire et n'ouvre pas d'issue publique : écris à security@jobhunterteam.ai.",
    privacy_note:
      "Nous utilisons l'adresse que tu laisses uniquement pour répondre à ce message.",
    kind_label: "De quoi s'agit-il",
    kind_question: "Une question",
    kind_bug: "Un problème",
    kind_other: "Autre chose",
    name: "Nom (facultatif)",
    name_ph: "comment t'appeler",
    email: "Email",
    email_ph: "où te répondre",
    email_hint: "Sans adresse, impossible de te répondre.",
    message: "Message",
    message_ph: "Raconte-nous : pas besoin d'être technique.",
    send: "Envoyer",
    sending: "Envoi…",
    sent_title: "Message envoyé",
    sent_body: "On les lit vraiment. On répond à l'adresse que tu as laissée.",
    sent_again: "Écrire un autre message",
    error_short: "Écris quelques mots de plus pour qu'on comprenne.",
    error_email: "Vérifie l'adresse email.",
    error_send:
      "Échec de l'envoi. Réessaie ou écris à support@jobhunterteam.ai.",
    error_rate: "Trop de messages rapprochés : réessaie dans quelques minutes.",
  },
  de: {
    nav: "Kontakt",
    title: "Schreib uns",
    intro:
      "Fragen, Probleme, Vorschläge: alles landet im selben Postfach, und wir antworten an die Adresse, die du hinterlässt.",
    inapp_title: "JHT schon installiert und willst einen Bug melden?",
    inapp_body:
      "Nutze lieber «Problem melden» in der App: sie hängt eine Diagnose deines Rechners an, bereits von persönlichen Daten bereinigt. Ohne die ist ein Bug viel schwerer zu verstehen.",
    security_title: "Eine Sicherheitslücke gefunden?",
    security_body:
      "Nutze dieses Formular nicht und öffne kein öffentliches Issue: schreib an security@jobhunterteam.ai.",
    privacy_note:
      "Die Adresse, die du hinterlässt, nutzen wir nur für die Antwort auf diese Nachricht.",
    kind_label: "Worum geht es",
    kind_question: "Eine Frage",
    kind_bug: "Ein Problem",
    kind_other: "Etwas anderes",
    name: "Name (optional)",
    name_ph: "wie wir dich nennen",
    email: "E-Mail",
    email_ph: "wohin wir antworten",
    email_hint: "Ohne Adresse können wir nicht antworten.",
    message: "Nachricht",
    message_ph: "Erzähl einfach — technisch musst du nicht sein.",
    send: "Senden",
    sending: "Wird gesendet…",
    sent_title: "Nachricht gesendet",
    sent_body:
      "Wir lesen sie wirklich. Wir antworten an die hinterlassene Adresse.",
    sent_again: "Weitere Nachricht schreiben",
    error_short: "Schreib ein paar Worte mehr, damit wir es verstehen.",
    error_email: "Prüfe die E-Mail-Adresse.",
    error_send:
      "Senden fehlgeschlagen. Versuch es erneut oder schreib an support@jobhunterteam.ai.",
    error_rate:
      "Zu viele Nachrichten hintereinander: versuch es in ein paar Minuten.",
  },
  pt: {
    nav: "Contacto",
    title: "Escreve-nos",
    intro:
      "Dúvidas, problemas, propostas: chega tudo à mesma caixa e respondemos ao endereço que deixares.",
    inapp_title: "Já tens o JHT instalado e queres comunicar um erro?",
    inapp_body:
      "Usa antes «Comunicar um problema» dentro da app: anexa um diagnóstico do teu computador, já limpo dos teus dados pessoais. Sem isso, perceber um erro é bem mais difícil.",
    security_title: "Encontraste uma vulnerabilidade?",
    security_body:
      "Não uses este formulário nem abras uma issue pública: escreve para security@jobhunterteam.ai.",
    privacy_note:
      "Usamos o endereço que deixares apenas para responder a esta mensagem.",
    kind_label: "Do que se trata",
    kind_question: "Uma pergunta",
    kind_bug: "Um problema",
    kind_other: "Outra coisa",
    name: "Nome (opcional)",
    name_ph: "como te chamamos",
    email: "Email",
    email_ph: "onde respondemos",
    email_hint: "Sem endereço não podemos responder.",
    message: "Mensagem",
    message_ph: "Conta-nos: não precisas de ser técnico.",
    send: "Enviar",
    sending: "A enviar…",
    sent_title: "Mensagem enviada",
    sent_body: "Lemos mesmo. Respondemos ao endereço que deixaste.",
    sent_again: "Escrever outra mensagem",
    error_short: "Escreve mais algumas palavras para percebermos.",
    error_email: "Verifica o endereço de email.",
    error_send:
      "O envio falhou. Tenta de novo ou escreve para support@jobhunterteam.ai.",
    error_rate: "Demasiadas mensagens seguidas: tenta daqui a alguns minutos.",
  },
  hu: {
    nav: "Kapcsolat",
    title: "Írj nekünk",
    intro:
      "Kérdés, probléma, ötlet: minden ugyanabba a postafiókba érkezik, és a megadott címre válaszolunk.",
    inapp_title: "Már fut a JHT és hibát jelentenél?",
    inapp_body:
      "Használd inkább az app «Hiba jelentése» pontját: csatol egy diagnosztikát a gépedről, amelyből a személyes adatokat már eltávolítottuk. Enélkül sokkal nehezebb megérteni egy hibát.",
    security_title: "Sebezhetőséget találtál?",
    security_body:
      "Ne ezt az űrlapot használd és ne nyiss nyilvános issue-t: írj a security@jobhunterteam.ai címre.",
    privacy_note:
      "A megadott címet kizárólag erre az üzenetre adott válaszhoz használjuk.",
    kind_label: "Miről van szó",
    kind_question: "Kérdés",
    kind_bug: "Probléma",
    kind_other: "Egyéb",
    name: "Név (nem kötelező)",
    name_ph: "hogyan szólítsunk",
    email: "E-mail",
    email_ph: "ide válaszolunk",
    email_hint: "Cím nélkül nem tudunk válaszolni.",
    message: "Üzenet",
    message_ph: "Mesélj nyugodtan — nem kell technikusnak lenned.",
    send: "Küldés",
    sending: "Küldés…",
    sent_title: "Üzenet elküldve",
    sent_body: "Tényleg elolvassuk. A megadott címre válaszolunk.",
    sent_again: "Új üzenet írása",
    error_short: "Írj még pár szót, hogy értsük.",
    error_email: "Ellenőrizd az e-mail címet.",
    error_send:
      "A küldés nem sikerült. Próbáld újra, vagy írj a support@jobhunterteam.ai címre.",
    error_rate: "Túl sok üzenet egymás után: próbáld pár perc múlva.",
  },
};

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
              {tx.nav}
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
            {tx.title}
          </h1>
          <p className="text-[var(--color-muted)] text-[12px] mt-3 leading-relaxed">
            {tx.intro}
          </p>
        </div>

        {/* Chi ha l'app installata va indirizzato al pulsante in-app: da lì il
            report arriva con la diagnostica, da qui no. Dirlo prima del modulo
            costa una riga e fa risparmiare uno scambio di mail. */}
        <div className="mb-6 border border-[var(--color-border)] rounded-lg p-5">
          <p className="text-sm font-semibold mb-2">{tx.inapp_title}</p>
          <p className="text-[12px] text-[var(--color-muted)] leading-relaxed">
            {tx.inapp_body}
          </p>
        </div>

        <div className="mb-10 border border-[var(--color-border)] rounded-lg p-5">
          <p className="text-sm font-semibold mb-2">{tx.security_title}</p>
          <p className="text-[12px] text-[var(--color-muted)] leading-relaxed">
            {tx.security_body}
          </p>
        </div>

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
