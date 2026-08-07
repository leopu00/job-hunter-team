// Valori misurati della scheda requisiti nativa.
//
// Vivono in un catalogo puro invece che dentro il componente React: così la
// rete i18n del web li importa davvero e una nuova riga inglese non può
// restare invisibile al censimento. I nomi di prodotto e le unità tecniche
// restano invariati; le spiegazioni sono tradotte nelle sette lingue.

import type { GuideText } from "./guide-types";

export const REQUIREMENTS_CARD_VALUES: Record<string, GuideText> = {
  docker: {
    en: "Required",
    it: "Obbligatorio",
    es: "Obligatorio",
    fr: "Requis",
    de: "Erforderlich",
    pt: "Obrigatório",
    hu: "Szükséges",
  },
  memory: {
    en: "About 8 GB available before starting the team",
    it: "Circa 8 GB disponibili prima di avviare il team",
    es: "Unos 8 GB disponibles antes de iniciar el equipo",
    fr: "Environ 8 Go disponibles avant de démarrer l’équipe",
    de: "Vor dem Start des Teams etwa 8 GB verfügbar",
    pt: "Cerca de 8 GB disponíveis antes de iniciar a equipa",
    hu: "A csapat indítása előtt körülbelül 8 GB legyen szabad",
  },
  disk: {
    en: "Room for the team image — no minimum has been measured",
    it: "Spazio per l'immagine del team — non è stato misurato alcun minimo",
    es: "Espacio para la imagen del equipo — no se ha medido ningún mínimo",
    fr: "Espace pour l’image de l’équipe — aucun minimum n’a été mesuré",
    de: "Platz für das Team-Image — es wurde kein Minimum gemessen",
    pt: "Espaço para a imagem da equipa — não foi medido qualquer mínimo",
    hu: "Hely a csapat Docker-image-éhez — nem mértek minimális tárhelyigényt",
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

export const REQUIREMENTS_CARD_EVIDENCE: GuideText = {
  en: "Measured over 30 minutes on Windows: a 12 GB machine kept more than 4 GB free with the team and Job Hunter Team Desktop running, on a 2013 2-core, 4-thread CPU, without saturation.",
  it: "Misurato per 30 minuti su Windows: una macchina con 12 GB ha mantenuto più di 4 GB liberi con il team e Job Hunter Team Desktop in esecuzione, su una CPU del 2013 con 2 core e 4 thread, senza saturarsi.",
  es: "Medido durante 30 minutos en Windows: una máquina con 12 GB mantuvo más de 4 GB libres con el equipo y Job Hunter Team Desktop en ejecución, en una CPU de 2013 con 2 núcleos y 4 hilos, sin saturarse.",
  fr: "Mesuré pendant 30 minutes sous Windows : une machine équipée de 12 Go a conservé plus de 4 Go libres avec l’équipe et Job Hunter Team Desktop en fonctionnement, sur un processeur de 2013 à 2 cœurs et 4 threads, sans saturation.",
  de: "Über 30 Minuten unter Windows gemessen: Auf einem Rechner mit 12 GB blieben bei laufendem Team und Job Hunter Team Desktop mehr als 4 GB frei; die CPU aus dem Jahr 2013 mit 2 Kernen und 4 Threads wurde dabei nicht ausgelastet.",
  pt: "Medido durante 30 minutos no Windows: uma máquina com 12 GB manteve mais de 4 GB livres com a equipa e o Job Hunter Team Desktop em execução, num processador de 2013 com 2 núcleos e 4 threads, sem saturar.",
  hu: "30 perces Windows-futtatásban mérve: egy 12 GB-os gépen több mint 4 GB maradt szabadon a csapat és a Job Hunter Team Desktop futása közben; a 2013-as, 2 magos, 4 szálas processzor nem telítődött.",
};
