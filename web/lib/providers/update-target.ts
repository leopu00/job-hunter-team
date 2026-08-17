/**
 * Che versione installerà il bottone «aggiorna» della dashboard, e se vale
 * la pena proporlo.
 *
 * Il badge e il bottone devono parlare della STESSA versione. Fino a qui non
 * lo facevano: il bottone installa il pin dichiarato dalla release
 * (`shared/config/provider-versions.json`, issue #130) mentre l'etichetta
 * confrontava l'installata con `~/.codex/version.json`, cioè con l'ultima
 * pubblicata sul registry. L'incoerenza è nata insieme al pin, e nella forma
 * peggiore: l'etichetta invita a premere indicando un numero, il click ne
 * installa un altro.
 *
 * Qui vive solo la decisione, senza filesystem, così i casi si possono
 * interrogare uno per uno.
 */
import { updateAvailable } from "../../../shared/release/version.js";

export interface UpdateTargetInput {
  /** Versione del pin per questo provider, se dichiarata e ben formata. */
  pinnedVersion?: string | null;
  /** Ultima versione nota dal registry, dove il CLI la scrive (solo codex). */
  registryLatest?: string | null;
  /** Versione attualmente installata sulla macchina. */
  installedVersion?: string | null;
}

export interface UpdateTargetResult {
  /** Il numero che il bottone porterà sulla macchina, o null se ignoto. */
  targetVersion: string | null;
  /** Se proporre l'aggiornamento come cosa da fare. */
  updateAvailable: boolean;
}

/**
 * Il bersaglio segue la stessa regola dell'installazione: **il pin vince**,
 * e solo quando manca o è malformato si ricade su ciò che il registry
 * dichiara — perché in quel caso è `@latest` che verrebbe installato per
 * davvero (vedi `installSpecFor`).
 *
 * L'aggiornamento si propone soltanto se il bersaglio è più NUOVO
 * dell'installata. Non è pedanteria: oggi il pin di kimi è 1.36.0 mentre
 * PyPI pubblica la 1.49.0, quindi una macchina può benissimo trovarsi più
 * avanti del pin. Lì il bottone resta disponibile — riallineare alla
 * versione della release è legittimo — ma chiamarlo «aggiornamento» sarebbe
 * falso, e un badge che mente è un badge che si impara a ignorare.
 *
 * Versioni che non sappiamo confrontare non producono nessun invito: il
 * silenzio è l'unico esito onesto quando non si può dire quale sia più
 * recente.
 */
export function resolveUpdateTarget(
  input: UpdateTargetInput,
): UpdateTargetResult {
  const targetVersion = input.pinnedVersion || input.registryLatest || null;
  return {
    targetVersion,
    updateAvailable: updateAvailable(targetVersion, input.installedVersion),
  };
}
