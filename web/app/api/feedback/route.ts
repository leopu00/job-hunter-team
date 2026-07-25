import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { redactSecrets } from "@/lib/redact";
import {
  MAX_BODY_BYTES,
  issueBody,
  issueTitle,
  newTicket,
  parseReport,
  type Report,
} from "@/lib/feedback-report";

/**
 * Destinazione unica delle segnalazioni dell'app desktop.
 *
 * Perché non mandiamo gli utenti direttamente su GitHub: la stragrande
 * maggioranza non ha un account e non ne aprirà uno per dirci che una
 * schermata è rimasta bianca. Questo endpoint è la porta pubblica; GitHub
 * resta la fonte di verità del triage, ma sul lato interno.
 *
 * Volutamente anonimo: nessun login, nessun cookie. Chi ha un problema in
 * fase di setup spesso non è ancora riuscito ad autenticarsi da nessuna
 * parte — chiedergli di fare login per segnalare che il login non funziona
 * chiuderebbe il cerchio nel modo sbagliato.
 *
 * La logica pura (validazione, resa, neutralizzazione) sta in
 * `lib/feedback-report.ts`, dove è testabile senza Next.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Cinque all'ora per IP: una persona che segnala davvero non ne manda di
 *  più, e un abuso automatico si ferma qui invece che sull'issue tracker. */
const MAX_PER_HOUR = 5;

const REPO = process.env.JHT_FEEDBACK_REPO || "leopu00/job-hunter-team";
const GITHUB_TOKEN = process.env.JHT_FEEDBACK_GITHUB_TOKEN || "";
const WEBHOOK_URL = process.env.JHT_FEEDBACK_WEBHOOK_URL || "";
const SUPPORT_EMAIL = process.env.JHT_SUPPORT_EMAIL || "";

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

async function openIssue(
  report: Report,
  ticket: string,
): Promise<string | null> {
  if (!GITHUB_TOKEN) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: issueTitle(report),
        body: issueBody(report, ticket),
        labels: ["bug", "triage", "in-app"],
      }),
    });
    if (!res.ok) {
      console.error("[feedback] GitHub ha risposto", res.status);
      return null;
    }
    const data = (await res.json()) as { number?: number };
    return data.number ? `#${data.number}` : null;
  } catch (err) {
    console.error("[feedback] issue non creata:", err);
    return null;
  }
}

/**
 * Canale secondario (Slack, Discord, un automatismo qualsiasi). Porta anche
 * il contatto dell'utente, che nella issue pubblica non deve comparire.
 */
async function notifyWebhook(report: Report, ticket: string): Promise<boolean> {
  if (!WEBHOOK_URL) return false;
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `Segnalazione ${ticket} — ${report.platform} · v${report.appVersion}\n${redactSecrets(
          report.happened,
        ).slice(0, 500)}`,
        ticket,
        contact: report.contact,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("[feedback] webhook fallito:", err);
    return false;
  }
}

export async function POST(req: NextRequest) {
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
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }
  const report = parseReport(parsed);
  if (!report) {
    return NextResponse.json(
      { error: "Serve almeno il racconto di cosa è successo" },
      { status: 400 },
    );
  }

  const ticket = newTicket();
  const issue = await openIssue(report, ticket);
  const webhook = await notifyWebhook(report, ticket);

  if (!issue && !webhook) {
    // Nessun canale configurato, o entrambi giù. Si risponde con la verità:
    // il client tiene la copia locale e lo dice all'utente, invece di far
    // credere che la segnalazione sia arrivata da qualche parte.
    console.error("[feedback] nessuna destinazione disponibile per", ticket);
    return NextResponse.json(
      {
        error: "Canale di assistenza non disponibile",
        support_email: SUPPORT_EMAIL || undefined,
      },
      { status: 503 },
    );
  }

  console.log(
    `[feedback] ${ticket} · ${report.platform} · v${report.appVersion} · issue=${issue ?? "no"} webhook=${webhook}`,
  );
  return NextResponse.json({ ok: true, ticket: issue ?? ticket });
}
