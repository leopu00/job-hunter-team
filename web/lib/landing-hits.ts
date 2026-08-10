import { createAdminClient } from "@/lib/supabase/admin";
import type { LandingHit } from "@/lib/landing-funnel";
import {
  checkDistributedRateLimit,
  type RateLimitResult,
} from "@/lib/rate-limit";

// Stesso impianto di `download-clicks.ts`: un solo secchiello globale per
// tutti gli anonimi, fail-closed. Un contatore che si può gonfiare non serve
// a decidere dove spendere — e questi due percorsi sono pubblici e
// indovinabili.
export const LANDING_AGGREGATE_RATE_LIMIT = {
  namespace: "landing-funnel",
  scope: "aggregate",
  identity: "global",
  max: 60,
  windowMs: 60_000,
} as const;

type RecorderDependencies = {
  check: (
    namespace: string,
    scope: string,
    identity: string,
    max: number,
    windowMs: number,
  ) => Promise<Pick<RateLimitResult, "allowed"> | null>;
  increment: (event: LandingHit) => Promise<void>;
  /** Distingue "non conto perché è saturo" da "non conto perché il
   *  limitatore non c'è": il secondo è una configurazione mancante, e senza
   *  questa riga un contatore fermo a zero si legge come "nessuno ha
   *  cliccato". Messaggio fisso: mai la richiesta, mai l'evento. */
  logUncoordinated: () => void;
};

const DEFAULT_DEPENDENCIES: RecorderDependencies = {
  check: checkDistributedRateLimit,
  increment: async (event) => {
    const admin = createAdminClient();
    const { error } = await admin.rpc("increment_landing_hits", {
      p_ts_hour: event.ts_hour,
      p_source: event.source,
    });

    if (error) throw new Error("landing aggregate increment failed");
  },
  logUncoordinated: () =>
    console.error("[landing-funnel] rate limiter unavailable: not counting"),
};

/** Incrementa un secchiello aggregato. Non riceve la richiesta, di proposito. */
export async function recordLandingHit(
  event: LandingHit,
  dependencies: RecorderDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  const limit = LANDING_AGGREGATE_RATE_LIMIT;
  const result = await dependencies.check(
    limit.namespace,
    limit.scope,
    limit.identity,
    limit.max,
    limit.windowMs,
  );

  // Coordinamento assente o fallito = non si conta. Mai un ripiego
  // per-istanza: su un runtime che scala da solo diventa un moltiplicatore.
  //
  // Ma i due silenzi vanno distinti: `null` vuol dire che il limitatore non
  // ha risposto (o non è configurato), e allora il contatore resta a zero
  // somigliando a un dato — «non ha cliccato nessuno» — invece che a un
  // guasto. È la differenza fra contare e credere di contare.
  if (result == null) {
    dependencies.logUncoordinated();
    return;
  }
  if (!result.allowed) return;

  await dependencies.increment(event);
}
