/**
 * provider-pins — quale versione della CLI provider installa QUESTA release.
 *
 * Perché esiste (issue #130). Il setup v0.3.5 eseguiva
 * `npm install -g @openai/codex@latest`: un riferimento mutabile, quindi due
 * macchine con la stessa release JHT potevano ritrovarsi due runtime diversi,
 * e un test riprodotto una settimana dopo non era lo stesso test. Il rollback
 * era impossibile per costruzione — non c'era niente a cui tornare.
 *
 * Il pin vive in `shared/config/provider-versions.json`, cioè in git: cambiarlo
 * è un atto deliberato che lascia un diff, e il diff è la traccia di release.
 * Questo modulo lo legge e basta — non lo scrive mai, non lo aggiorna da sé.
 *
 * Fail-safe, e vale la pena dichiarare in che direzione: se il manifest manca,
 * è illeggibile o porta una versione che non è un semver, `pinnedVersion()`
 * torna `null` e il chiamante ricade su `latest` **dicendolo a voce alta**.
 * L'alternativa (rifiutarsi di installare) lascerebbe una macchina senza CLI,
 * cioè un team che non parte: peggio di un'installazione non riproducibile.
 * Il test `provider-version-pin` garantisce che la release il manifest ce
 * l'abbia, così quel ramo resta un'emergenza e non la normalità.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "config",
  "provider-versions.json",
);

// Le tre chiavi del manifest sono gli stessi target di `UPDATE_SPECS` in
// cli/src/commands/providers.js (claude/codex/kimi), non gli id di
// `jht.config.json` (claude/openai/kimi): chi chiama normalizza prima.
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+.][0-9A-Za-z.-]+)?$/;

let cache; // il manifest è immutabile a runtime: si legge una volta sola

export function manifestPath() {
  return MANIFEST_PATH;
}

export function loadPins() {
  if (cache !== undefined) return cache;
  try {
    const data = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
    cache = data && typeof data.pins === "object" && data.pins ? data.pins : {};
  } catch {
    cache = {};
  }
  return cache;
}

/** Solo per i test: rilegge il manifest dalla prossima chiamata. */
export function resetPinsCache() {
  cache = undefined;
}

/**
 * La versione pinnata per `target` (claude/codex/kimi), o `null` se il
 * manifest non la dichiara o la dichiara in una forma che non è una versione.
 * Un valore rotto NON viene interpretato: vale come assente, così un refuso
 * non diventa un pacchetto inesistente da installare.
 */
export function pinnedVersion(target) {
  const pin = loadPins()[target];
  const version = pin && typeof pin.version === "string" ? pin.version.trim() : "";
  return SEMVER_RE.test(version) ? version : null;
}

/** Il nome del pacchetto dichiarato per `target`, o `null`. */
export function pinnedPackage(target) {
  const pin = loadPins()[target];
  const pkg = pin && typeof pin.package === "string" ? pin.package.trim() : "";
  return pkg || null;
}

/**
 * Lo specificatore da passare all'installer:
 *   npm → `@openai/codex@0.147.0`   ·   uv → `kimi-cli==1.49.0`
 * Senza pin (o con `latest: true`, la deroga esplicita dell'operatore) torna
 * il riferimento mutabile — che è sempre una scelta dichiarata, mai un default
 * silenzioso.
 */
export function installSpec(target, { latest = false } = {}) {
  const pkg = pinnedPackage(target);
  if (!pkg) return null;
  const version = latest ? null : pinnedVersion(target);
  const kind = loadPins()[target]?.kind === "uv" ? "uv" : "npm";
  if (!version) return kind === "uv" ? pkg : `${pkg}@latest`;
  return kind === "uv" ? `${pkg}==${version}` : `${pkg}@${version}`;
}
