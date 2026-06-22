import { state } from './state.js'
import { showHome, startTeamFromHome } from './home.js'

const _runningLog = (typeof window !== 'undefined' && window.jhtLog && window.jhtLog.scope)
  ? window.jhtLog.scope('running')
  : { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

export async function startTeam() {
  if (state.starting) {
    _runningLog.warn('startTeam.already-starting')
    return
  }
  // state.location e' in-memory e si perde ad ogni restart Electron.
  // Le preferences su disco invece persistono. Se la location manca
  // dallo state ma e' nelle prefs (VPS scelta in setup precedente),
  // caricala prima di decidere il ramo — sennò il restart cade
  // sempre sul Local path (default undefined).
  if (!state.location && window.prefsApi?.get) {
    try {
      const saved = await window.prefsApi.get('location')
      if (saved === 'local' || saved === 'vps') {
        state.location = saved
        _runningLog.info('startTeam.location-restored-from-prefs', { location: saved })
      }
    } catch (e) {
      _runningLog.warn('startTeam.prefs-read-failed', { err: String(e?.message || e) })
    }
  }
  _runningLog.info('startTeam.click', { location: state.location, starting: state.starting })
  // [JHT-DASHBOARD-SPLIT] Il "Start team" del wizard NON ha più uno step
  // terminale dedicato ("Team running / apri nel browser", ex STEP_RUNNING,
  // ora rimosso): quella schermata dipendeva dal ritorno di launcherApi.start(),
  // che però BLOCCA per tutta la durata del warm-up del runtime → la transizione
  // alla Home non scattava mai e l'utente restava inchiodato lì.
  //
  // Soluzione: atterriamo SUBITO sulla Home (menu laterale) e deleghiamo l'avvio
  // a startTeamFromHome — esattamente lo stesso flusso del bottone Start della
  // Home. Lì lo stato "starting" è renderizzato NEL pannello Team PRIMA
  // dell'await bloccante, quindi l'utente vede sempre la Home mentre il runtime
  // si scalda; il poll del pannello (5s) fa avanzare starting→running e mostra
  // il bottone Open / apre la dashboard in-app. Vale per local E vps (la
  // funzione gestisce entrambi i rami).
  try {
    await showHome('team')
    _runningLog.info('startTeam.showHome.ok', { location: state.location })
  } catch (e) {
    _runningLog.error('startTeam.showHome.failed', { err: String(e?.message || e) })
  }
  try {
    await startTeamFromHome()
    _runningLog.info('startTeam.delegated-to-home.ok', { location: state.location })
  } catch (e) {
    _runningLog.error('startTeam.delegated-to-home.failed', { err: String(e?.message || e) })
  }
}
