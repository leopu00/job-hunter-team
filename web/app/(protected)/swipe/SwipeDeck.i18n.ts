// Dizionario di `SwipeDeck.tsx`.
//
// Le chiavi sono LOCALI a questo componente: lo stesso nome può valere
// tutt'altro altrove, quindi non vanno accorpate in un dizionario comune.
// `Record<Locale, …>` fa pretendere al compilatore tutte e sette le lingue:
// una voce a cui ne manca una non compila, invece di mostrare l'inglese
// all'utente sbagliato.
import type { Locale } from "@/i18n/config";
import type { Verdict } from "@/lib/position-verdict";

export const T: Record<
  Locale,
  {
    title: string;
    verdicts: Record<Verdict, string>;
    // O-77 — il pannello del motivo, chiesto DOPO il gesto negativo.
    // `whyDiscarded` è quello che si legge abbandonandolo: senza questa riga
    // un gesto non registrato sembrerebbe registrato.
    whyNo: string;
    whyPickPlaceholder: string;
    whyHintTaste: string;
    whyHintFactual: string;
    whyConfirmTaste: string;
    whyConfirmFactual: string;
    whyCancel: string;
    whySaveError: string;
    whyDiscarded: string;
    excludedStamp: string;
    btnPrev: string;
    commentPh: string;
    commentClose: string;
    commentTitle: string;
    commentDone: string;
    voiceStart: string;
    voiceStop: string;
    voiceListening: string;
    voiceError: string;
    voiceDenied: string;
    modePending: string;
    modeReviewed: string;
    reviewedEmpty: string;
    emptyTitle: string;
    emptySubtitle: string;
    allPositions: string;
    details: string;
    remote: Record<string, string>;
    saveError: string;
    hintKeys: string;
    today: string;
    yesterday: string;
    daysAgo: string; // template con {n}
    filters: string;
    fScore: string;
    fSalary: string;
    fCategory: string;
    fMode: string;
    fCountry: string;
    fCity: string;
    fSource: string;
    fReset: string;
    fCount: string; // template con {n}
    fNoResults: string;
    fSort: string;
    sortLabels: Record<string, string>;
  }
> = {
  it: {
    title: "Swipe",
    verdicts: {
      no: "Non interessante",
      review_low: "Poco interessante",
      review_ok: "Interessante",
      top: "Molto interessante",
    },
    whyNo: "Perché non ti interessa?",
    whyPickPlaceholder: "Scegli un motivo…",
    whyHintTaste: "Il team lo userà per cercarti offerte più adatte.",
    whyHintFactual:
      "La posizione esce dal giro e basta: una scaduta non dice cosa ti piace, quindi il team non impara niente da qui.",
    whyConfirmTaste: "Salva",
    whyConfirmFactual: "Escludi",
    whySaveError: "Non è stato registrato: riprova fra un momento.",
    whyCancel: "Annulla",
    whyDiscarded:
      "Senza motivo non registriamo niente: la posizione resta da giudicare.",
    excludedStamp: "Esclusa",
    btnPrev: "Precedente",
    commentPh: "Aggiungi un commento (facoltativo)…",
    commentClose: "Chiudi il commento",
    commentTitle: "Commento",
    commentDone: "Fatto",
    voiceStart: "Detta il commento",
    voiceStop: "Ferma la dettatura",
    voiceListening: "Ti ascolto…",
    voiceError: "Dettatura non disponibile su questo dispositivo",
    voiceDenied:
      "Permesso per il microfono negato — controlla le impostazioni del browser",
    modePending: "Da recensire",
    modeReviewed: "Recensite",
    reviewedEmpty: "Ancora nessuna posizione recensita.",
    emptyTitle: "Mazzo finito!",
    emptySubtitle: "Hai fatto il triage di tutte le posizioni in coda.",
    allPositions: "Tutte le posizioni",
    details: "Dettagli",
    remote: { full_remote: "Remoto", hybrid: "Ibrido", onsite: "In sede" },
    saveError: "Errore di rete — azione non salvata per",
    hintKeys: "Tastiera: 1–4 giudizio · ←/→ naviga",
    today: "oggi",
    yesterday: "ieri",
    daysAgo: "{n} giorni fa",
    filters: "Filtri",
    fScore: "Score",
    fSalary: "Stipendio (k€ / anno)",
    fCategory: "Categoria",
    fMode: "Modalità",
    fCountry: "Paese",
    fCity: "Città",
    fSource: "Fonte",
    fReset: "Azzera filtri",
    fCount: "{n} posizioni",
    fNoResults: "Nessuna posizione corrisponde ai filtri.",
    fSort: "Ordinamento",
    sortLabels: {
      oldest: "Meno recenti prima",
      newest: "Più recenti prima",
      score_desc: "Score: dal più alto",
      score_asc: "Score: dal più basso",
      salary_desc: "Stipendio: dal più alto",
      shuffle: "Casuale (shuffle)",
    },
  },
  en: {
    title: "Swipe",
    verdicts: {
      no: "Not interesting",
      review_low: "Slightly interesting",
      review_ok: "Interesting",
      top: "Very interesting",
    },
    whyNo: "Why is it not interesting?",
    whyPickPlaceholder: "Pick a reason…",
    whyHintTaste:
      "The team will use it to look for offers that fit you better.",
    whyHintFactual:
      "The position simply leaves the pipeline: an expired one says nothing about your taste, so the team learns nothing from this.",
    whyConfirmTaste: "Save",
    whyConfirmFactual: "Exclude",
    whySaveError: "It was not recorded: try again in a moment.",
    whyCancel: "Cancel",
    whyDiscarded:
      "Without a reason nothing is recorded: the position is still waiting for your verdict.",
    excludedStamp: "Excluded",
    btnPrev: "Previous",
    commentPh: "Add a comment (optional)…",
    commentClose: "Close the comment",
    commentTitle: "Comment",
    commentDone: "Done",
    voiceStart: "Dictate the comment",
    voiceStop: "Stop dictation",
    voiceListening: "Listening…",
    voiceError: "Dictation not available on this device",
    voiceDenied: "Microphone permission denied — check your browser settings",
    modePending: "To review",
    modeReviewed: "Reviewed",
    reviewedEmpty: "No reviewed positions yet.",
    emptyTitle: "Deck finished!",
    emptySubtitle: "You triaged every queued position.",
    allPositions: "All positions",
    details: "Details",
    remote: { full_remote: "Remote", hybrid: "Hybrid", onsite: "On-site" },
    saveError: "Network error — action not saved for",
    hintKeys: "Keyboard: 1–4 verdict · ←/→ navigate",
    today: "today",
    yesterday: "yesterday",
    daysAgo: "{n} days ago",
    filters: "Filters",
    fScore: "Score",
    fSalary: "Salary (k€ / yr)",
    fCategory: "Category",
    fMode: "Work mode",
    fCountry: "Country",
    fCity: "City",
    fSource: "Source",
    fReset: "Reset filters",
    fCount: "{n} positions",
    fNoResults: "No positions match the filters.",
    fSort: "Sorting",
    sortLabels: {
      oldest: "Oldest first",
      newest: "Newest first",
      score_desc: "Score: highest first",
      score_asc: "Score: lowest first",
      salary_desc: "Salary: highest first",
      shuffle: "Random (shuffle)",
    },
  },
  hu: {
    title: "Swipe",
    verdicts: {
      no: "Nem érdekes",
      review_low: "Kevéssé érdekes",
      review_ok: "Érdekes",
      top: "Nagyon érdekes",
    },
    whyNo: "Miért nem érdekes?",
    whyPickPlaceholder: "Válassz okot…",
    whyHintTaste:
      "A csapat ezt használja majd, hogy hozzád jobban illő ajánlatokat keressen.",
    whyHintFactual:
      "Az állás egyszerűen kikerül a körből: egy lejárt hirdetés nem árul el semmit az ízlésedről, így a csapat nem tanul belőle.",
    whyConfirmTaste: "Mentés",
    whyConfirmFactual: "Kizárás",
    whySaveError: "Nem lett rögzítve: próbáld újra egy pillanat múlva.",
    whyCancel: "Mégse",
    whyDiscarded:
      "Ok nélkül semmit sem rögzítünk: az állás továbbra is megítélésre vár.",
    excludedStamp: "Kizárva",
    btnPrev: "Előző",
    commentPh: "Megjegyzés hozzáadása (opcionális)…",
    commentClose: "Megjegyzés bezárása",
    commentTitle: "Megjegyzés",
    commentDone: "Kész",
    voiceStart: "Megjegyzés diktálása",
    voiceStop: "Diktálás leállítása",
    voiceListening: "Hallgatlak…",
    voiceError: "A diktálás nem érhető el ezen az eszközön",
    voiceDenied:
      "Mikrofonengedély megtagadva — ellenőrizd a böngésző beállításait",
    modePending: "Elbírálandó",
    modeReviewed: "Elbírált",
    reviewedEmpty: "Még nincs elbírált pozíció.",
    emptyTitle: "A pakli elfogyott!",
    emptySubtitle: "Minden sorban álló állást átnéztél.",
    allPositions: "Összes állás",
    details: "Részletek",
    remote: { full_remote: "Távoli", hybrid: "Hibrid", onsite: "Helyszíni" },
    saveError: "Hálózati hiba — nem mentett művelet:",
    hintKeys: "Billentyűk: 1–4 ítélet · ←/→ navigálás",
    today: "ma",
    yesterday: "tegnap",
    daysAgo: "{n} napja",
    filters: "Szűrők",
    fScore: "Pontszám",
    fSalary: "Fizetés (k€ / év)",
    fCategory: "Kategória",
    fMode: "Munkavégzés",
    fCountry: "Ország",
    fCity: "Város",
    fSource: "Forrás",
    fReset: "Szűrők törlése",
    fCount: "{n} pozíció",
    fNoResults: "Nincs a szűrőknek megfelelő pozíció.",
    fSort: "Rendezés",
    sortLabels: {
      oldest: "Legrégebbi elöl",
      newest: "Legújabb elöl",
      score_desc: "Pontszám: legmagasabb elöl",
      score_asc: "Pontszám: legalacsonyabb elöl",
      salary_desc: "Fizetés: legmagasabb elöl",
      shuffle: "Véletlenszerű (shuffle)",
    },
  },
  es: {
    title: "Swipe",
    verdicts: {
      no: "No interesante",
      review_low: "Poco interesante",
      review_ok: "Interesante",
      top: "Muy interesante",
    },
    whyNo: "¿Por qué no te interesa?",
    whyPickPlaceholder: "Elige un motivo…",
    whyHintTaste: "El equipo lo usará para buscarte ofertas que encajen mejor.",
    whyHintFactual:
      "La posición sale del circuito y ya está: una caducada no dice qué te gusta, así que el equipo no aprende nada de aquí.",
    whyConfirmTaste: "Guardar",
    whyConfirmFactual: "Excluir",
    whySaveError: "No se ha registrado: inténtalo de nuevo en un momento.",
    whyCancel: "Cancelar",
    whyDiscarded:
      "Sin motivo no registramos nada: la posición sigue pendiente de tu juicio.",
    excludedStamp: "Excluida",
    btnPrev: "Anterior",
    commentPh: "Añade un comentario (opcional)…",
    commentClose: "Cerrar el comentario",
    commentTitle: "Comentario",
    commentDone: "Hecho",
    voiceStart: "Dictar el comentario",
    voiceStop: "Detener el dictado",
    voiceListening: "Escuchando…",
    voiceError: "Dictado no disponible en este dispositivo",
    voiceDenied:
      "Permiso de micrófono denegado — revisa la configuración del navegador",
    modePending: "Por revisar",
    modeReviewed: "Revisadas",
    reviewedEmpty: "Aún no hay posiciones revisadas.",
    emptyTitle: "¡Mazo terminado!",
    emptySubtitle: "Has revisado todas las posiciones en cola.",
    allPositions: "Todas las posiciones",
    details: "Detalles",
    remote: { full_remote: "Remoto", hybrid: "Híbrido", onsite: "Presencial" },
    saveError: "Error de red — acción no guardada para",
    hintKeys: "Teclado: 1–4 juicio · ←/→ navegar",
    today: "hoy",
    yesterday: "ayer",
    daysAgo: "hace {n} días",
    filters: "Filtros",
    fScore: "Puntuación",
    fSalary: "Salario (k€ / año)",
    fCategory: "Categoría",
    fMode: "Modalidad",
    fCountry: "País",
    fCity: "Ciudad",
    fSource: "Fuente",
    fReset: "Restablecer filtros",
    fCount: "{n} posiciones",
    fNoResults: "Ninguna posición coincide con los filtros.",
    fSort: "Orden",
    sortLabels: {
      oldest: "Más antiguas primero",
      newest: "Más recientes primero",
      score_desc: "Puntuación: de mayor a menor",
      score_asc: "Puntuación: de menor a mayor",
      salary_desc: "Salario: de mayor a menor",
      shuffle: "Aleatorio (shuffle)",
    },
  },
  de: {
    title: "Swipe",
    verdicts: {
      no: "Uninteressant",
      review_low: "Wenig interessant",
      review_ok: "Interessant",
      top: "Sehr interessant",
    },
    whyNo: "Warum ist sie nicht interessant?",
    whyPickPlaceholder: "Grund auswählen…",
    whyHintTaste:
      "Das Team nutzt ihn, um passendere Stellen für dich zu suchen.",
    whyHintFactual:
      "Die Stelle fällt einfach aus dem Umlauf: Eine abgelaufene sagt nichts über deinen Geschmack, das Team lernt hier also nichts.",
    whyConfirmTaste: "Speichern",
    whyConfirmFactual: "Ausschließen",
    whySaveError: "Es wurde nicht gespeichert: Bitte gleich erneut versuchen.",
    whyCancel: "Abbrechen",
    whyDiscarded:
      "Ohne Grund wird nichts gespeichert: Die Stelle wartet weiter auf dein Urteil.",
    excludedStamp: "Ausgeschlossen",
    btnPrev: "Zurück",
    commentPh: "Kommentar hinzufügen (optional)…",
    commentClose: "Kommentar schließen",
    commentTitle: "Kommentar",
    commentDone: "Fertig",
    voiceStart: "Kommentar diktieren",
    voiceStop: "Diktat beenden",
    voiceListening: "Ich höre zu…",
    voiceError: "Diktat auf diesem Gerät nicht verfügbar",
    voiceDenied: "Mikrofonzugriff verweigert — prüfe die Browser-Einstellungen",
    modePending: "Zu bewerten",
    modeReviewed: "Bewertet",
    reviewedEmpty: "Noch keine bewerteten Stellen.",
    emptyTitle: "Stapel geschafft!",
    emptySubtitle: "Du hast alle anstehenden Stellen durchgesehen.",
    allPositions: "Alle Stellen",
    details: "Details",
    remote: { full_remote: "Remote", hybrid: "Hybrid", onsite: "Vor Ort" },
    saveError: "Netzwerkfehler — Aktion nicht gespeichert für",
    hintKeys: "Tastatur: 1–4 Urteil · ←/→ navigieren",
    today: "heute",
    yesterday: "gestern",
    daysAgo: "vor {n} Tagen",
    filters: "Filter",
    fScore: "Score",
    fSalary: "Gehalt (k€ / Jahr)",
    fCategory: "Kategorie",
    fMode: "Arbeitsmodus",
    fCountry: "Land",
    fCity: "Stadt",
    fSource: "Quelle",
    fReset: "Filter zurücksetzen",
    fCount: "{n} Stellen",
    fNoResults: "Keine Stellen entsprechen den Filtern.",
    fSort: "Sortierung",
    sortLabels: {
      oldest: "Älteste zuerst",
      newest: "Neueste zuerst",
      score_desc: "Score: höchste zuerst",
      score_asc: "Score: niedrigste zuerst",
      salary_desc: "Gehalt: höchstes zuerst",
      shuffle: "Zufällig (Shuffle)",
    },
  },
  fr: {
    title: "Swipe",
    verdicts: {
      no: "Pas intéressant",
      review_low: "Peu intéressant",
      review_ok: "Intéressant",
      top: "Très intéressant",
    },
    whyNo: "Pourquoi ne vous intéresse-t-il pas ?",
    whyPickPlaceholder: "Choisissez un motif…",
    whyHintTaste:
      "L'équipe s'en servira pour chercher des offres qui vous vont mieux.",
    whyHintFactual:
      "Le poste sort simplement du circuit : une offre expirée ne dit rien de vos goûts, l'équipe n'apprend donc rien d'ici.",
    whyConfirmTaste: "Enregistrer",
    whyConfirmFactual: "Exclure",
    whySaveError: "Rien n'a été enregistré : réessayez dans un instant.",
    whyCancel: "Annuler",
    whyDiscarded:
      "Sans motif, rien n'est enregistré : le poste attend toujours votre jugement.",
    excludedStamp: "Exclu",
    btnPrev: "Précédent",
    commentPh: "Ajouter un commentaire (facultatif)…",
    commentClose: "Fermer le commentaire",
    commentTitle: "Commentaire",
    commentDone: "Terminé",
    voiceStart: "Dicter le commentaire",
    voiceStop: "Arrêter la dictée",
    voiceListening: "Je vous écoute…",
    voiceError: "Dictée non disponible sur cet appareil",
    voiceDenied:
      "Autorisation du micro refusée — vérifiez les réglages du navigateur",
    modePending: "À évaluer",
    modeReviewed: "Évaluées",
    reviewedEmpty: "Aucun poste évalué pour l\u2019instant.",
    emptyTitle: "Paquet terminé !",
    emptySubtitle: "Vous avez trié tous les postes en attente.",
    allPositions: "Tous les postes",
    details: "Détails",
    remote: {
      full_remote: "Télétravail",
      hybrid: "Hybride",
      onsite: "Sur site",
    },
    saveError: "Erreur réseau — action non enregistrée pour",
    hintKeys: "Clavier : 1–4 avis · ←/→ naviguer",
    today: "aujourd’hui",
    yesterday: "hier",
    daysAgo: "il y a {n} jours",
    filters: "Filtres",
    fScore: "Score",
    fSalary: "Salaire (k€ / an)",
    fCategory: "Catégorie",
    fMode: "Mode de travail",
    fCountry: "Pays",
    fCity: "Ville",
    fSource: "Source",
    fReset: "Réinitialiser les filtres",
    fCount: "{n} postes",
    fNoResults: "Aucun poste ne correspond aux filtres.",
    fSort: "Tri",
    sortLabels: {
      oldest: "Plus anciens d'abord",
      newest: "Plus récents d'abord",
      score_desc: "Score : du plus haut",
      score_asc: "Score : du plus bas",
      salary_desc: "Salaire : du plus haut",
      shuffle: "Aléatoire (shuffle)",
    },
  },
  pt: {
    title: "Swipe",
    verdicts: {
      no: "Não interessante",
      review_low: "Pouco interessante",
      review_ok: "Interessante",
      top: "Muito interessante",
    },
    whyNo: "Porque não te interessa?",
    whyPickPlaceholder: "Escolhe um motivo…",
    whyHintTaste:
      "A equipa vai usá-lo para procurar ofertas que te encaixem melhor.",
    whyHintFactual:
      "A vaga sai do circuito e pronto: uma vaga expirada não diz o que gostas, por isso a equipa não aprende nada daqui.",
    whyConfirmTaste: "Guardar",
    whyConfirmFactual: "Excluir",
    whySaveError: "Não foi registado: tenta novamente dentro de instantes.",
    whyCancel: "Cancelar",
    whyDiscarded:
      "Sem motivo não registamos nada: a vaga continua à espera do teu juízo.",
    excludedStamp: "Excluída",
    btnPrev: "Anterior",
    commentPh: "Adicione um comentário (opcional)…",
    commentClose: "Fechar o comentário",
    commentTitle: "Comentário",
    commentDone: "Concluído",
    voiceStart: "Ditar o comentário",
    voiceStop: "Parar o ditado",
    voiceListening: "Ouvindo…",
    voiceError: "Ditado não disponível neste dispositivo",
    voiceDenied:
      "Permissão do microfone negada — verifique as configurações do navegador",
    modePending: "Por avaliar",
    modeReviewed: "Avaliadas",
    reviewedEmpty: "Ainda não há vagas avaliadas.",
    emptyTitle: "Baralho concluído!",
    emptySubtitle: "Você triou todas as vagas na fila.",
    allPositions: "Todas as vagas",
    details: "Detalhes",
    remote: { full_remote: "Remoto", hybrid: "Híbrido", onsite: "Presencial" },
    saveError: "Erro de rede — ação não salva para",
    hintKeys: "Teclado: 1–4 julgamento · ←/→ navegar",
    today: "hoje",
    yesterday: "ontem",
    daysAgo: "há {n} dias",
    filters: "Filtros",
    fScore: "Pontuação",
    fSalary: "Salário (k€ / ano)",
    fCategory: "Categoria",
    fMode: "Modalidade",
    fCountry: "País",
    fCity: "Cidade",
    fSource: "Fonte",
    fReset: "Repor filtros",
    fCount: "{n} vagas",
    fNoResults: "Nenhuma vaga corresponde aos filtros.",
    fSort: "Ordenação",
    sortLabels: {
      oldest: "Mais antigas primeiro",
      newest: "Mais recentes primeiro",
      score_desc: "Pontuação: da mais alta",
      score_asc: "Pontuação: da mais baixa",
      salary_desc: "Salário: do mais alto",
      shuffle: "Aleatório (shuffle)",
    },
  },
};
