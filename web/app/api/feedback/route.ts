import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { dispatchFeedback } from "@/lib/feedback-dispatch";
import { redact } from "@/lib/redact";
import {
  MAX_BODY_BYTES,
  newTicket,
  parseReport,
  resendEmailPayload,
  sembraSpam,
  type Report,
} from "@/lib/feedback-report";
import { invalidJsonBody } from "@/app/api/_lib/error-body";

/**
 * Destinazione unica delle segnalazioni dell'app desktop.
 *
 * Perché non mandiamo gli utenti direttamente su GitHub: la stragrande
 * maggioranza non ha un account e non ne aprirà uno per dirci che una
 * schermata è rimasta bianca. Questo endpoint è la porta pubblica; GitHub
 * resta la fonte di verità del triage, ma sul lato interno.
 *
 * Anonimo per default: nessun login, nessun cookie; soltanto chi desidera una
 * risposta aggiunge il recapito facoltativo. Chi ha un problema in fase di
 * setup spesso non è ancora riuscito ad autenticarsi da nessuna parte —
 * chiedergli di fare login per segnalare che il login non funziona chiuderebbe
 * il cerchio nel modo sbagliato.
 *
 * La logica pura (validazione, resa, neutralizzazione) sta in
 * `lib/feedback-report.ts`, dove è testabile senza Next.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Cinque all'ora per IP: una persona che segnala davvero non ne manda di
 *  più, e un abuso automatico si ferma qui invece che sull'issue tracker. */
const MAX_PER_HOUR = 5;

const WEBHOOK_URL = process.env.JHT_FEEDBACK_WEBHOOK_URL || "";
const SUPPORT_EMAIL = process.env.JHT_SUPPORT_EMAIL || "";
const RESEND_KEY = process.env.RESEND_API_KEY || "";
const MAIL_TO = process.env.JHT_FEEDBACK_TO || SUPPORT_EMAIL;
const MAIL_FROM =
  process.env.JHT_FEEDBACK_FROM ||
  "Segnalazioni JHT <support@jobhunterteam.ai>";

/**
 * Recapita la segnalazione nella casella del progetto.
 *
 * È la destinazione che conta: la persona che segnala un crash non ha un
 * account GitHub e non ne aprirà uno: qui la sua segnalazione anonima e già
 * redatta diventa una mail come tutte le altre, in una casella monitorata.
 *
 * Si usa l'API HTTP di Resend e non l'SMTP: le funzioni serverless hanno le
 * porte SMTP in uscita bloccate o inaffidabili, mentre una POST parte sempre.
 */
async function sendEmail(report: Report, ticket: string): Promise<boolean> {
  if (!RESEND_KEY || !MAIL_TO) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      // Il recapito non entra nel corpo, nel webhook o nei log. Il payload
      // puro lo colloca soltanto nel Reply-To usato dall'operatore.
      body: JSON.stringify(
        resendEmailPayload(report, ticket, MAIL_FROM, MAIL_TO),
      ),
    });
    if (!res.ok) {
      console.error("[feedback] Resend ha risposto", res.status);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[feedback] mail non inviata:", err);
    return false;
  }
}

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Canale secondario (Slack, Discord, un automatismo qualsiasi). Riceve solo
 * un riassunto già redatto: non è una destinazione autorizzata per contatti o
 * altri identificativi dell'utente.
 */
async function notifyWebhook(report: Report, ticket: string): Promise<boolean> {
  if (!WEBHOOK_URL) return false;
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `Segnalazione ${ticket} — ${report.platform} · v${report.appVersion}\n${redact(
          report.happened,
        ).slice(0, 500)}`,
        ticket,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("[feedback] webhook fallito:", err);
    return false;
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Segnalazione troppo grande" },
      { status: 413 },
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return invalidJsonBody();
  }
  // Al bot si risponde di sì e non si consegna niente: un errore gli
  // direbbe come aggirare la trappola al tentativo successivo.
  if (sembraSpam(parsed)) {
    return NextResponse.json({ ok: true, ticket: newTicket() });
  }
  // Le sonde con honeypot non devono consumare il budget di cinque invii
  // reali all'ora. Il limit viene applicato soltanto dopo aver escluso bot e
  // probe, prima di qualsiasi destinazione esterna.
  const rl = await checkRateLimit(
    "feedback",
    "submit",
    clientIp(req),
    MAX_PER_HOUR,
    3_600_000,
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Troppe segnalazioni ravvicinate. Riprova tra poco." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }
  const report = parseReport(parsed);
  if (!report) {
    return NextResponse.json(
      { error: "Serve almeno il racconto di cosa è successo" },
      { status: 400 },
    );
  }

  const ticket = newTicket();
  // La casella è la destinazione principale: è quella che regge anche quando
  // il token GitHub scade o il repo cambia nome. Le altre due si aggiungono.
  // ── Le issue non si aprono più in automatico ──────────────────────
  // Ordine dell'operatore del 7 agosto 2026: «se un utente segnala un bug
  // mi arriva notifica su mail e basta, poi casomai apro io la issue».
  //
  // Prima i client non-web (l'app desktop) aprivano una issue pubblica
  // via API. Il difetto non era tecnico ma di sostanza: una segnalazione
  // diventava una pagina pubblica indicizzabile senza che chi scriveva lo
  // decidesse, e una issue pubblica non si cancella davvero — restava un
  // problema aperto anche per la richiesta di cancellazione dati.
  //
  // Ora ogni segnalazione, da qualunque client, esce solo per posta (più
  // il webhook interno se configurato). La funzione che apriva la issue è
  // stata rimossa insieme al token: lasciarla morta nel file sarebbe
  // l'invito a riaccenderla per sbaglio. Se un giorno la si rivuole, va
  // rifatta dietro una scelta esplicita dell'utente — ed è nella storia
  // di git, non serve riscriverla a memoria.
  // Posta prima, webhook solo dopo: vedi `lib/feedback-dispatch.ts` per
  // il perché. In breve: il copy promette la casella di supporto, quindi
  // è la posta a decidere se la promessa è mantenuta.
  const outcome = await dispatchFeedback(
    () => sendEmail(report, ticket),
    () => notifyWebhook(report, ticket),
  );

  if (!outcome.delivered) {
    // La posta non ha accettato: si dice la verità e non si è tentato
    // nessun altro canale. Il client tiene la copia locale e lo comunica,
    // invece di far credere che la segnalazione sia arrivata.
    console.error("[feedback] posta non disponibile per", ticket);
    return NextResponse.json(
      {
        error: "Canale di assistenza non disponibile",
        support_email: SUPPORT_EMAIL || undefined,
      },
      { status: 503 },
    );
  }

  console.log(
    `[feedback] ${ticket} · ${report.platform} · v${report.appVersion} · mail=ok webhook=${outcome.webhook}`,
  );
  return NextResponse.json({ ok: true, ticket });
}
