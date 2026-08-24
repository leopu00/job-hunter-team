/**
 * Backoff esponenziale bounded con jitter simmetrico.
 *
 * La funzione e' pura e iniettabile: delivery chat, fallback Realtime e test
 * condividono la stessa regola senza timer nascosti. `attempt` satura prima
 * dell'esponenziale, quindi anche una coda ferma per giorni non produce
 * overflow o intervalli senza limite.
 */
export function boundedBackoffDelay(
  attempt,
  {
    minMs = 5_000,
    maxMs = 300_000,
    jitter = 0.2,
    random = Math.random,
  } = {},
) {
  const floor = Math.max(1, Number(minMs) || 1);
  const ceiling = Math.max(floor, Number(maxMs) || floor);
  const n = Math.max(0, Math.min(30, Math.trunc(Number(attempt) || 0)));
  const nominal = Math.min(ceiling, floor * 2 ** n);
  const spread = Math.max(0, Math.min(1, Number(jitter) || 0));
  const sample = Math.max(0, Math.min(1, Number(random()) || 0));
  const factor = 1 - spread + sample * spread * 2;
  return Math.max(floor, Math.min(ceiling, Math.round(nominal * factor)));
}
