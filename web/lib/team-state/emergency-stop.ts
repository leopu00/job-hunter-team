export const EMERGENCY_STOP_CONFIRMATION = "STOP";

export type EmergencyStopBodyResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Contratto volutamente minuscolo della corsia mobile d'emergenza.
 *
 * Non accettiamo action/target/args: questa route non deve poter crescere per
 * accidente fino a diventare un secondo command bus esposto sul web.
 */
export function validateEmergencyStopBody(
  body: unknown,
): EmergencyStopBodyResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Conferma STOP mancante" };
  }

  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 1 ||
    keys[0] !== "confirm" ||
    record.confirm !== EMERGENCY_STOP_CONFIRMATION
  ) {
    return {
      ok: false,
      error: 'Invia esclusivamente {"confirm":"STOP"}',
    };
  }

  return { ok: true };
}
