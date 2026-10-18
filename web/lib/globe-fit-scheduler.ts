/**
 * Quando inquadrare i pin del globo.
 *
 * Il fit sui dati partiva solo se, all'arrivo dei dati, lo style della mappa
 * era già caricato (`layersReady`); se i dati arrivavano prima di `style.load`
 * l'effetto usciva senza fare niente e non veniva più rieseguito: la mappa
 * restava alla vista iniziale (zoom 1.8, il mondo intero) finché qualcuno non
 * premeva «Vista generale».
 *
 * Qui la richiesta si ricorda: se lo style non è pronto resta in sospeso e
 * parte appena lo è. Ogni cambio dei dati con lo style pronto parte subito.
 */
export type FitOnReady = {
  /** I dati da inquadrare sono cambiati (o sono arrivati). */
  dataChanged: (layersReady: boolean) => void;
  /** Lo style e i layer dei pin sono pronti (a ogni style.load). */
  layersReady: () => void;
};

export function createFitOnReady(run: () => void): FitOnReady {
  let pending = false;
  return {
    dataChanged(layersReady) {
      if (layersReady) {
        pending = false;
        run();
      } else {
        pending = true;
      }
    },
    layersReady() {
      if (!pending) return;
      pending = false;
      run();
    },
  };
}
