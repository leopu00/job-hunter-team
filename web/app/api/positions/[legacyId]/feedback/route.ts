import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveUser } from "@/lib/team-state/auth";
import { isDemoLegacyId } from "@/lib/demo/data";
import {
  activeDemoPersona,
  parseDemoFeedback,
  serializeDemoFeedback,
  DEMO_FEEDBACK_COOKIE,
} from "@/lib/demo/mode";
import { invalidJsonBody } from "@/app/api/_lib/error-body";
import { sanitizedError } from "@/lib/error-response";

export const dynamic = "force-dynamic";

// 'clear' (mig 059): l'utente ritira il voto — evento nel log, l'ultimo
// prevale; i lettori lo trattano come "nessun giudizio".
const VALID_ACTIONS = ["like", "dislike", "hide", "star", "clear"] as const;
type Action = (typeof VALID_ACTIONS)[number];

const VALID_DIRECTIONS = ["more_like_this", "less_like_this"] as const;
type Direction = (typeof VALID_DIRECTIONS)[number];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ legacyId: string }> },
) {
  // ── PERCHÉ QUI NON C'È PIÙ IL 403 SUL TOKEN DI DISPOSITIVO (2026-08-10) ──
  //
  // Fino a oggi questa POST rispondeva 403 «Solo il browser registra
  // feedback» a chiunque non arrivasse da una sessione browser. Non era una
  // svista: il vincolo esisteva per impedire che qualcosa registrasse un
  // giudizio al posto dell'utente. Chi legge un 403 tolto da una route di
  // scrittura ha ragione a preoccuparsi, quindi la ragione sta qui e non solo
  // nel log di git.
  //
  // È caduto su decisione esplicita dell'OPERATORE, che ha risposto alla
  // domanda posta in [JHT-CLI-AGENT-PARITY]: «deve poterlo fare se lo chiede
  // l'utente, quindi da CLI si può fare tutto volendo». Il criterio non è
  // un'apertura generica — il vincolo doveva fermare le azioni NON richieste,
  // non impedire all'utente di farsi aiutare da `jht` o da un agente che
  // guida `jht` per suo conto (docs/guides/AI-AGENT-INTEGRATION.md: una sola
  // superficie CLI per persone, agenti AI e launcher desktop).
  //
  // Cosa NON cambia, e va tenuto così:
  //  · l'apertura vale SOLO per questa POST. Le altre route con lo stesso
  //    guard (user-exclude, ticket, write-request, recheck, geocode,
  //    team-directives, emergency-stop, messages, summary) restano
  //    session-only: ognuna è una decisione a sé;
  //  · `userId` arriva dal token VERIFICATO, mai dal corpo della richiesta.
  //    Per un attore token `supabase` è il client service_role, che scavalca
  //    la RLS: se l'identità venisse dal payload, un token qualsiasi potrebbe
  //    votare per chiunque;
  //  · la validazione del corpo è la stessa per i due attori. Un token non
  //    può scrivere azioni, punteggi o direzioni che il browser non potrebbe.
  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;
  const { userId, supabase } = resolved.user;
  const { legacyId } = await params;

  if (!legacyId)
    return NextResponse.json({ error: "legacyId mancante" }, { status: 400 });

  let body: {
    action?: unknown;
    reason?: unknown;
    comment?: unknown;
    score?: unknown;
    direction?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return invalidJsonBody();
  }

  const action =
    typeof body.action === "string" ? (body.action as Action) : null;
  if (!action || !(VALID_ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json(
      {
        error: `action invalida (deve essere uno di: ${VALID_ACTIONS.join(", ")})`,
      },
      { status: 400 },
    );
  }
  const reason =
    typeof body.reason === "string" && body.reason.length <= 500
      ? body.reason
      : null;

  // mig 028: campi opzionali estesi.
  const comment =
    typeof body.comment === "string" && body.comment.length <= 2000
      ? body.comment
      : null;
  let score: number | null = null;
  if (typeof body.score === "number" && Number.isInteger(body.score)) {
    if (body.score < 1 || body.score > 5) {
      return NextResponse.json(
        { error: "score deve essere intero 1-5" },
        { status: 400 },
      );
    }
    score = body.score;
  }
  let direction: Direction | null = null;
  if (typeof body.direction === "string") {
    if (!(VALID_DIRECTIONS as readonly string[]).includes(body.direction)) {
      return NextResponse.json(
        {
          error: `direction invalida (${VALID_DIRECTIONS.join(", ")})`,
        },
        { status: 400 },
      );
    }
    direction = body.direction as Direction;
  }

  // [JHT-WEB-DEMO] Giudizio su una posizione demo: vive nel cookie overlay
  // (nessuna riga su Supabase). Stessa risposta del path reale, così i
  // client (FeedbackButtons, SwipeDeck) non distinguono.
  if (isDemoLegacyId(legacyId) && (await activeDemoPersona())) {
    const store = await cookies();
    const map = parseDemoFeedback(store.get(DEMO_FEEDBACK_COOKIE)?.value);
    map[String(legacyId)] = { a: action, s: score };
    const res = NextResponse.json({
      feedback: {
        id: `demo-fb-${legacyId}`,
        position_legacy_id: legacyId,
        action,
        reason,
        comment,
        score,
        direction,
        created_at: new Date().toISOString(),
      },
    });
    res.cookies.set(DEMO_FEEDBACK_COOKIE, serializeDemoFeedback(map), {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      httpOnly: true,
    });
    return res;
  }

  const { data, error } = await supabase
    .from("position_feedback")
    .insert({
      user_id: userId,
      position_legacy_id: legacyId,
      action,
      reason,
      comment,
      score,
      direction,
    })
    .select()
    .single();

  if (error)
    return sanitizedError(error, {
      status: 500,
      scope: "positions/[legacyId]/feedback",
    });
  return NextResponse.json({ feedback: data });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ legacyId: string }> },
) {
  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;
  const { userId, supabase } = resolved.user;
  const { legacyId } = await params;

  // [JHT-WEB-DEMO] Lettura giudizio demo dal cookie overlay.
  if (isDemoLegacyId(legacyId) && (await activeDemoPersona())) {
    const store = await cookies();
    const map = parseDemoFeedback(store.get(DEMO_FEEDBACK_COOKIE)?.value);
    const e = map[String(legacyId)];
    return NextResponse.json({
      feedback: e
        ? [
            {
              id: `demo-fb-${legacyId}`,
              position_legacy_id: legacyId,
              action: e.a,
              score: e.s,
              reason: null,
              comment: null,
              direction: null,
              created_at: new Date().toISOString(),
            },
          ]
        : [],
    });
  }

  const { data, error } = await supabase
    .from("position_feedback")
    .select("*")
    .eq("user_id", userId)
    .eq("position_legacy_id", legacyId)
    .order("created_at", { ascending: false });

  if (error)
    return sanitizedError(error, {
      status: 500,
      scope: "positions/[legacyId]/feedback",
    });
  return NextResponse.json({ feedback: data ?? [] });
}
