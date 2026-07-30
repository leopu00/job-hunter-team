import { NextResponse } from "next/server";
import { headers } from "next/headers";
import {
  AI_ASSISTANT_SUGGESTIONS,
  buildAssistantSystemPrompt,
  normalizeAssistantHistory,
  type AssistantChatMessage,
} from "@/lib/ai-assistant";
import { requireAuth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Proxy chat AI — **spento di default** dietro `JHT_AI_ASSISTANT_ENABLED`.
 *
 * COME SI ACCENDE: `JHT_AI_ASSISTANT_ENABLED=1` nell'ambiente del server
 * (più `OPENAI_API_KEY`, che a flag spento la POST non legge nemmeno).
 * Qualunque altro valore — variabile assente compresa — lascia la route
 * spenta. Acceso, il comportamento è identico a com'era prima del flag.
 *
 * PERCHÉ È SPENTO: la UI che la usava — `app/components/FloatingChat.tsx` —
 * non è montata da `app/layout.tsx`, quindi in produzione questo POST non ha
 * chiamanti legittimi; resta però deployato e spende la nostra
 * `OPENAI_API_KEY` a ogni richiesta (vedi il commento su
 * MAX_MESSAGES_PER_HOUR più sotto). Chi ha commentato la UI non l'ha
 * rimossa: la decisione se la feature torna non è ancora stata presa. Il
 * flag spegne la spesa lasciando il codice al suo posto, ed è reversibile
 * in un modo in cui cancellare la feature non sarebbe.
 *
 * PERCHÉ 404 E NON 403: un 403 confermerebbe che dietro questo path c'è un
 * proxy OpenAI, da riprovare con le credenziali giuste. Il 404 dice invece
 * la verità operativa — qui non c'è nessun endpoint — ed è esattamente la
 * risposta che si otterrebbe se il file fosse stato cancellato, cioè lo
 * stato che il flag emula in modo reversibile.
 *
 * Il controllo è la **prima** istruzione della POST: precede `requireAuth`,
 * il rate limit, la lettura di `OPENAI_API_KEY` e qualunque fetch upstream,
 * così a flag spento la route non può costare nulla.
 */
const ASSISTANT_ENABLED_ENV = "JHT_AI_ASSISTANT_ENABLED";

function isAssistantEnabled(): boolean {
  return process.env[ASSISTANT_ENABLED_ENV]?.trim() === "1";
}

export const dynamic = "force-dynamic";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4o-mini";
const MAX_CONTEXT_MESSAGES = 12;
const MAX_OUTPUT_TOKENS = 450;

/**
 * Dodici messaggi all'ora per chiamante.
 *
 * Questa route paga di tasca nostra: ogni POST spende la OPENAI_API_KEY del
 * server. Senza tetto è un proxy OpenAI gratuito con la nostra carta, e il
 * conto lo scopriamo a fine mese. Il rate limit del middleware conta le
 * richieste HTTP in generale (centinaia al minuto, tarato sul polling delle
 * dashboard): qui serve una soglia sua, sull'ordine di grandezza di una
 * conversazione umana.
 */
const MAX_MESSAGES_PER_HOUR = 12;
const RATE_WINDOW_MS = 60 * 60_000;

/** Identità per il rate limit: l'IP del chiamante, come in /api/feedback. */
async function callerIdentity(): Promise<string> {
  const hdrs = await headers();
  const forwarded = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || hdrs.get("x-real-ip")?.trim() || "unknown";
}

type AssistantRequestBody = {
  message?: string;
  history?: AssistantChatMessage[];
  path?: string;
};

function getAssistantConfig() {
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  const model = process.env.JHT_AI_ASSISTANT_MODEL?.trim() || DEFAULT_MODEL;
  return { apiKey, model, configured: apiKey.length > 0 };
}

function buildInput(history: AssistantChatMessage[], message: string) {
  const conversation =
    normalizeAssistantHistory(history).slice(-MAX_CONTEXT_MESSAGES);
  const priorMessages = conversation.map((entry) => ({
    role: entry.role,
    content: [{ type: "input_text", text: entry.content }],
  }));

  return [
    ...priorMessages,
    { role: "user", content: [{ type: "input_text", text: message }] },
  ];
}

function extractResponseText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";

  const candidate = payload as {
    output_text?: unknown;
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
  };

  if (
    typeof candidate.output_text === "string" &&
    candidate.output_text.trim()
  ) {
    return candidate.output_text.trim();
  }

  const chunks = (candidate.output ?? [])
    .filter((item) => item?.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter(
      (part) => part?.type === "output_text" && typeof part.text === "string",
    )
    .map((part) => part.text?.trim() ?? "")
    .filter(Boolean);

  return chunks.join("\n").trim();
}

function extractUpstreamError(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const error = (payload as { error?: { message?: unknown } }).error;
  return typeof error?.message === "string" && error.message.trim()
    ? error.message.trim()
    : null;
}

/**
 * GET — suggerimenti statici e se il chatbot è utilizzabile. Nessun gate:
 * non spende nulla e non dice nulla oltre a "il bottone è attivo o no",
 * che è già visibile dalla UI.
 *
 * `configured` qui significa "utilizzabile", non "c'è una chiave": a flag
 * spento la POST risponde 404, quindi la UI deve mostrarsi offline e
 * disabilitare l'input invece di spedire messaggi che non arriveranno da
 * nessuna parte. `enabled` espone il flag a parte, per diagnosi.
 */
export async function GET() {
  const enabled = isAssistantEnabled();
  const { configured, model } = getAssistantConfig();
  return NextResponse.json({
    history: [],
    suggestions: AI_ASSISTANT_SUGGESTIONS,
    configured: enabled && configured,
    enabled,
    model,
  });
}

export async function POST(req: Request) {
  // Gate di spesa, prima di tutto il resto per costruzione: nessuna chiave
  // letta, nessun fetch upstream, nessun bucket di rate limit consumato.
  // Il perché del flag e del 404 è nel commento in testa al file.
  if (!isAssistantEnabled()) {
    return NextResponse.json(
      { error: "Assistente AI non disponibile.", configured: false },
      { status: 404 },
    );
  }

  // Sessione richiesta: è la stessa regola delle altre route che leggono
  // dati dell'utente, e qui in più c'è una spesa. Su un deploy senza
  // Supabase (desktop puro) requireAuth passa da sé — il rate limit sotto
  // resta comunque, ed è quello che protegge la chiave.
  const denied = await requireAuth();
  if (denied) return denied;

  const limit = await checkRateLimit(
    "ai-assistant",
    "chat",
    await callerIdentity(),
    MAX_MESSAGES_PER_HOUR,
    RATE_WINDOW_MS,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Troppi messaggi all'assistente. Riprova tra poco." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSec) },
      },
    );
  }

  let body: AssistantRequestBody;
  try {
    body = (await req.json()) as AssistantRequestBody;
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "Messaggio richiesto" }, { status: 400 });
  }

  const { apiKey, model, configured } = getAssistantConfig();
  if (!configured) {
    return NextResponse.json(
      {
        error:
          "Chatbot non configurato sul server. Imposta OPENAI_API_KEY per attivarlo.",
        configured: false,
      },
      { status: 503 },
    );
  }

  try {
    const upstream = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: buildAssistantSystemPrompt(body.path),
        input: buildInput(body.history ?? [], message),
        max_output_tokens: MAX_OUTPUT_TOKENS,
      }),
      cache: "no-store",
    });

    const requestId = upstream.headers.get("x-request-id");
    const payload = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      const detail =
        extractUpstreamError(payload) ??
        `Upstream OpenAI HTTP ${upstream.status}`;
      return NextResponse.json(
        {
          error: `Il provider AI non ha accettato la richiesta: ${detail}`,
          configured: true,
          requestId,
        },
        { status: 502 },
      );
    }

    const reply = extractResponseText(payload);
    if (!reply) {
      return NextResponse.json(
        {
          error: "Il provider AI ha restituito una risposta vuota.",
          configured: true,
          requestId,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      reply,
      timestamp: Date.now(),
      model,
      requestId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Errore sconosciuto";
    return NextResponse.json(
      { error: `Richiesta al provider AI fallita: ${message}` },
      { status: 500 },
    );
  }
}
