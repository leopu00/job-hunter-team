export const PORTRAIT_RECORDING_GEOMETRY = Object.freeze({
  width: 540,
  height: 960,
  deviceScaleFactor: 2,
  physicalWidth: 1080,
  physicalHeight: 1920,
});

const PORTRAIT_WAYLAND_DISPLAY = "rel004-vertical";
const PORTRAIT_XDG_RUNTIME_DIR = "/tmp/rel004-headless-runtime";
const ALLOWED_RECORDING_ENVIRONMENT = new Set([
  "JHT_RECORDING_PROFILE",
  "JHT_RECORDING_AUTH_STATE",
  "JHT_RECORDING_PATH",
  "JHT_RECORDING_ROUTE",
  "JHT_RECORDING_FORMAT",
]);

/**
 * Il formato e' un contratto di ripresa, non una preferenza di viewport.
 * Il landscape resta il default storico; portrait richiede la sessione Mutter
 * verticale attestata, cosi' nessuna geometria libera puo' entrare nel take.
 */
export function recordingFormatFromEnvironment(env = process.env) {
  for (const name of Object.keys(env)) {
    if (
      name.startsWith("JHT_RECORDING_") &&
      !ALLOWED_RECORDING_ENVIRONMENT.has(name)
    ) {
      throw new Error(
        `${name} non e' supportata: il launcher non accetta dimensioni configurabili`,
      );
    }
  }

  const format = env.JHT_RECORDING_FORMAT;
  if (format === undefined) return "landscape";
  if (format !== "portrait") {
    throw new Error(
      "JHT_RECORDING_FORMAT ammette solo portrait; omettila per il landscape",
    );
  }
  if (env.WAYLAND_DISPLAY !== PORTRAIT_WAYLAND_DISPLAY) {
    throw new Error(
      `portrait richiede WAYLAND_DISPLAY=${PORTRAIT_WAYLAND_DISPLAY}`,
    );
  }
  if (env.XDG_RUNTIME_DIR !== PORTRAIT_XDG_RUNTIME_DIR) {
    throw new Error(
      `portrait richiede XDG_RUNTIME_DIR=${PORTRAIT_XDG_RUNTIME_DIR}`,
    );
  }
  return "portrait";
}

/**
 * Verifica il frame CSS e il suo backing fisico. Viene chiamata sia sul
 * about:blank iniziale sia dopo il solo goto autorizzato.
 */
export async function assertPortraitGeometry(page) {
  const actual = await page.evaluate(() => {
    const devicePixelRatio = window.devicePixelRatio;
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      devicePixelRatio,
      mobileBreakpoint: window.matchMedia("(max-width: 767px)").matches,
      physicalWidth: window.innerWidth * devicePixelRatio,
      physicalHeight: window.innerHeight * devicePixelRatio,
    };
  });
  const expected = PORTRAIT_RECORDING_GEOMETRY;
  const checks = [
    ["innerWidth", actual.innerWidth, expected.width],
    ["innerHeight", actual.innerHeight, expected.height],
    ["screen.width", actual.screenWidth, expected.width],
    ["screen.height", actual.screenHeight, expected.height],
    ["devicePixelRatio", actual.devicePixelRatio, expected.deviceScaleFactor],
    ["matchMedia(max-width: 767px)", actual.mobileBreakpoint, true],
    ["innerWidth * DPR", actual.physicalWidth, expected.physicalWidth],
    ["innerHeight * DPR", actual.physicalHeight, expected.physicalHeight],
  ];

  const mismatch = checks.find(
    ([, value, expectedValue]) => value !== expectedValue,
  );
  if (mismatch) {
    const [name, value, expectedValue] = mismatch;
    throw new Error(
      `geometria portrait non valida: ${name}=${String(value)}; atteso ${String(expectedValue)}`,
    );
  }
}
