/**
 * Serializza le invocazioni di una funzione asincrona.
 *
 * Il cloud daemon ha un solo owner, ma può ricevere due sveglie nello stesso
 * istante: il tick bootstrap e il rendezvous "Sync now" via Realtime. Entrambe
 * devono riusare lo stesso writer senza eseguirlo in parallelo. Accodare, invece
 * di scartare o fondere, conserva la semantica del chiamante (opzioni e risultato)
 * e lascia che il delta cursor renda economico il secondo giro.
 *
 * Un errore non avvelena la coda: il tentativo seguente parte comunque.
 */
export function createExclusiveRunner(run) {
  let tail = Promise.resolve();

  return (...args) => {
    const current = tail.then(
      () => run(...args),
      () => run(...args),
    );
    tail = current.then(
      () => undefined,
      () => undefined,
    );
    return current;
  };
}
