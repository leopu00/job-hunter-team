export const LOCAL_RECORDING_ORIGIN = "http://localhost:3008";
export const DEFAULT_RECORDING_ROUTE = "/dashboard";
export const SYNTHETIC_POSITION_RECORDING_ROUTE = "/positions/9001";
export const ALLOWED_RECORDING_ROUTES = new Set([
  "/dashboard",
  "/messages",
  SYNTHETIC_POSITION_RECORDING_ROUTE,
  "/swipe",
  "/team",
]);
export const SYNTHETIC_POSITION_SEEN_URL =
  "http://localhost:3008/api/positions/seen";
export const SYNTHETIC_POSITION_SEEN_BODY = '{"position_id":"9001"}';

/**
 * La route e' deliberatamente un token, non un URL: l'allowlist esatta fa
 * fallire chiunque provi a passare origin, schema, query, hash o varianti.
 */
export function recordingTarget(
  route = process.env.JHT_RECORDING_PATH ?? DEFAULT_RECORDING_ROUTE,
) {
  if (process.env.JHT_RECORDING_ROUTE !== undefined) {
    throw new Error(
      "JHT_RECORDING_ROUTE non e' supportata; usa JHT_RECORDING_PATH",
    );
  }
  if (!ALLOWED_RECORDING_ROUTES.has(route)) {
    throw new Error(
      "JHT_RECORDING_PATH deve essere esattamente una route recording autorizzata",
    );
  }
  return `${LOCAL_RECORDING_ORIGIN}${route}`;
}

/**
 * Le riprese sono read-only: ogni richiesta non-GET viene annullata. L'unica
 * eccezione non fatale e' il marker sintetico di una posizione vista: viene
 * comunque abortito (mai inviato) e puo' accadere una sola volta. La promise
 * di violazione e' osservata internamente subito, cosi' una violazione durante
 * goto non diventa un rejection non gestito.
 */
export function createGetOnlyRequestPolicy(
  log = console.error,
  recordingRoute = DEFAULT_RECORDING_ROUTE,
) {
  let failTake;
  const violation = new Promise((_, reject) => {
    failTake = reject;
  });
  violation.catch(() => {});

  let confirmSeenPost;
  const allowedSeenPost = new Promise((resolve) => {
    confirmSeenPost = resolve;
  });

  let failed = false;
  let seenPostCount = 0;
  const fail = (method) => {
    const error = new Error(
      `policy GET-only violata: richiesta ${method} bloccata`,
    );
    log(`✗ ${error.message}; take fallito.`);
    if (!failed) {
      failed = true;
      failTake(error);
    }
  };

  return {
    violation,
    allowedSeenPost,
    get seenPostCount() {
      return seenPostCount;
    },
    async handle(route) {
      const request = route.request();
      const method = request.method();
      if (method === "GET") {
        await route.continue();
        return;
      }

      if (
        method === "POST" &&
        recordingRoute === SYNTHETIC_POSITION_RECORDING_ROUTE &&
        request.url() === SYNTHETIC_POSITION_SEEN_URL &&
        request.postData() === SYNTHETIC_POSITION_SEEN_BODY
      ) {
        seenPostCount += 1;
        if (seenPostCount === 1) {
          await route.abort();
          log("✓ marker seen sintetico abortito; take prosegue.");
          confirmSeenPost();
          return;
        }
      }

      await route.abort();
      fail(method);
    },
  };
}
