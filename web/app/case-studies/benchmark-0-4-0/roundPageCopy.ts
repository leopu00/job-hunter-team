// The words of the page of one test of the benchmark, in the seven languages of the site.

import type { Locale } from "@/i18n/config";

export type RoundPageCopy = {
  back: string;
  kindRound: string;
  kindBench: string;
  overview: string;
  system: string;
  service: string;
  build: string;
  profile: string;
  date: string;
  duration: string;
  minutes: string;
  spend: string;
  positions: string;
  positionsHint: string;
  costPerPosition: string;
  costPerRelevant: string;
  outcome: string;
  charts: string;
  story: string;
  storyFromEvents: string;
  storyMinute: string;
  storyTotals: string;
  defects: string;
  defectsMissing: string;
  fixedIn: string;
  notFixed: string;
  fixClaimed: string;
  prev: string;
  next: string;
  sameSystem: string;
  synthetic: string;
};

const en: RoundPageCopy = {
  back: "← All the tests of the 0.4.0 benchmark",
  kindRound: "Test round",
  kindBench: "Scout bench, build 9",
  overview: "Overview",
  system: "System",
  service: "Service",
  build: "Build",
  profile: "Profile",
  date: "Day",
  duration: "Duration",
  minutes: "{n} min",
  spend: "Spend",
  positions: "Positions",
  positionsHint: "found / scored / relevant",
  costPerPosition: "Cost per position",
  costPerRelevant: "Cost per relevant position",
  outcome: "Outcome",
  charts: "The test minute by minute",
  story: "What happened",
  storyFromEvents: "From the events recorded during the test:",
  storyMinute: "minute {m}: {e}",
  storyTotals: "At the end: {spend}, {found} positions found, {scored} with a score.",
  defects: "Defects found in this test",
  defectsMissing: "The defects of this test are not written here yet.",
  fixedIn: "fixed in build {n}, verified",
  notFixed: "still open",
  fixClaimed: "fix declared in build {n}, not verified yet",
  prev: "← Previous on {os}",
  next: "Next on {os} →",
  sameSystem: "Other tests on the same system",
  synthetic: "Synthetic profile: an invented person and trade, no real data.",
};

const it: RoundPageCopy = {
  back: "← Tutti i test del benchmark 0.4.0",
  kindRound: "Giro di prova",
  kindBench: "Banco Scout, build 9",
  overview: "Panoramica",
  system: "Sistema",
  service: "Servizio",
  build: "Build",
  profile: "Profilo",
  date: "Giorno",
  duration: "Durata",
  minutes: "{n} min",
  spend: "Spesa",
  positions: "Annunci",
  positionsHint: "trovati / con punteggio / pertinenti",
  costPerPosition: "Costo per annuncio",
  costPerRelevant: "Costo per annuncio pertinente",
  outcome: "Esito",
  charts: "Il test minuto per minuto",
  story: "Cosa è successo",
  storyFromEvents: "Dagli eventi registrati durante il test:",
  storyMinute: "minuto {m}: {e}",
  storyTotals: "Alla fine: {spend}, {found} annunci trovati, {scored} con punteggio.",
  defects: "Difetti trovati in questo test",
  defectsMissing: "I difetti di questo test non sono ancora scritti qui.",
  fixedIn: "corretto nella build {n}, verificato",
  notFixed: "ancora aperto",
  fixClaimed: "correzione dichiarata nella build {n}, non ancora verificata",
  prev: "← Precedente su {os}",
  next: "Successivo su {os} →",
  sameSystem: "Altri test sullo stesso sistema",
  synthetic: "Profilo sintetico: persona e mestiere inventati, nessun dato vero.",
};

const de: RoundPageCopy = {
  back: "← Alle Tests des Benchmarks 0.4.0",
  kindRound: "Testrunde",
  kindBench: "Scout-Bank, Build 9",
  overview: "Überblick",
  system: "System",
  service: "Dienst",
  build: "Build",
  profile: "Profil",
  date: "Tag",
  duration: "Dauer",
  minutes: "{n} Min.",
  spend: "Ausgaben",
  positions: "Stellen",
  positionsHint: "gefunden / bewertet / passend",
  costPerPosition: "Kosten pro Stelle",
  costPerRelevant: "Kosten pro passender Stelle",
  outcome: "Ergebnis",
  charts: "Der Test Minute für Minute",
  story: "Was passiert ist",
  storyFromEvents: "Aus den während des Tests erfassten Ereignissen:",
  storyMinute: "Minute {m}: {e}",
  storyTotals: "Am Ende: {spend}, {found} Stellen gefunden, {scored} bewertet.",
  defects: "In diesem Test gefundene Fehler",
  defectsMissing: "Die Fehler dieses Tests stehen hier noch nicht.",
  fixedIn: "behoben in Build {n}",
  notFixed: "noch offen",
  fixClaimed: "Korrektur in Build {n} angegeben, noch nicht geprüft",
  prev: "← Vorheriger auf {os}",
  next: "Nächster auf {os} →",
  sameSystem: "Andere Tests auf demselben System",
  synthetic: "Synthetisches Profil: erfundene Person und erfundener Beruf, keine echten Daten.",
};

const es: RoundPageCopy = {
  back: "← Todas las pruebas del benchmark 0.4.0",
  kindRound: "Ronda de prueba",
  kindBench: "Banco de Scouts, build 9",
  overview: "Resumen",
  system: "Sistema",
  service: "Servicio",
  build: "Build",
  profile: "Perfil",
  date: "Día",
  duration: "Duración",
  minutes: "{n} min",
  spend: "Gasto",
  positions: "Anuncios",
  positionsHint: "encontrados / puntuados / pertinentes",
  costPerPosition: "Coste por anuncio",
  costPerRelevant: "Coste por anuncio pertinente",
  outcome: "Resultado",
  charts: "La prueba minuto a minuto",
  story: "Qué pasó",
  storyFromEvents: "De los eventos registrados durante la prueba:",
  storyMinute: "minuto {m}: {e}",
  storyTotals: "Al final: {spend}, {found} anuncios encontrados, {scored} puntuados.",
  defects: "Defectos encontrados en esta prueba",
  defectsMissing: "Los defectos de esta prueba aún no están escritos aquí.",
  fixedIn: "corregido en la build {n}",
  notFixed: "aún abierto",
  fixClaimed: "corrección declarada en la build {n}, aún sin verificar",
  prev: "← Anterior en {os}",
  next: "Siguiente en {os} →",
  sameSystem: "Otras pruebas en el mismo sistema",
  synthetic: "Perfil sintético: persona y oficio inventados, ningún dato real.",
};

const fr: RoundPageCopy = {
  back: "← Tous les tests du benchmark 0.4.0",
  kindRound: "Tour de test",
  kindBench: "Banc des Scouts, build 9",
  overview: "Aperçu",
  system: "Système",
  service: "Service",
  build: "Build",
  profile: "Profil",
  date: "Jour",
  duration: "Durée",
  minutes: "{n} min",
  spend: "Dépense",
  positions: "Annonces",
  positionsHint: "trouvées / notées / pertinentes",
  costPerPosition: "Coût par annonce",
  costPerRelevant: "Coût par annonce pertinente",
  outcome: "Résultat",
  charts: "Le test minute par minute",
  story: "Ce qui s'est passé",
  storyFromEvents: "D'après les événements enregistrés pendant le test :",
  storyMinute: "minute {m} : {e}",
  storyTotals: "À la fin : {spend}, {found} annonces trouvées, {scored} notées.",
  defects: "Défauts trouvés dans ce test",
  defectsMissing: "Les défauts de ce test ne sont pas encore écrits ici.",
  fixedIn: "corrigé dans la build {n}",
  notFixed: "encore ouvert",
  fixClaimed: "correction annoncée dans la build {n}, pas encore vérifiée",
  prev: "← Précédent sur {os}",
  next: "Suivant sur {os} →",
  sameSystem: "Autres tests sur le même système",
  synthetic: "Profil synthétique : personne et métier inventés, aucune donnée réelle.",
};

const hu: RoundPageCopy = {
  back: "← A 0.4.0 benchmark összes tesztje",
  kindRound: "Tesztkör",
  kindBench: "Scout-pad, 9. build",
  overview: "Áttekintés",
  system: "Rendszer",
  service: "Szolgáltatás",
  build: "Build",
  profile: "Profil",
  date: "Nap",
  duration: "Időtartam",
  minutes: "{n} perc",
  spend: "Költés",
  positions: "Hirdetések",
  positionsHint: "talált / pontozott / releváns",
  costPerPosition: "Költség hirdetésenként",
  costPerRelevant: "Költség releváns hirdetésenként",
  outcome: "Eredmény",
  charts: "A teszt percről percre",
  story: "Mi történt",
  storyFromEvents: "A teszt közben rögzített események alapján:",
  storyMinute: "{m}. perc: {e}",
  storyTotals: "A végén: {spend}, {found} talált hirdetés, {scored} pontozott.",
  defects: "A tesztben talált hibák",
  defectsMissing: "A teszt hibái még nincsenek itt leírva.",
  fixedIn: "javítva a(z) {n}. buildben",
  notFixed: "még nyitott",
  fixClaimed: "javítás a(z) {n}. buildben jelezve, még nem ellenőrizve",
  prev: "← Előző ezen: {os}",
  next: "Következő ezen: {os} →",
  sameSystem: "További tesztek ugyanazon a rendszeren",
  synthetic: "Szintetikus profil: kitalált személy és szakma, valódi adat nélkül.",
};

const pt: RoundPageCopy = {
  back: "← Todos os testes do benchmark 0.4.0",
  kindRound: "Rodada de teste",
  kindBench: "Bancada de Scouts, build 9",
  overview: "Visão geral",
  system: "Sistema",
  service: "Serviço",
  build: "Build",
  profile: "Perfil",
  date: "Dia",
  duration: "Duração",
  minutes: "{n} min",
  spend: "Gasto",
  positions: "Anúncios",
  positionsHint: "encontrados / pontuados / pertinentes",
  costPerPosition: "Custo por anúncio",
  costPerRelevant: "Custo por anúncio pertinente",
  outcome: "Resultado",
  charts: "O teste minuto a minuto",
  story: "O que aconteceu",
  storyFromEvents: "A partir dos eventos registados durante o teste:",
  storyMinute: "minuto {m}: {e}",
  storyTotals: "No fim: {spend}, {found} anúncios encontrados, {scored} pontuados.",
  defects: "Defeitos encontrados neste teste",
  defectsMissing: "Os defeitos deste teste ainda não estão escritos aqui.",
  fixedIn: "corrigido na build {n}",
  notFixed: "ainda aberto",
  fixClaimed: "correção declarada na build {n}, ainda não verificada",
  prev: "← Anterior em {os}",
  next: "Seguinte em {os} →",
  sameSystem: "Outros testes no mesmo sistema",
  synthetic: "Perfil sintético: pessoa e ofício inventados, nenhum dado real.",
};

export const ROUND_PAGE_COPY: Record<Locale, RoundPageCopy> = { en, it, de, es, fr, hu, pt };
