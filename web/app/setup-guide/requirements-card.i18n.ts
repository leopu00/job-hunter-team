// Valori della scheda requisiti nativa: i numeri sono misurati, i sistemi sono quelli della 0.4.
//
// Vivono in un catalogo puro invece che dentro il componente React: così la
// rete i18n del web li importa davvero e una nuova riga inglese non può
// restare invisibile al censimento. I nomi di prodotto e le unità tecniche
// restano invariati; le spiegazioni sono tradotte nelle sette lingue.

import type { GuideText } from "./guide-types";

export const REQUIREMENTS_CARD_VALUES: Record<string, GuideText> = {
  docker: {
    en: "Podman, installed through Homebrew and managed by the app — Homebrew must already be on your Mac",
    it: "Podman, installato tramite Homebrew e gestito dall’app — Homebrew deve essere già sul tuo Mac",
    es: "Podman, instalado con Homebrew y gestionado por la aplicación — Homebrew debe estar ya en tu Mac",
    fr: "Podman, installé via Homebrew et géré par l’application — Homebrew doit déjà être sur votre Mac",
    de: "Podman, über Homebrew installiert und von der App verwaltet — Homebrew muss bereits auf deinem Mac sein",
    pt: "Podman, instalado através do Homebrew e gerido pela aplicação — o Homebrew tem de estar já no teu Mac",
    hu: "Podman, Homebrew-val telepítve és az alkalmazás által kezelve — a Homebrew-nak már a Macen kell lennie",
  },
  memory: {
    en: "A Mac with at least 16 GB of RAM is recommended; the container machine the app creates uses 2 CPUs and 4 GiB of memory",
    it: "Consigliato un Mac con almeno 16 GB di RAM; la macchina per i container che l’app crea usa 2 CPU e 4 GiB di memoria",
    es: "Se recomienda un Mac con al menos 16 GB de RAM; la máquina de contenedores que crea la aplicación usa 2 CPU y 4 GiB de memoria",
    fr: "Un Mac avec au moins 16 Go de RAM est recommandé ; la machine de conteneurs créée par l’application utilise 2 CPU et 4 GiB de mémoire",
    de: "Empfohlen wird ein Mac mit mindestens 16 GB RAM; die Container-Maschine, die die App anlegt, nutzt 2 CPUs und 4 GiB Arbeitsspeicher",
    pt: "Recomenda-se um Mac com pelo menos 16 GB de RAM; a máquina de contentores que a aplicação cria usa 2 CPU e 4 GiB de memória",
    hu: "Ajánlott egy legalább 16 GB RAM-os Mac; az alkalmazás által létrehozott konténergép 2 CPU-t és 4 GiB memóriát használ",
  },
  disk: {
    en: "Room for the team image — no minimum has been measured; the machine’s disk grows as needed, up to 30 GiB",
    it: "Spazio per l'immagine del team — non è stato misurato alcun minimo; il disco della macchina cresce secondo necessità, fino a 30 GiB",
    es: "Espacio para la imagen del equipo — no se ha medido ningún mínimo; el disco de la máquina crece según haga falta, hasta 30 GiB",
    fr: "Espace pour l’image de l’équipe — aucun minimum n’a été mesuré ; le disque de la machine grandit selon les besoins, jusqu’à 30 GiB",
    de: "Platz für das Team-Image — es wurde kein Minimum gemessen; die Festplatte der Maschine wächst bei Bedarf bis auf 30 GiB",
    pt: "Espaço para a imagem da equipa — não foi medido qualquer mínimo; o disco da máquina cresce conforme necessário, até 30 GiB",
    hu: "Hely a csapat image-éhez — nem mértek minimális tárhelyigényt; a gép lemeze szükség szerint nő, legfeljebb 30 GiB-ig",
  },
  internet: {
    en: "Required",
    it: "Obbligatorio",
    es: "Obligatorio",
    fr: "Requis",
    de: "Erforderlich",
    pt: "Obrigatório",
    hu: "Szükséges",
  },
  provider: {
    en: "A supported subscription — never an API key",
    it: "Un abbonamento supportato — mai una chiave API",
    es: "Una suscripción compatible — nunca una clave de API",
    fr: "Un abonnement pris en charge — jamais une clé API",
    de: "Ein unterstütztes Abonnement — niemals ein API-Schlüssel",
    pt: "Uma subscrição suportada — nunca uma chave de API",
    hu: "Támogatott előfizetés — soha nem API-kulcs",
  },
  vps: {
    en: "Ubuntu 24.04 · 4 GB RAM · 2 vCPU · 80 GB SSD · 2 GB preventive swap",
    it: "Ubuntu 24.04 · 4 GB di RAM · 2 vCPU · SSD da 80 GB · 2 GB di swap preventivo",
    es: "Ubuntu 24.04 · 4 GB de RAM · 2 vCPU · SSD de 80 GB · 2 GB de swap preventivo",
    fr: "Ubuntu 24.04 · 4 Go de RAM · 2 vCPU · SSD de 80 Go · 2 Go de swap préventif",
    de: "Ubuntu 24.04 · 4 GB RAM · 2 vCPUs · 80 GB SSD · vorsorglich 2 GB Swap",
    pt: "Ubuntu 24.04 · 4 GB de RAM · 2 vCPU · SSD de 80 GB · 2 GB de swap preventivo",
    hu: "Ubuntu 24.04 · 4 GB RAM · 2 vCPU · 80 GB-os SSD · 2 GB megelőző célú swap",
  },
};

/** What this version supports, said plainly under the card: no measurement is claimed for a system. */
export const REQUIREMENTS_CARD_SYSTEMS: GuideText = {
  en: "Supported in this version: Macs with Apple silicon. Windows is not supported in 0.4. Linux is experimental and has not been tested by hand.",
  it: "Supportati in questa versione: Mac con Apple silicon. Windows non è supportato nella 0.4. Linux è sperimentale e non è stato provato a mano.",
  es: "Compatibles en esta versión: Mac con Apple silicon. Windows no es compatible en la 0.4. Linux es experimental y no se ha probado a mano.",
  fr: "Pris en charge dans cette version : les Mac Apple silicon. Windows n’est pas pris en charge dans la 0.4. Linux est expérimental et n’a pas été testé à la main.",
  de: "In dieser Version unterstützt: Macs mit Apple Silicon. Windows wird in 0.4 nicht unterstützt. Linux ist experimentell und wurde nicht von Hand getestet.",
  pt: "Suportados nesta versão: Macs com Apple silicon. O Windows não é suportado na 0.4. O Linux é experimental e não foi testado à mão.",
  hu: "Ebben a verzióban támogatott: az Apple silicon Macek. A Windows a 0.4-ben nem támogatott. A Linux kísérleti, és kézzel nem tesztelték.",
};
