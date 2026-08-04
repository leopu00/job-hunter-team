export const LOCAL_RECORDING_ORIGIN = "http://localhost:3008";
export const DEFAULT_RECORDING_ROUTE = "/dashboard";
export const ALLOWED_RECORDING_ROUTES = new Set(["/dashboard", "/messages"]);

/**
 * La route e' deliberatamente un token, non un URL: l'allowlist esatta fa
 * fallire chiunque provi a passare origin, schema, query, hash o varianti.
 */
export function recordingTarget(
  route = process.env.JHT_RECORDING_PATH ?? DEFAULT_RECORDING_ROUTE,
) {
  if (process.env.JHT_RECORDING_ROUTE !== undefined) {
    throw new Error("JHT_RECORDING_ROUTE non e' supportata; usa JHT_RECORDING_PATH");
  }
  if (!ALLOWED_RECORDING_ROUTES.has(route)) {
    throw new Error(
      "JHT_RECORDING_PATH deve essere esattamente /dashboard o /messages",
    );
  }
  return `${LOCAL_RECORDING_ORIGIN}${route}`;
}

/**
 * Le riprese sono read-only: ogni richiesta non-GET viene annullata e rende
 * il take non valido. La promise e' osservata internamente subito, cosi' una
 * violazione che accade durante goto non diventa un rejection non gestito.
 */
export function createGetOnlyRequestPolicy(log = console.error) {
  let failTake;
  const violation = new Promise((_, reject) => {
    failTake = reject;
  });
  violation.catch(() => {});

  let failed = false;
  return {
    violation,
    async handle(route) {
      const method = route.request().method();
      if (method === "GET") {
        await route.continue();
        return;
      }

      const error = new Error(
        `policy GET-only violata: richiesta ${method} bloccata`,
      );
      log(`✗ ${error.message}; take fallito.`);
      if (!failed) {
        failed = true;
        failTake(error);
      }
      await route.abort();
    },
  };
}
