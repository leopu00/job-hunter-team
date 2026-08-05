export const PORTRAIT_RECORDING_GEOMETRY = Object.freeze({
  width: 540,
  height: 960,
  deviceScaleFactor: 2,
  physicalWidth: 1080,
  physicalHeight: 1920,
});

// The vertical web take is an iOS-style mobile emulation, not a desktop page
// squeezed into a 9:16 frame.  Keep these values fixed with the geometry so
// a caller cannot turn the portrait route into an arbitrary device profile.
export const PORTRAIT_RECORDING_MOBILE_EMULATION = Object.freeze({
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  isMobile: true,
  hasTouch: true,
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
      visualViewportWidth: window.visualViewport?.width,
      visualViewportHeight: window.visualViewport?.height,
      mobileBreakpoint: window.matchMedia("(max-width: 767px)").matches,
      coarsePointer: window.matchMedia("(pointer: coarse)").matches,
      touchCapable: navigator.maxTouchPoints > 0,
      userAgent: navigator.userAgent,
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
    ["visualViewport.width", actual.visualViewportWidth, expected.width],
    ["visualViewport.height", actual.visualViewportHeight, expected.height],
    ["matchMedia(max-width: 767px)", actual.mobileBreakpoint, true],
    ["matchMedia(pointer: coarse)", actual.coarsePointer, true],
    ["navigator.maxTouchPoints > 0", actual.touchCapable, true],
    [
      "navigator.userAgent",
      actual.userAgent,
      PORTRAIT_RECORDING_MOBILE_EMULATION.userAgent,
    ],
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

/**
 * Verifica il documento dopo la navigazione: la route portrait deve mantenere
 * il viewport mobile reale anche quando il contenuto arriva dall'app, senza
 * scorrimento orizzontale che trasformerebbe il frame in un desktop croppato.
 */
export async function assertPortraitMobileDocument(page) {
  const actual = await page.evaluate(() => ({
    viewportMeta:
      document
        .querySelector('meta[name="viewport"]')
        ?.getAttribute("content") ?? "",
    horizontalOverflow:
      document.documentElement.scrollWidth > window.innerWidth,
  }));

  if (!/\bwidth\s*=\s*device-width\b/i.test(actual.viewportMeta)) {
    throw new Error(
      "documento portrait non mobile: meta viewport width=device-width assente",
    );
  }
  if (actual.horizontalOverflow) {
    throw new Error(
      "documento portrait non mobile: overflow orizzontale rilevato",
    );
  }
}
