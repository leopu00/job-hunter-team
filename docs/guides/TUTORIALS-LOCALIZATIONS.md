# Tutorials — UI localizations

This source supplies the six non-English versions of the text-first tutorials
in [TUTORIALS.md](TUTORIALS.md). It is for the public `/tutorials` UI: preserve
the `#game` and `#web` anchors, the order of the steps, and the text-before-
video structure in every language. The video wording stays conditional because
the public videos are not yet published.

## Italiano (`it`)

### Gioco (`#game`)

Il tutorial di gioco ti aiuta a esplorare l'ufficio nativo, a capire come il
lavoro attraversa il team e a controllare un risultato prima di decidere cosa
fare.

#### Pianifica il setup

Questo percorso parte dal download sul sito e termina con il team attivo: non
presuppone che l'app desktop o Docker siano già configurati. Prevedi tempo
prima di iniziare. In una prova end-to-end Linux + Docker misurata, dal doppio
clic sull'app scaricata al completamento dell'onboarding e al pannello Docker
post-onboarding sono trascorsi **32 minuti e 58 secondi**. La prova misurata
ha poi raggiunto un blocco durante l'autorizzazione del provider a **54 minuti
e 40 secondi** (`T0 + 54:40`). Hardware, velocità di download e Docker fanno
variare il risultato, ma non è un'operazione da cinque minuti.

#### Configura il team

1. **Scarica l'app desktop nativa.** Vai su
   [jobhunterteam.ai/download](https://jobhunterteam.ai/download), scegli
   **Desktop**, poi macOS, Windows o Linux. La pagina punta sempre alla release
   corrente per quella piattaforma.
2. **Apri il download per il tuo sistema.** Su Windows avvia
   `job-hunter-team.exe`; su macOS estrai `job-hunter-team.zip` e apri l'app;
   su Linux estrai `job-hunter-team-linux-x64.tar.gz` e avvia
   `job-hunter-team.x86_64`. Windows e Linux possono mostrare un avviso:
   prosegui solo se il download viene dal sito ufficiale o dalla release
   collegata.
3. **Entra nell'ufficio.** Al primo avvio, scegli e conferma la lingua
   dell'interfaccia prima della schermata iniziale: devi confermare la scelta,
   English è preselezionato e l'app la salva per le aperture successive. Poi
   inserisci il nome se vuoi ed entra nell'ufficio. Puoi esplorarlo prima del
   setup: conversazioni e posizioni di esempio non avviano un team dal vivo né
   usano un provider.
4. **Apri la checklist.** Seleziona **Attiva team**. Scegli un runtime locale o
   collega una VPS. Il runtime locale richiede Docker; su Windows Docker
   Desktop può richiedere consenso e primo avvio.
5. **Collega un provider.** Nel setup del Coordinatore scegli un provider in
   abbonamento e il piano, poi completa l'autorizzazione nel terminale
   integrato. Un link può aprirsi nel browser, ma codici e scelte restano nel
   terminale dell'ufficio.
6. **Completa il profilo.** Compila il profilo nativo: servono nome, email,
   ruolo desiderato, località, esperienza, seniority, almeno due competenze e
   almeno una lingua.
7. **Imposta gli orari di lavoro.** Scegli quando il team può lavorare. La
   checklist resta incompleta finché runtime, provider, profilo e orari non
   sono tutti pronti.
8. **Attiva il team.** Torna a **Attiva team** e completa le quattro porte. Il
   Coordinatore avvia gli agenti e nell'ufficio arrivano risposte e posizioni
   dal vivo.

#### Esplora un team attivo

1. **Conosci l'ufficio.** Apri l'ufficio nativo e seleziona un collega. La sua
   scheda mostra nome, stato corrente e responsabilità. Hai completato il passo
   quando riesci ad aprire una scheda e a tornare all'ufficio senza perdere il
   punto in cui eri.
2. **Capisci chi fa cosa.** I nomi dei reparti, sempre al plurale, che vedi in
   ufficio e nelle conversazioni sono **coordinatori, consulenti di
   supporto, consulenti di carriera, ricercatori, analisti, valutatori della
   compatibilità, redattori delle candidature e revisori**. I coordinatori
   mantengono il lavoro in movimento; i consulenti di supporto aiutano con il
   prodotto e il profilo; quelli di carriera aiutano a definire la direzione. I
   ricercatori trovano opportunità, gli analisti le verificano, i valutatori ne
   spiegano la compatibilità, i redattori preparano i documenti richiesti e i
   revisori controllano il lavoro prima che arrivi a te. Puoi continuare quando
   leggi la pipeline come una sequenza, non come conversazioni scollegate.
3. **Chiedi ai ricercatori.** Apri la chat con i ricercatori e chiedi che cosa
   sta cercando la ricerca corrente. Invia una domanda chiara. Il messaggio
   resta in quella conversazione e lì torna la risposta, quindi non può essere
   confuso con un altro thread. Il passo funziona quando il thread mostra sia
   la domanda sia la risposta.
4. **Segui la verifica.** Apri una conversazione con gli analisti oppure
   controlla l'attività di una posizione che ha superato la scoperta. Gli
   analisti controllano ruolo, organizzazione e dettagli prima che una
   posizione avanzi. Il passo funziona quando distingui un contatto trovato da
   un'opportunità verificata.
5. **Leggi la compatibilità.** Apri una conversazione con i valutatori della
   compatibilità oppure una posizione con punteggio. Confrontano l'opportunità
   con il tuo profilo e spiegano il punteggio. Il punteggio è una stima di
   compatibilità, non una decisione presa al posto tuo. Il passo funziona quando
   riconosci punteggio e spiegazione e puoi decidere se merita attenzione.
6. **Vedi l'intera pipeline.** Apri **Posizioni**, seleziona un risultato e
   leggi lo stato. **`new`** significa che i ricercatori l'hanno trovata e gli
   analisti la verificano dopo; **`checked`** significa che gli analisti hanno
   finito e i valutatori della compatibilità la valutano dopo; **`scored`**
   significa che hanno finito i valutatori, quindi puoi decidere o richiedere i
   documenti. Dopo la richiesta, **`writing`** significa che i redattori delle
   candidature li preparano, **`review`** che i revisori li controllano e
   **`ready`** che sono pronti per te. **`applied`** e **`response`**
   registrano la tua azione e il suo esito. Il passo funziona quando sai dire
   quale reparto è responsabile e qual è il prossimo evento per lo stato visibile.
7. **Esamina le posizioni.** Apri **Posizioni** e seleziona una buona
   corrispondenza. La scheda e il dettaglio mostrano ruolo, organizzazione,
   località, modalità di lavoro, punteggio e stato. Quando disponibili,
   mostrano anche i documenti di candidatura preparati. Il passo funziona
   quando apri un risultato, capisci perché è presente e torni alla lista.
8. **Decidi che cosa succede dopo.** Torna all'ufficio. I coordinatori
   mantengono le priorità in movimento, i consulenti di supporto ti aiutano a
   usare lo spazio di lavoro e a completare il profilo, mentre i consulenti di
   carriera aiutano con obiettivi e strategia. Esplora, chiedi, poi decidi: la
   scelta finale e ogni candidatura restano sotto la tua responsabilità.

#### Preferisci guardare il tutorial?

Quando il video sarà disponibile, potrai guardarlo come alternativa.

### Web (`#web`)

Il tutorial web ti aiuta a seguire il lavoro da qualunque browser autenticato,
a esaminare una posizione, a lasciare un riscontro e a mantenere separate le
conversazioni.

#### Prima di iniziare

Configura la sincronizzazione prima di accedere: nell'app desktop nativa apri
**Impostazioni**, poi **Account**, scegli **Accedi con Google**; nel terminale
che si apre, apri il link, inserisci il codice e approva questo dispositivo,
quindi scegli
**Sincronizza ora**. La riga **Account cloud** deve indicare **collegato** e la
riga **Dispositivo** deve indicare **associato**. Se il controllo di accesso non
è disponibile, avvia prima il team; se dopo l'approvazione l'account indica
ancora **modalità locale / ospite**, ripeti **Accedi con Google**. Poi accedi
all'app web con lo stesso account. Per provare tutti i passaggi, aspetta che
almeno una posizione abbia un punteggio. Una dashboard vuota significa
semplicemente che il team non ha ancora prodotto un risultato valutato.

1. **Parti dalla dashboard.** Apri **Dashboard**. Inizia dalle posizioni
   valutate più di recente, così i nuovi risultati non si perdono in un flusso
   di attività. Su uno schermo piccolo usa il menu di navigazione per arrivare
   alle stesse pagine. Il passo funziona quando vedi un risultato valutato nella
   lista della dashboard e lo apri.
2. **Leggi una posizione.** Apri una posizione dalla dashboard o da
   **Posizioni**. Il dettaglio mostra ruolo, località, modalità di lavoro,
   scomposizione del punteggio e stato della revisione o della candidatura.
   Leggi il punteggio con la sua spiegazione: è una stima di compatibilità, non
   un ordine di candidarti. Il passo funziona quando sai dire che cosa è la
   posizione, come corrisponde al tuo profilo e a quale fase è arrivata.
3. **Lascia un riscontro utile in Scorri.** Apri **Scorri** per valutare una
   posizione alla volta. Usa i pulsanti di decisione per registrare quanto ti
   interessa; trascinare a sinistra o a destra serve solo a passare tra le
   schede. Scegliere **Non mi interessa** esclude quella posizione dal lavoro
   successivo e puoi correggere una decisione precedente. Il passo funziona
   quando appare la scheda successiva e quella esaminata conserva la tua scelta.
4. **Controlla l'attività del team.** Apri **Team**. La vista attività mostra
   ciò che accade dopo e attribuisce il lavoro alla parte pertinente del team.
   I ricercatori trovano opportunità, gli analisti le verificano, i valutatori
   della compatibilità classificano l'affinità, i redattori delle candidature
   preparano i documenti richiesti e i revisori li controllano. Il passo
   funziona quando colleghi un'attività o uno stato al suo punto nella pipeline.
5. **Mantieni separate le conversazioni.** Apri **Messaggi** e seleziona una
   conversazione. I consulenti di supporto rispondono alle domande sul prodotto
   e sul profilo; i consulenti di carriera si occupano di obiettivi e strategia;
   i coordinatori mantengono le priorità in movimento. Ognuno ha il proprio
   thread. Il passo funziona quando cambiare conversazione cambia il thread,
   senza mescolare le risposte.
6. **Invia un messaggio e segui la consegna.** Scegli i consulenti di supporto,
   scrivi una domanda breve e inviala. Il messaggio compare subito in quel
   thread e mantiene uno stato di consegna visibile; la risposta torna nella
   stessa conversazione. Il passo funziona quando vedi messaggio, avanzamento
   della consegna e risposta senza lasciare il thread.
7. **Concludi con una decisione informata.** Torna alla posizione più
   importante. Usa ruolo, spiegazione della compatibilità, stato, il tuo
   riscontro in Scorri e il contesto del team per decidere che cosa fare dopo.
   L'app web ti aiuta a esaminare e comunicare; la decisione finale resta tua.

#### Preferisci guardare il tutorial?

Quando il video sarà disponibile, potrai guardarlo come alternativa.

## Español (`es`)

### Juego (`#game`)

El tutorial de juego te ayuda a explorar la oficina nativa, entender cómo el
trabajo avanza por el equipo e inspeccionar un resultado antes de decidir qué
hacer.

#### Planifica la configuración

Este recorrido comienza con la descarga del sitio y termina con el equipo
activo; no presupone que la aplicación de escritorio ni Docker estén
configurados. Reserva tiempo antes de empezar. En una ejecución end-to-end
medida con Linux + Docker, desde el doble clic en la aplicación descargada
hasta completar el onboarding y llegar al panel de configuración de Docker
transcurrieron **32 minutos y 58 segundos**. La ejecución medida llegó después
a un bloqueo de autorización del proveedor a los **54 minutos y 40 segundos**
(`T0 + 54:40`). El hardware, la descarga y Docker cambian el resultado, pero
no es una tarea de cinco minutos.

#### Configura el equipo

1. **Descarga la aplicación de escritorio nativa.** Ve a
   [jobhunterteam.ai/download](https://jobhunterteam.ai/download), elige
   **Desktop** y luego macOS, Windows o Linux. La página siempre enlaza la
   versión actual para esa plataforma.
2. **Abre la descarga para tu sistema.** En Windows ejecuta
   `job-hunter-team.exe`; en macOS descomprime `job-hunter-team.zip` y abre la
   aplicación; en Linux extrae `job-hunter-team-linux-x64.tar.gz` y ejecuta
   `job-hunter-team.x86_64`. Windows y Linux pueden mostrar un aviso: continúa
   solo si descargaste desde el sitio oficial o desde la versión enlazada.
3. **Entra en la oficina.** En el primer inicio, elige y confirma el idioma de
   la interfaz antes de la pantalla inicial: debes confirmar la elección,
   English está preseleccionado y la aplicación la guarda para las siguientes
   aperturas. Después añade tu nombre si quieres y entra en la oficina. Puedes
   explorarla antes de configurarla: las conversaciones y posiciones de ejemplo
   no inician un equipo real ni usan un proveedor.
4. **Abre la lista de configuración.** Selecciona **Activar equipo**. Elige un
   runtime local o conecta una VPS. El runtime local necesita Docker; en
   Windows Docker Desktop puede requerir consentimiento y su primer inicio.
5. **Conecta un proveedor.** En la configuración del Coordinador selecciona un
   proveedor de suscripción y su plan, y completa la autorización en el
   terminal integrado. Un enlace puede abrirse en el navegador, pero los
   códigos y las opciones quedan en el terminal de la oficina.
6. **Completa el perfil.** Rellena el perfil nativo: se necesitan nombre,
   correo, puesto objetivo, ubicación, experiencia, seniority, al menos dos
   habilidades y un idioma.
7. **Define el horario de trabajo.** Elige cuándo puede trabajar el equipo. La
   lista no queda completa hasta que runtime, proveedor, perfil y horario estén
   listos.
8. **Activa el equipo.** Vuelve a **Activar equipo** y completa las cuatro
   puertas. El Coordinador inicia a los agentes y la oficina recibe respuestas
   y posiciones en vivo.

#### Explora un equipo activo

1. **Conoce la oficina.** Abre la oficina nativa y selecciona a cualquier
   colega. Su tarjeta muestra un nombre, el estado actual y su responsabilidad.
   Has completado este paso cuando puedes abrir una tarjeta y volver a la
   oficina sin perder tu lugar.
2. **Entiende quién hace qué.** Los nombres de los departamentos, siempre en
   plural, que ves en la oficina y las conversaciones son **coordinadores, asesores de
   asistencia, asesores profesionales, investigadores, analistas, evaluadores
   de compatibilidad, redactores de candidaturas y revisores**. Los
   coordinadores hacen que el trabajo avance; los asesores de asistencia ayudan
   con el producto y tu perfil; los asesores profesionales ayudan con la
   dirección. Los investigadores encuentran oportunidades, los analistas las
   verifican, los evaluadores explican la compatibilidad, los redactores
   preparan los documentos solicitados y los revisores comprueban el trabajo
   antes de que llegue a ti. Continúa cuando puedas leer la canalización como
   una secuencia y no como conversaciones sin relación.
3. **Pregunta a los investigadores.** Abre el chat con los investigadores y
   pregunta qué busca la búsqueda actual. Envía una pregunta clara. Tu mensaje
   permanece en esa conversación y la respuesta vuelve allí, por lo que no se
   confunde con otro hilo. El paso funciona cuando el hilo muestra tu pregunta
   y su respuesta.
4. **Sigue la verificación.** Abre una conversación con los analistas o
   consulta la actividad de una posición que haya avanzado desde el
   descubrimiento. Los analistas comprueban el puesto, la organización y los
   detalles antes de que la posición avance. El paso funciona cuando distingues
   una pista encontrada de una oportunidad verificada.
5. **Lee la compatibilidad.** Abre una conversación con los evaluadores de
   compatibilidad o una posición puntuada. Comparan la oportunidad con tu
   perfil y explican la puntuación. Una puntuación es una estimación de
   compatibilidad, no una decisión tomada por ti. El paso funciona cuando
   identificas la puntuación y su explicación y decides si merece atención.
6. **Ve toda la canalización.** Abre **Posiciones**, selecciona un resultado y
   lee su estado. **`new`** significa que los investigadores lo encontraron y
   los analistas lo verifican después; **`checked`** significa que los analistas
   terminaron y los evaluadores de compatibilidad lo puntúan después; **`scored`**
   significa que los evaluadores terminaron, así que puedes decidir o solicitar
   documentos. Tras tu solicitud, **`writing`** significa que los redactores de
   candidaturas los preparan, **`review`** que los revisores los comprueban y
   **`ready`** que están listos para ti. **`applied`** y **`response`** registran
   tu acción y su resultado. El paso funciona cuando puedes nombrar el
   departamento responsable y el siguiente evento del estado visible.
7. **Inspecciona posiciones.** Abre **Posiciones** y selecciona una buena
   coincidencia. La tarjeta y el detalle muestran puesto, organización,
   ubicación, modalidad de trabajo, puntuación y estado. Cuando están
   disponibles, también muestran los documentos de candidatura preparados. El
   paso funciona cuando puedes abrir un resultado, entender por qué está ahí y
   volver a la lista.
8. **Decide qué ocurre después.** Vuelve a la oficina. Los coordinadores
   mantienen las prioridades en marcha, los asesores de asistencia te ayudan a
   usar el espacio de trabajo y completar tu perfil, y los asesores
   profesionales ayudan con objetivos y estrategia. Explora, pregunta y luego
   decide: la elección final y cualquier candidatura siguen siendo tuyas.

#### ¿Prefieres ver el tutorial?

Cuando el vídeo esté disponible, podrás verlo como alternativa.

### Web (`#web`)

El tutorial web te ayuda a seguir el trabajo desde cualquier navegador con la
sesión iniciada, inspeccionar una posición, dar tu opinión y mantener separadas
las conversaciones.

#### Antes de empezar

Configura la sincronización antes de iniciar sesión: en la aplicación de
escritorio nativa abre **Ajustes** y luego **Cuenta**, elige **Entrar con
Google**; en el terminal que se abre, abre el enlace, introduce el código y
aprueba este dispositivo, y después elige **Sincronizar ahora**. La fila
**Cuenta cloud** debe indicar
**conectada** y la fila **Dispositivo**, **asociado**. Si el control de acceso
no está disponible, inicia primero el equipo; si tras aprobarlo la cuenta sigue
indicando **modo local / invitado**, repite **Entrar con Google**. Después inicia
sesión en la aplicación web con la misma cuenta. Para practicar todos los
pasos, espera a que al menos una posición tenga una puntuación. Un panel vacío
simplemente significa que el equipo aún no ha producido un resultado puntuado.

1. **Empieza en el panel.** Abre **Panel**. Empieza con las posiciones
   puntuadas más recientes, para que los resultados nuevos no se oculten en un
   flujo de actividad. En una pantalla pequeña, usa el menú de navegación para
   llegar a las mismas páginas. El paso funciona cuando ves un resultado
   puntuado en la lista del panel y puedes abrirlo.
2. **Lee una posición.** Abre una posición desde el panel o **Posiciones**. El
   detalle muestra el puesto, la ubicación, la modalidad de trabajo, el desglose
   de la puntuación y el estado de revisión o candidatura. Lee la puntuación
   junto con su explicación: es una estimación de compatibilidad, no una orden
   de presentarte. El paso funciona cuando puedes explicar qué es la posición,
   cómo encaja contigo y a qué fase ha llegado.
3. **Da una opinión útil en Deslizar.** Abre **Deslizar** para revisar una
   posición cada vez. Usa los botones de decisión para registrar cuánto te
   interesa; arrastrar a izquierda o derecha solo cambia de tarjeta. Elegir
   **No me interesa** excluye esa posición del trabajo posterior y puedes
   revisar una decisión anterior. El paso funciona cuando aparece la siguiente
   tarjeta y la revisada conserva tu decisión.
4. **Consulta la actividad del equipo.** Abre **Equipo**. La vista de actividad
   muestra qué sucede después y atribuye el trabajo a la parte correspondiente
   del equipo. Los investigadores encuentran oportunidades, los analistas las
   verifican, los evaluadores de compatibilidad clasifican el encaje, los
   redactores de candidaturas preparan los documentos solicitados y los
   revisores los comprueban. El paso funciona cuando relacionas una actividad o
   un estado con su lugar en la canalización.
5. **Mantén las conversaciones separadas.** Abre **Mensajes** y selecciona una
   conversación. Los asesores de asistencia responden preguntas sobre el
   producto y tu perfil; los asesores profesionales se centran en objetivos y
   estrategia de carrera; los coordinadores mantienen las prioridades en
   marcha. Cada uno tiene su propio hilo. El paso funciona cuando al cambiar de
   conversación cambia el hilo sin mezclar respuestas.
6. **Envía un mensaje y sigue su entrega.** Elige a los asesores de asistencia,
   escribe una pregunta breve y envíala. El mensaje aparece inmediatamente en
   ese hilo y conserva un estado de entrega visible; la respuesta vuelve a la
   misma conversación. El paso funciona cuando ves el mensaje, el progreso de
   entrega y la respuesta sin salir del hilo.
7. **Termina con una decisión informada.** Vuelve a la posición que más te
   importa. Usa su puesto, explicación de compatibilidad, estado, tu opinión en
   Deslizar y el contexto del equipo para decidir qué quieres hacer después. La
   aplicación web te ayuda a inspeccionar y comunicarte; la decisión final es
   tuya.

#### ¿Prefieres ver el tutorial?

Cuando el vídeo esté disponible, podrás verlo como alternativa.

## Français (`fr`)

### Jeu (`#game`)

Le tutoriel de jeu vous aide à explorer le bureau natif, à comprendre comment
le travail circule dans l'équipe et à examiner un résultat avant de décider de
la suite.

#### Planifiez la configuration

Ce parcours commence par le téléchargement sur le site et se termine avec
l'équipe active : il ne suppose pas que l'application de bureau ou Docker sont
déjà configurés. Prévoyez du temps avant de commencer. Lors d'un parcours
end-to-end Linux + Docker mesuré, **32 minutes et 58 secondes** se sont
écoulées entre le double-clic sur l'application téléchargée, la fin de
l'onboarding et l'arrivée au panneau de configuration Docker. Ce parcours
mesuré a ensuite atteint un blocage d'autorisation du fournisseur à **54
minutes et 40 secondes** (`T0 + 54:40`). Le matériel, le téléchargement et
Docker font varier ce résultat, mais ce n'est pas une tâche de cinq minutes.

#### Configurez l'équipe

1. **Téléchargez l'application de bureau native.** Allez sur
   [jobhunterteam.ai/download](https://jobhunterteam.ai/download), choisissez
   **Desktop**, puis macOS, Windows ou Linux. La page renvoie toujours vers la
   version actuelle pour cette plateforme.
2. **Ouvrez le téléchargement pour votre système.** Sous Windows, lancez
   `job-hunter-team.exe` ; sous macOS, décompressez `job-hunter-team.zip` et
   ouvrez l'application ; sous Linux, extrayez
   `job-hunter-team-linux-x64.tar.gz` puis lancez
   `job-hunter-team.x86_64`. Windows et Linux peuvent afficher un avertissement
   : continuez uniquement si le téléchargement vient du site officiel ou de la
   version liée.
3. **Entrez dans le bureau.** Lors du premier lancement, choisissez et
   confirmez la langue de l'interface avant l'écran de départ : vous devez
   confirmer ce choix, English est présélectionné et l'application le mémorise
   pour les ouvertures suivantes. Ajoutez ensuite votre nom si vous le souhaitez
   puis entrez dans le bureau. Vous pouvez l'explorer avant la configuration :
   les conversations et positions d'exemple ne lancent pas une équipe en direct
   et n'utilisent pas de fournisseur.
4. **Ouvrez la liste de configuration.** Sélectionnez **Activer l'équipe**.
   Choisissez un runtime local ou connectez un VPS. Le runtime local nécessite
   Docker ; sous Windows, Docker Desktop peut demander son consentement et son
   premier démarrage.
5. **Connectez un fournisseur.** Dans la configuration du Coordinateur,
   sélectionnez un fournisseur par abonnement et son forfait, puis terminez
   l'autorisation dans le terminal intégré. Un lien peut s'ouvrir dans le
   navigateur, mais les codes et choix restent dans le terminal du bureau.
6. **Complétez le profil.** Renseignez le profil natif : nom, e-mail, poste
   visé, lieu, expérience, niveau, au moins deux compétences et une langue
   sont requis.
7. **Définissez les heures de travail.** Choisissez quand l'équipe peut
   travailler. La liste reste incomplète tant que runtime, fournisseur, profil
   et horaires ne sont pas tous prêts.
8. **Activez l'équipe.** Revenez à **Activer l'équipe** et terminez les quatre
   conditions. Le Coordinateur démarre les agents et le bureau reçoit les
   réponses et positions en direct.

#### Explorez une équipe active

1. **Découvrez le bureau.** Ouvrez le bureau natif et sélectionnez n'importe
   quel collègue. Sa fiche affiche un nom, son état actuel et sa
   responsabilité. Cette étape est terminée lorsque vous pouvez ouvrir une
   fiche puis revenir au bureau sans perdre votre place.
2. **Comprenez qui fait quoi.** Les noms de départements, toujours au pluriel,
   que vous voyez dans le bureau et les conversations sont **coordinateurs,
   conseillers d'assistance, conseillers de carrière, chercheurs, analystes,
   évaluateurs de compatibilité, rédacteurs de candidatures et réviseurs**. Les
   coordinateurs font avancer le travail ; les conseillers d'assistance aident
   avec le produit et votre profil ; les conseillers de carrière aident à fixer
   la direction. Les chercheurs trouvent les opportunités, les analystes les
   vérifient, les évaluateurs expliquent la compatibilité, les rédacteurs
   préparent les documents demandés et les réviseurs contrôlent le travail avant
   qu'il ne vous arrive. Vous pouvez continuer lorsque vous lisez le pipeline
   comme une séquence plutôt que comme des conversations isolées.
3. **Demandez aux chercheurs.** Ouvrez la conversation avec les chercheurs et
   demandez ce que recherche la prospection en cours. Envoyez une question
   claire. Votre message reste dans cette conversation et la réponse y revient,
   sans pouvoir être confondue avec un autre fil. L'étape fonctionne lorsque le
   fil affiche votre question et sa réponse.
4. **Suivez la vérification.** Ouvrez une conversation avec les analystes ou
   consultez l'activité d'une position qui a dépassé la découverte. Les
   analystes vérifient le poste, l'organisation et les détails avant qu'une
   position progresse. L'étape fonctionne lorsque vous distinguez une piste
   trouvée d'une opportunité vérifiée.
5. **Lisez la compatibilité.** Ouvrez une conversation avec les évaluateurs de
   compatibilité ou une position notée. Ils comparent l'opportunité à votre
   profil et expliquent la note. Une note est une estimation de compatibilité,
   pas une décision prise à votre place. L'étape fonctionne lorsque vous
   repérez la note et son explication, puis décidez si l'opportunité mérite
   votre attention.
6. **Voyez tout le pipeline.** Ouvrez **Positions**, sélectionnez un résultat
   et lisez son état. **`new`** signifie que les chercheurs l'ont trouvé et que
   les analystes le vérifient ensuite ; **`checked`** signifie que les analystes
   ont fini et que les évaluateurs de compatibilité le notent ensuite ;
   **`scored`** signifie que les évaluateurs ont fini : vous pouvez décider ou
   demander des documents. Après votre demande, **`writing`** signifie que les
   rédacteurs de candidatures les préparent, **`review`** que les réviseurs les
   contrôlent et **`ready`** qu'ils sont prêts pour vous. **`applied`** et
   **`response`** enregistrent votre action et son résultat. L'étape fonctionne
   lorsque vous pouvez nommer le département responsable et l'événement suivant
   pour l'état visible.
7. **Examinez les positions.** Ouvrez **Positions** et sélectionnez une bonne
   correspondance. Sa fiche et son détail affichent le poste, l'organisation,
   le lieu, le mode de travail, la note et l'état. Lorsqu'ils sont disponibles,
   les documents de candidature préparés apparaissent aussi. L'étape fonctionne
   lorsque vous pouvez ouvrir un résultat, comprendre pourquoi il est là et
   revenir à la liste.
8. **Décidez de la suite.** Revenez au bureau. Les coordinateurs font avancer
   les priorités, les conseillers d'assistance vous aident à utiliser l'espace
   de travail et à compléter votre profil, et les conseillers de carrière vous
   aident avec vos objectifs et votre stratégie. Explorez, demandez, puis
   décidez : le choix final et toute candidature restent de votre ressort.

#### Vous préférez regarder le tutoriel ?

Lorsque la vidéo sera disponible, vous pourrez la regarder comme alternative.

### Web (`#web`)

Le tutoriel web vous aide à suivre le travail depuis tout navigateur connecté,
à examiner une position, à donner votre avis et à garder les conversations
séparées.

#### Avant de commencer

Configurez la synchronisation avant de vous connecter : dans l'application de
bureau native, ouvrez **Paramètres**, puis **Compte**, choisissez **Se connecter
avec Google** ; dans le terminal qui s'ouvre, ouvrez le lien, saisissez le
code et approuvez cet appareil, puis choisissez **Synchroniser maintenant**.
La ligne **Compte cloud** doit
indiquer **connecté** et la ligne **Appareil**, **associé**. Si le contrôle de
connexion est indisponible, démarrez d'abord l'équipe ; si le compte indique
encore **mode local / invité** après l'approbation, recommencez **Se connecter
avec Google**. Connectez-vous ensuite à l'application web avec le même compte.
Pour pratiquer toutes les étapes, attendez qu'au moins une position ait une
note. Un tableau de bord vide signifie simplement que l'équipe n'a pas encore
produit de résultat noté.

1. **Commencez par le tableau de bord.** Ouvrez **Dashboard**. Il commence par
   les positions les plus récemment notées, afin que les nouveaux résultats ne
   se cachent pas dans un flux d'activité. Sur petit écran, utilisez le menu de
   navigation pour atteindre les mêmes pages. L'étape fonctionne lorsque vous
   voyez un résultat noté dans la liste du tableau de bord et pouvez l'ouvrir.
2. **Lisez une position.** Ouvrez une position depuis le tableau de bord ou
   **Positions**. Son détail donne le poste, le lieu, le mode de travail, le
   détail de la note et l'état de la révision ou de la candidature. Lisez la
   note avec son explication : c'est une estimation de compatibilité, pas une
   instruction de postuler. L'étape fonctionne lorsque vous pouvez dire ce
   qu'est la position, comment elle vous correspond et à quelle étape elle est.
3. **Donnez un avis utile dans Swipe.** Ouvrez **Swipe** pour examiner une
   position à la fois. Utilisez les boutons de décision pour indiquer votre
   intérêt ; faire glisser à gauche ou à droite sert seulement à passer d'une
   carte à l'autre. Choisir **Pas intéressé** écarte cette position du travail
   ultérieur et vous pouvez réviser un jugement précédent. L'étape fonctionne
   lorsque la carte suivante apparaît et que la carte examinée conserve votre
   décision.
4. **Vérifiez l'activité de l'équipe.** Ouvrez **Team**. Sa vue d'activité
   montre ce qui se passe ensuite et attribue le travail à la partie concernée
   de l'équipe. Les chercheurs trouvent les opportunités, les analystes les
   vérifient, les évaluateurs de compatibilité classent l'adéquation, les
   rédacteurs de candidatures préparent les documents demandés et les réviseurs
   les contrôlent. L'étape fonctionne lorsque vous reliez une activité ou un
   état à sa place dans le pipeline.
5. **Gardez les conversations séparées.** Ouvrez **Messages** et sélectionnez
   une conversation. Les conseillers d'assistance répondent aux questions sur
   le produit et votre profil ; les conseillers de carrière se concentrent sur
   les objectifs et la stratégie de carrière ; les coordinateurs font avancer
   les priorités. Chacun possède son propre fil. L'étape fonctionne lorsque
   changer de conversation change le fil sans mélanger les réponses.
6. **Envoyez un message et suivez sa livraison.** Choisissez les conseillers
   d'assistance, écrivez une question courte et envoyez-la. Le message apparaît
   aussitôt dans ce fil et conserve un état de livraison visible ; la réponse
   revient dans la même conversation. L'étape fonctionne lorsque vous voyez le
   message, sa progression de livraison et la réponse sans quitter le fil.
7. **Terminez par une décision informée.** Revenez à la position qui compte le
   plus. Utilisez son poste, son explication de compatibilité, son état, votre
   avis dans Swipe et le contexte de l'équipe pour décider de la suite. L'app
   web vous aide à examiner et à communiquer ; la décision finale reste la
   vôtre.

#### Vous préférez regarder le tutoriel ?

Lorsque la vidéo sera disponible, vous pourrez la regarder comme alternative.

## Deutsch (`de`)

### Spiel (`#game`)

Das Spiel-Tutorial hilft dir, das native Büro zu erkunden, den Ablauf der
Arbeit im Team zu verstehen und ein Ergebnis zu prüfen, bevor du entscheidest,
was als Nächstes geschieht.

#### Plane die Einrichtung

Dieser Weg beginnt mit dem Download auf der Website und endet mit dem aktiven
Team; er setzt weder eine eingerichtete Desktop-App noch Docker voraus. Plane
vorher Zeit ein. In einem gemessenen Linux- und Docker-End-to-End-Lauf lagen
zwischen dem Doppelklick auf die heruntergeladene App, dem Abschluss des
Onboardings und dem Erreichen des Docker-Einrichtungspanels **32 Minuten und
58 Sekunden**. Der gemessene Lauf erreichte dann nach **54 Minuten und 40
Sekunden** (`T0 + 54:40`) eine Blockierung bei der Provider-Autorisierung.
Hardware, Download und Docker verändern das Ergebnis, aber dies ist keine
Fünf-Minuten-Aufgabe.

#### Richte das Team ein

1. **Lade die native Desktop-App herunter.** Gehe zu
   [jobhunterteam.ai/download](https://jobhunterteam.ai/download), wähle
   **Desktop** und dann macOS, Windows oder Linux. Die Seite verweist stets auf
   die aktuelle Version für diese Plattform.
2. **Öffne den Download für dein System.** Starte unter Windows
   `job-hunter-team.exe`; entpacke unter macOS `job-hunter-team.zip` und öffne
   die App; entpacke unter Linux `job-hunter-team-linux-x64.tar.gz` und starte
   `job-hunter-team.x86_64`. Windows und Linux können eine Warnung anzeigen:
   fahre nur fort, wenn der Download von der offiziellen Website oder der
   verlinkten Version stammt.
3. **Betritt das Büro.** Wähle und bestätige beim ersten Start vor dem
   Startbildschirm die Oberflächensprache: Du musst die Auswahl bestätigen,
   English ist vorausgewählt und die App speichert sie für spätere Starts. Gib
   danach deinen Namen ein, wenn du möchtest, und betritt das Büro. Du kannst
   es vor der Einrichtung erkunden: Beispielgespräche und -positionen starten
   kein Live-Team und nutzen keinen Provider.
4. **Öffne die Einrichtungs-Checkliste.** Wähle **Team aktivieren**. Wähle eine
   lokale Runtime oder verbinde einen VPS. Die lokale Runtime benötigt Docker;
   unter Windows kann Docker Desktop Zustimmung und seinen ersten Start
   verlangen.
5. **Verbinde einen Provider.** Wähle in der Koordinator-Einrichtung einen
   Abonnement-Provider und Tarif und schließe die Autorisierung im integrierten
   Terminal ab. Ein Link kann sich im Browser öffnen, Codes und Auswahl bleiben
   jedoch im Büro-Terminal.
6. **Vervollständige das Profil.** Fülle das native Profil aus: erforderlich
   sind Name, E-Mail, Zielrolle, Ort, Erfahrung, Senioritätsstufe, mindestens
   zwei Fähigkeiten und eine Sprache.
7. **Lege Arbeitszeiten fest.** Wähle, wann das Team arbeiten darf. Die
   Checkliste bleibt unvollständig, bis Runtime, Provider, Profil und
   Arbeitszeiten bereit sind.
8. **Aktiviere das Team.** Kehre zu **Team aktivieren** zurück und erfülle die
   vier Bedingungen. Der Koordinator startet die Agenten; im Büro erscheinen
   Live-Antworten und Positionen.

#### Erkunde ein aktives Team

1. **Lerne das Büro kennen.** Öffne das native Büro und wähle einen beliebigen
   Kollegen aus. Seine Karte zeigt einen Namen, den aktuellen Status und die
   Aufgabe. Dieser Schritt ist abgeschlossen, wenn du eine Karte öffnen und
   zum Büro zurückkehren kannst, ohne deinen Platz zu verlieren.
2. **Verstehe, wer was macht.** Die Abteilungsnamen, die du im Büro und in
   Gesprächen siehst, stehen immer im Plural: **Koordinatoren,
   Support-Berater, Karriereberater, Rechercheure, Analysten,
   Passungsbewerter, Bewerbungsautoren und Prüfer**. Koordinatoren halten die
   Arbeit in Bewegung; Support-Berater helfen mit dem Produkt und deinem
   Profil; Karriereberater helfen bei der Orientierung. Rechercheure finden
   Chancen, Analysten prüfen sie, Passungsbewerter erklären die Passung,
   Bewerbungsautoren bereiten angeforderte Unterlagen vor und Prüfer
   kontrollieren die Arbeit, bevor sie dich erreicht. Du kannst weitermachen,
   wenn du die Pipeline als eine Reihenfolge statt als getrennte Gespräche
   lesen kannst.
3. **Frage die Rechercheure.** Öffne den Chat mit den Rechercheuren und frage,
   wonach die aktuelle Suche sucht. Sende eine klare Frage. Deine Nachricht
   bleibt in dieser Unterhaltung und die Antwort kehrt dorthin zurück; sie kann
   daher nicht mit einem anderen Thread verwechselt werden. Der Schritt hat
   funktioniert, wenn der Thread deine Frage und die Antwort zeigt.
4. **Verfolge die Prüfung.** Öffne eine Unterhaltung mit den Analysten oder
   prüfe die Aktivität für eine Position, die die Entdeckung hinter sich hat.
   Analysten prüfen Rolle, Organisation und Details, bevor eine Position
   weitergeht. Der Schritt hat funktioniert, wenn du einen gefundenen Hinweis
   von einer geprüften Chance unterscheiden kannst.
5. **Lies die Passung.** Öffne eine Unterhaltung mit den Passungsbewertern oder
   eine bewertete Position. Sie vergleichen die Chance mit deinem Profil und
   erklären die Bewertung. Eine Bewertung ist eine Schätzung der Passung, keine
   Entscheidung an deiner Stelle. Der Schritt hat funktioniert, wenn du
   Bewertung und Erklärung erkennst und entscheidest, ob die Chance deine
   Aufmerksamkeit verdient.
6. **Sieh die ganze Pipeline.** Öffne **Positions**, wähle ein Ergebnis und
   lies seinen Status. **`new`** bedeutet: Rechercheure haben es gefunden und
   Analysten prüfen es als Nächstes. **`checked`** bedeutet: Analysten sind
   fertig und Passungsbewerter bewerten es als Nächstes. **`scored`** bedeutet:
   Passungsbewerter sind fertig; du kannst entscheiden oder Unterlagen anfordern.
   Nach deiner Anforderung bedeutet **`writing`**, dass Bewerbungsautoren sie
   vorbereiten, **`review`**, dass Prüfer sie kontrollieren, und **`ready`**,
   dass sie für dich bereit sind. **`applied`** und **`response`** zeichnen
   deine Handlung und ihr Ergebnis auf. Der Schritt hat funktioniert, wenn du
   für den sichtbaren Status die zuständige Abteilung und das nächste Ereignis
   nennen kannst.
7. **Untersuche Positionen.** Öffne **Positions** und wähle eine gute
   Übereinstimmung. Karte und Detail zeigen Rolle, Organisation, Ort,
   Arbeitsmodell, Bewertung und Status. Falls vorhanden, zeigen sie auch
   vorbereitete Bewerbungsunterlagen. Der Schritt hat funktioniert, wenn du ein
   Ergebnis öffnen, verstehen kannst, warum es dort ist, und zur Liste
   zurückkehrst.
8. **Entscheide über den nächsten Schritt.** Kehre zum Büro zurück.
   Koordinatoren halten Prioritäten in Bewegung, Support-Berater helfen dir,
   den Arbeitsbereich zu nutzen und dein Profil zu vervollständigen, und
   Karriereberater helfen bei Zielen und Strategie. Erkunde, frage, dann
   entscheide: Die endgültige Wahl und jede Bewerbung bleiben deine
   Verantwortung.

#### Möchtest du das Tutorial lieber ansehen?

Sobald das Video verfügbar ist, kannst du es als Alternative ansehen.

### Web (`#web`)

Das Web-Tutorial hilft dir, die Arbeit von jedem angemeldeten Browser aus zu
verfolgen, eine Position zu prüfen, Rückmeldung zu geben und Gespräche getrennt
zu halten.

#### Bevor du beginnst

Richte die Synchronisierung vor der Anmeldung ein: Öffne in der nativen
Desktop-App **Einstellungen**, dann **Account**, wähle **Mit Google anmelden**;
öffne im angezeigten Terminal den Link, gib den Code ein und bestätige dieses
Gerät. Wähle dann
**Jetzt synchronisieren**. Die Zeile **Cloud-Konto** muss **verbunden** und die
Zeile **Gerät** **zugeordnet** anzeigen. Falls die Anmeldung nicht verfügbar
ist, starte zuerst das Team; zeigt der Account nach der Bestätigung weiter
**lokaler Modus / Gast**, wiederhole **Mit Google anmelden**. Melde dich dann
mit demselben Konto in der Web-App an. Um jeden Schritt zu üben, warte, bis
mindestens eine Position eine Bewertung hat. Ein leeres Dashboard bedeutet nur,
dass das Team noch kein bewertetes Ergebnis erzeugt hat.

1. **Starte im Dashboard.** Öffne **Dashboard**. Es beginnt mit den zuletzt
   bewerteten Positionen, damit neue Ergebnisse nicht in einem Aktivitätenstrom
   verschwinden. Auf einem kleinen Bildschirm verwendest du das
   Navigationsmenü, um dieselben Seiten zu erreichen. Der Schritt hat
   funktioniert, wenn du ein bewertetes Ergebnis in der Dashboard-Liste siehst
   und öffnen kannst.
2. **Lies eine Position.** Öffne eine Position im Dashboard oder unter
   **Positions**. Ihr Detail zeigt Rolle, Ort, Arbeitsmodell, Aufschlüsselung
   der Bewertung und Prüf- oder Bewerbungsstatus. Lies die Bewertung zusammen
   mit ihrer Erklärung: Sie ist eine Schätzung der Passung, keine Aufforderung,
   dich zu bewerben. Der Schritt hat funktioniert, wenn du sagen kannst, was
   die Position ist, wie sie zu dir passt und welche Phase sie erreicht hat.
3. **Gib nützliches Feedback in Swipe.** Öffne **Swipe**, um jeweils eine
   Position zu prüfen. Verwende die Entscheidungsschaltflächen, um dein
   Interesse festzuhalten; Ziehen nach links oder rechts wechselt nur zwischen
   Karten. Mit **Nicht interessiert** schließt du diese Position von weiterer
   Arbeit aus und kannst ein früheres Urteil ändern. Der Schritt hat
   funktioniert, wenn die nächste Karte erscheint und die geprüfte Karte deine
   Entscheidung behält.
4. **Prüfe die Teamaktivität.** Öffne **Team**. Die Aktivitätsansicht zeigt,
   was als Nächstes geschieht, und ordnet die Arbeit dem zuständigen Teil des
   Teams zu. Rechercheure finden Chancen, Analysten prüfen sie,
   Passungsbewerter ordnen die Passung ein, Bewerbungsautoren bereiten
   angeforderte Unterlagen vor und Prüfer kontrollieren sie. Der Schritt hat
   funktioniert, wenn du eine Aktivität oder einen Status mit ihrem Platz in
   der Pipeline verbinden kannst.
5. **Halte Gespräche getrennt.** Öffne **Messages** und wähle eine
   Unterhaltung. Support-Berater beantworten Fragen zum Produkt und deinem
   Profil; Karriereberater konzentrieren sich auf Ziele und Karriere-Strategie;
   Koordinatoren halten Prioritäten in Bewegung. Jeder hat einen eigenen
   Thread. Der Schritt hat funktioniert, wenn ein Wechsel der Unterhaltung den
   Thread wechselt, statt Antworten zu vermischen.
6. **Sende eine Nachricht und verfolge die Zustellung.** Wähle die Support-
   Berater, schreibe eine kurze Frage und sende sie. Die Nachricht erscheint
   sofort in diesem Thread und behält einen sichtbaren Zustellstatus; die
   Antwort kehrt in dieselbe Unterhaltung zurück. Der Schritt hat funktioniert,
   wenn du Nachricht, Zustellfortschritt und Antwort siehst, ohne den Thread zu
   verlassen.
7. **Schließe mit einer informierten Entscheidung ab.** Kehre zu der Position
   zurück, die dir am wichtigsten ist. Nutze Rolle, Passungserklärung, Status,
   dein Swipe-Feedback und den Teamkontext, um zu entscheiden, was du als
   Nächstes tun möchtest. Die Web-App hilft dir beim Prüfen und Kommunizieren;
   die endgültige Entscheidung bleibt bei dir.

#### Möchtest du das Tutorial lieber ansehen?

Sobald das Video verfügbar ist, kannst du es als Alternative ansehen.

## Português (`pt`)

### Jogo (`#game`)

O tutorial de jogo ajuda-te a explorar o escritório nativo, a compreender como
o trabalho avança pela equipa e a inspecionar um resultado antes de decidires o
que fazer.

#### Planeia a configuração

Este percurso começa no download do site e termina com a equipa ativa; não
pressupõe que a aplicação de ambiente de trabalho ou o Docker já estejam
configurados. Reserva tempo antes de começar. Numa execução end-to-end medida
em Linux + Docker, passaram **32 minutos e 58 segundos** entre o duplo clique
na aplicação descarregada, a conclusão do onboarding e a chegada ao painel de
configuração do Docker. A execução medida chegou depois a um bloqueio da
autorização do fornecedor aos **54 minutos e 40 segundos** (`T0 + 54:40`). O
hardware, o download e o Docker alteram o resultado, mas esta não é uma tarefa
de cinco minutos.

#### Configura a equipa

1. **Descarrega a aplicação de ambiente de trabalho nativa.** Vai a
   [jobhunterteam.ai/download](https://jobhunterteam.ai/download), escolhe
   **Desktop** e depois macOS, Windows ou Linux. A página aponta sempre para a
   versão atual dessa plataforma.
2. **Abre o download para o teu sistema.** No Windows executa
   `job-hunter-team.exe`; no macOS descomprime `job-hunter-team.zip` e abre a
   aplicação; no Linux extrai `job-hunter-team-linux-x64.tar.gz` e executa
   `job-hunter-team.x86_64`. Windows e Linux podem mostrar um aviso: avança
   apenas se o download vier do site oficial ou da versão ligada.
3. **Entra no escritório.** No primeiro arranque, escolhe e confirma o idioma
   da interface antes do ecrã inicial: tens de confirmar a escolha, English
   vem pré-selecionado e a aplicação guarda-a para aberturas posteriores.
   Depois acrescenta o teu nome se quiseres e entra no escritório. Podes
   explorá-lo antes da configuração: as conversas e posições de exemplo não
   iniciam uma equipa real nem usam um fornecedor.
4. **Abre a lista de configuração.** Seleciona **Ativar equipa**. Escolhe um
   runtime local ou liga uma VPS. O runtime local precisa de Docker; no Windows
   o Docker Desktop pode exigir consentimento e o primeiro arranque.
5. **Liga um fornecedor.** Na configuração do Coordenador, escolhe um
   fornecedor por subscrição e o plano e conclui a autorização no terminal
   integrado. Uma ligação pode abrir no navegador, mas os códigos e as escolhas
   ficam no terminal do escritório.
6. **Completa o perfil.** Preenche o perfil nativo: são necessários nome,
   e-mail, função pretendida, localização, experiência, senioridade, pelo menos
   duas competências e uma língua.
7. **Define o horário de trabalho.** Escolhe quando a equipa pode trabalhar. A
   lista fica incompleta até runtime, fornecedor, perfil e horário estarem
   prontos.
8. **Ativa a equipa.** Volta a **Ativar equipa** e completa as quatro
   condições. O Coordenador inicia os agentes e o escritório recebe respostas
   e posições ao vivo.

#### Explora uma equipa ativa

1. **Conhece o escritório.** Abre o escritório nativo e seleciona qualquer
   colega. O cartão mostra um nome, o estado atual e a responsabilidade. Este
   passo está concluído quando consegues abrir um cartão e voltar ao escritório
   sem perderes o ponto onde estavas.
2. **Percebe quem faz o quê.** Os nomes dos departamentos que vês no escritório
   e nas conversas estão sempre no plural: **coordenadores, consultores de
   apoio, consultores de carreira, investigadores, analistas, avaliadores de
   compatibilidade, redatores de candidaturas e revisores**. Os coordenadores
   mantêm o trabalho em movimento; os consultores de apoio ajudam com o produto
   e o teu perfil; os consultores de carreira ajudam a definir a direção. Os
   investigadores encontram oportunidades, os analistas verificam-nas, os
   avaliadores explicam a compatibilidade, os redatores preparam os documentos
   solicitados e os revisores conferem o trabalho antes de este chegar até ti.
   Podes continuar quando lês o pipeline como uma sequência, e não como
   conversas sem relação.
3. **Pergunta aos investigadores.** Abre a conversa com os investigadores e
   pergunta o que a pesquisa atual procura. Envia uma pergunta clara. A tua
   mensagem fica nessa conversa e a resposta regressa a ela, por isso não pode
   ser confundida com outro tópico. O passo resulta quando o tópico mostra a
   tua pergunta e a respetiva resposta.
4. **Acompanha a verificação.** Abre uma conversa com os analistas ou consulta
   a atividade de uma posição que tenha avançado desde a descoberta. Os
   analistas verificam a função, a organização e os detalhes antes de uma
   posição avançar. O passo resulta quando distingues uma pista encontrada de
   uma oportunidade verificada.
5. **Lê a compatibilidade.** Abre uma conversa com os avaliadores de
   compatibilidade ou uma posição com pontuação. Eles comparam a oportunidade
   com o teu perfil e explicam a pontuação. Uma pontuação é uma estimativa de
   compatibilidade, não uma decisão tomada por ti. O passo resulta quando
   identificas a pontuação e a explicação e decides se a oportunidade merece
   atenção.
6. **Vê todo o pipeline.** Abre **Posições**, seleciona um resultado e lê o
   estado. **`new`** significa que os investigadores o encontraram e os
   analistas o verificam a seguir; **`checked`** significa que os analistas
   terminaram e os avaliadores de compatibilidade o pontuam a seguir; **`scored`**
   significa que os avaliadores terminaram, pelo que podes decidir ou pedir
   documentos. Depois do teu pedido, **`writing`** significa que os redatores
   de candidaturas os preparam, **`review`** que os revisores os conferem e
   **`ready`** que estão prontos para ti. **`applied`** e **`response`**
   registam a tua ação e o respetivo resultado. O passo resulta quando consegues
   indicar o departamento responsável e o próximo evento do estado visível.
7. **Inspeciona posições.** Abre **Posições** e seleciona uma boa
   correspondência. O cartão e o detalhe mostram função, organização,
   localização, modelo de trabalho, pontuação e estado. Quando disponíveis,
   mostram também os documentos de candidatura preparados. O passo resulta
   quando consegues abrir um resultado, perceber porque está ali e regressar à
   lista.
8. **Decide o que acontece a seguir.** Volta ao escritório. Os coordenadores
   mantêm as prioridades em movimento, os consultores de apoio ajudam-te a usar
   o espaço de trabalho e a completar o perfil, e os consultores de carreira
   ajudam com objetivos e estratégia. Explora, pergunta e depois decide: a
   escolha final e qualquer candidatura continuam a ser da tua responsabilidade.

#### Preferes ver o tutorial?

Quando o vídeo estiver disponível, poderás vê-lo como alternativa.

### Web (`#web`)

O tutorial web ajuda-te a acompanhar o trabalho a partir de qualquer navegador
com sessão iniciada, a inspecionar uma posição, a dar opinião e a manter as
conversas separadas.

#### Antes de começares

Configura a sincronização antes de iniciares sessão: na aplicação de ambiente
de trabalho nativa abre **Configurações**, depois **Conta**, escolhe **Entrar com o
Google**; no terminal que se abre, abre a ligação, introduz o código e aprova
este dispositivo; depois escolhe **Sincronizar agora**. A linha **Conta cloud**
deve indicar **ligada** e
a linha **Dispositivo**, **associado**. Se o controlo de início de sessão não
estiver disponível, inicia primeiro a equipa; se, depois da aprovação, a conta
ainda indicar **modo local / convidado**, repete **Entrar com o Google**. Depois
inicia sessão na aplicação web com a mesma conta. Para praticares todos os
passos, espera que pelo menos uma posição tenha uma pontuação. Um dashboard
vazio significa apenas que a equipa ainda não produziu um resultado pontuado.

1. **Começa no painel.** Abre **Dashboard**. Começa pelas posições pontuadas
   mais recentemente, para que os novos resultados não se percam num fluxo de
   atividade. Num ecrã pequeno, usa o menu de navegação para chegares às mesmas
   páginas. O passo resulta quando vês um resultado pontuado na lista do painel
   e o consegues abrir.
2. **Lê uma posição.** Abre uma posição a partir do painel ou de **Posições**.
   O detalhe mostra a função, localização, modelo de trabalho, decomposição da
   pontuação e estado de revisão ou candidatura. Lê a pontuação com a
   explicação: é uma estimativa de compatibilidade, não uma instrução para te
   candidatares. O passo resulta quando consegues dizer o que é a posição, como
   ela se adequa a ti e a que fase chegou.
3. **Dá opinião útil em Deslizar.** Abre **Deslizar** para rever uma posição de
   cada vez. Usa os botões de decisão para registar o teu interesse; arrastar à
   esquerda ou à direita serve apenas para mudar de cartão. Escolher **Não me
   interessa** exclui essa posição do trabalho posterior e podes rever uma
   decisão anterior. O passo resulta quando aparece o cartão seguinte e o
   cartão revisto mantém a tua decisão.
4. **Verifica a atividade da equipa.** Abre **Equipa**. A vista de atividade
   mostra o que acontece a seguir e atribui o trabalho à parte relevante da
   equipa. Os investigadores encontram oportunidades, os analistas verificam-
   nas, os avaliadores de compatibilidade classificam a adequação, os redatores
   de candidaturas preparam os documentos solicitados e os revisores conferem-
   nos. O passo resulta quando ligas uma atividade ou um estado ao seu lugar no
   pipeline.
5. **Mantém as conversas separadas.** Abre **Mensagens** e seleciona uma
   conversa. Os consultores de apoio respondem a perguntas sobre o produto e o
   teu perfil; os consultores de carreira concentram-se em objetivos e estratégia
   de carreira; os coordenadores mantêm as prioridades em movimento. Cada um
   tem o seu próprio tópico. O passo resulta quando mudar de conversa muda o
   tópico em vez de misturar respostas.
6. **Envia uma mensagem e acompanha a entrega.** Escolhe os consultores de
   apoio, escreve uma pergunta curta e envia-a. A mensagem aparece logo nesse
   tópico e mantém um estado de entrega visível; a resposta regressa à mesma
   conversa. O passo resulta quando vês a mensagem, o progresso da entrega e a
   resposta sem sair do tópico.
7. **Termina com uma decisão informada.** Volta à posição que mais importa.
   Usa a função, a explicação de compatibilidade, o estado, a tua opinião em
   Deslizar e o contexto da equipa para decidir o que queres fazer a seguir. A
   aplicação web ajuda-te a inspecionar e comunicar; a decisão final é tua.

#### Preferes ver o tutorial?

Quando o vídeo estiver disponível, poderás vê-lo como alternativa.

## Magyar (`hu`)

### Játék (`#game`)

A játék oktatóanyaga segít felfedezni a natív irodát, megérteni, hogyan halad
át a munka a csapaton, és ellenőrizni egy eredményt, mielőtt eldöntenéd, mi
legyen a következő lépés.

#### Tervezd meg a beállítást

Ez az útvonal a webhelyről való letöltéssel kezdődik, és az aktív csapatnál
ér véget; nem feltételezi, hogy az asztali alkalmazás vagy a Docker már be van
állítva. Kezdés előtt szánj rá időt. Egy mért Linux + Docker end-to-end futásban
a letöltött alkalmazásra kattintástól az onboarding befejezéséig és a Docker
beállítási panel eléréséig **32 perc 58 másodperc** telt el. A mért futás
ezután a szolgáltatói engedélyezésnél **54 perc 40 másodpercnél**
(`T0 + 54:40`) blokkolódott. A hardver, a letöltés és a Docker módosítja az
eredményt, de ez nem ötperces feladat.

#### Állítsd be a csapatot

1. **Töltsd le a natív asztali alkalmazást.** Nyisd meg a
   [jobhunterteam.ai/download](https://jobhunterteam.ai/download) oldalt,
   válaszd a **Desktop**, majd a macOS, Windows vagy Linux lehetőséget. Az oldal
   mindig az adott platform aktuális kiadására mutat.
2. **Nyisd meg a rendszeredhez való letöltést.** Windowson futtasd a
   `job-hunter-team.exe` fájlt; macOS-en csomagold ki a
   `job-hunter-team.zip` fájlt és nyisd meg az alkalmazást; Linuxon csomagold
   ki a `job-hunter-team-linux-x64.tar.gz` fájlt, majd indítsd el a
   `job-hunter-team.x86_64` fájlt. Windows és Linux figyelmeztetést jeleníthet
   meg: csak akkor folytasd, ha a letöltés a hivatalos oldalról vagy a hivatkozott
   kiadásból származik.
3. **Lépj be az irodába.** Első indításkor a kezdőképernyő előtt válaszd ki és
   erősítsd meg a felület nyelvét: meg kell erősítened a választást, az English
   van előre kijelölve, és az alkalmazás a következő megnyitásokhoz elmenti.
   Ezután add meg a nevedet, ha szeretnéd, majd lépj be az irodába. A beállítás
   előtt is felfedezheted: a példa beszélgetések és pozíciók nem indítanak élő
   csapatot és nem használnak szolgáltatót.
4. **Nyisd meg a beállítási ellenőrzőlistát.** Válaszd a **Csapat aktiválása**
   lehetőséget. Válassz helyi runtime-ot vagy kapcsolj VPS-t. A helyi runtime
   Docker-t igényel; Windowson a Docker Desktop hozzájárulást és első indítást
   kérhet.
5. **Kapcsolj szolgáltatót.** A Koordinátor beállításában válassz előfizetéses
   AI-szolgáltatót és csomagot, majd fejezd be az engedélyezést a beépített
   terminálban. A hivatkozás megnyílhat a böngészőben, de a kódok és választások
   az iroda termináljában maradnak.
6. **Töltsd ki a profilt.** Töltsd ki a natív profilt: név, e-mail, célpozíció,
   hely, tapasztalat, senioritás, legalább két készség és egy nyelv szükséges.
7. **Állítsd be a munkaidőt.** Válaszd ki, mikor dolgozhat a csapat. Az
   ellenőrzőlista addig hiányos, amíg a runtime, a szolgáltató, a profil és a
   munkaidő nincs kész.
8. **Aktiváld a csapatot.** Térj vissza a **Csapat aktiválása** ponthoz és
   teljesítsd a négy feltételt. A Koordinátor elindítja az ügynököket, és az
   irodában élő válaszok és pozíciók jelennek meg.

#### Fedezd fel az aktív csapatot

1. **Ismerd meg az irodát.** Nyisd meg a natív irodát, és válassz ki bármelyik
   kollégát. A kártyája megmutatja a nevét, aktuális állapotát és feladatát. A
   lépést akkor teljesítetted, amikor meg tudsz nyitni egy kártyát, majd anélkül
   térsz vissza az irodába, hogy elveszítenéd, hol tartottál.
2. **Értsd meg, ki mit csinál.** Az irodában és a beszélgetésekben látható
   részlegnevek mindig többes számban vannak: **koordinátorok, támogatási
   tanácsadók, karrier-tanácsadók, kutatók, elemzők, illeszkedés-értékelők,
   pályázatírók és ellenőrök** dolgoznak. A koordinátorok mozgásban tartják a
   munkát; a támogatási tanácsadók a termékkel és a profiloddal segítenek; a
   karrier-tanácsadók az irány megtalálásában segítenek. A kutatók lehetőségeket
   keresnek, az elemzők ellenőrzik azokat, az illeszkedés-értékelők elmagyarázzák
   az egyezést, a pályázatírók elkészítik a kért dokumentumokat, az ellenőrök
   pedig átnézik a munkát, mielőtt az hozzád ér. Akkor folytathatod, amikor a
   folyamatot egyetlen sorrendként, nem egymástól független beszélgetésekként
   tudod olvasni.
3. **Kérdezd meg a kutatókat.** Nyisd meg a kutatókkal folytatott csevegést,
   és kérdezd meg, mire irányul az aktuális keresés. Küldj egy világos kérdést.
   Az üzeneted ebben a beszélgetésben marad, és a válasz is ide érkezik, ezért
   nem keverhető össze másik beszélgetéssel. A lépés akkor sikerült, amikor a
   beszélgetésben látod a kérdésedet és a választ is.
4. **Kövesd az ellenőrzést.** Nyiss meg egy beszélgetést az elemzőkkel, vagy
   nézd meg egy olyan pozíció aktivitását, amely már túljutott a felfedezésen.
   Az elemzők a szerepet, a szervezetet és a részleteket ellenőrzik, mielőtt egy
   pozíció továbblép. A lépés akkor sikerült, amikor meg tudod különböztetni a
   megtalált nyomot az ellenőrzött lehetőségtől.
5. **Olvasd el az illeszkedést.** Nyiss meg egy beszélgetést az
   illeszkedés-értékelőkkel vagy egy pontozott pozíciót. Összevetik a
   lehetőséget a profiloddal, és elmagyarázzák a pontszámot. A pontszám az
   illeszkedés becslése, nem helyetted meghozott döntés. A lépés akkor sikerült,
   amikor felismered a pontszámot és a magyarázatát, majd eldöntöd, megérdemli-e
   a lehetőség a figyelmedet.
6. **Lásd az egész folyamatot.** Nyisd meg a **Pozíciók** nézetet, válassz egy
   eredményt, és olvasd el az állapotát. A **`new`** azt jelenti, hogy a
   kutatók megtalálták, az elemzők következnek; a **`checked`** azt, hogy az
   elemzők végeztek, az illeszkedés-értékelők pontoznak ezután; a **`scored`**
   azt, hogy az értékelők végeztek, így dönthetsz vagy kérhetsz dokumentumokat.
   A kérésed után a **`writing`** azt jelenti, hogy a pályázatírók készítik
   őket, a **`review`**, hogy az ellenőrök átnézik, a **`ready`**, hogy készen
   állnak neked. Az **`applied`** és a **`response`** a te lépésedet és annak
   eredményét rögzíti. A lépés akkor sikerült, amikor a látható állapothoz meg
   tudod nevezni a felelős részleget és a következő eseményt.
7. **Vizsgáld meg a pozíciókat.** Nyisd meg a **Pozíciók** nézetet, és válassz
   egy jó egyezést. A kártya és a részletek mutatják a szerepet, szervezetet,
   helyet, munkamódot, pontszámot és állapotot. Ha rendelkezésre állnak, az
   elkészített pályázati dokumentumok is megjelennek. A lépés akkor sikerült,
   amikor megnyitsz egy eredményt, megérted, miért van ott, és visszatérsz a
   listához.
8. **Döntsd el, mi történjen ezután.** Térj vissza az irodába. A koordinátorok
   mozgásban tartják a prioritásokat, a támogatási tanácsadók segítenek a
   munkaterület használatában és a profilod kitöltésében, a karrier-tanácsadók
   pedig a célokkal és a stratégiával segítenek. Fedezz fel, kérdezz, aztán
   dönts: a végső választás és minden pályázat a te felelősséged marad.

#### Inkább megnéznéd az oktatóvideót?

Amikor a videó elérhető lesz, alternatívaként megnézheted.

### Web (`#web`)

A webes oktatóanyag segít a munkát bármely bejelentkezett böngészőből követni,
egy pozíciót megvizsgálni, visszajelzést adni és a beszélgetéseket elkülönítve
tartani.

#### Mielőtt elkezded

Bejelentkezés előtt állítsd be a szinkronizálást: a natív asztali alkalmazásban
nyisd meg a **Beállítások**, majd a **Fiók** nézetet, válaszd a **Belépés
Google-lel** lehetőséget; a megnyíló terminálban nyisd meg a linket, írd be a
kódot és hagyd jóvá ezt az eszközt, majd válaszd a **Szinkronizálás most**
lehetőséget. A **Felhőfiók**
sorának **csatlakoztatva**, az **Eszköz** sorának **társítva** állapotot kell
mutatnia. Ha a belépési vezérlő nem elérhető, előbb indítsd el a csapatot; ha a
jóváhagyás után a fiók még mindig **helyi / vendég módban** van, ismételd meg a
**Belépés Google-lel** lépést. Ezután ugyanazzal a fiókkal jelentkezz be a
webalkalmazásba. Minden lépés gyakorlásához várd meg, amíg legalább egy
pozíciónak lesz pontszáma. Az üres irányítópult egyszerűen azt jelenti, hogy a
csapat még nem hozott létre pontozott eredményt.

1. **Kezdd az irányítópulttal.** Nyisd meg a **Dashboard** nézetet. A
   legutóbb pontozott pozíciókkal kezdődik, így az új eredmények nem vesznek el
   egy aktivitási hírfolyamban. Kis képernyőn a navigációs menüvel éred el
   ugyanazokat az oldalakat. A lépés akkor sikerült, amikor látsz egy pontozott
   eredményt az irányítópult listájában, és meg tudod nyitni.
2. **Olvass el egy pozíciót.** Nyiss meg egy pozíciót az irányítópultról vagy a
   **Pozíciók** nézetből. A részletek megadják a szerepet, helyet, munkamódot,
   a pontszám bontását és az ellenőrzés vagy pályázat állapotát. Olvasd a
   pontszámot a magyarázatával együtt: az illeszkedés becslése, nem utasítás a
   pályázásra. A lépés akkor sikerült, amikor el tudod mondani, mi a pozíció,
   hogyan illik hozzád, és melyik szakaszba ért.
3. **Adj hasznos visszajelzést a Húzás nézetben.** Nyisd meg a **Húzás**
   nézetet, hogy egyszerre egy pozíciót vizsgálj meg. A döntési gombokkal
   rögzítsd, mennyire érdekel; a balra vagy jobbra húzás csak a kártyák közötti
   váltásra szolgál. A **Nem érdekel** választása kizárja a pozíciót a további
   munkából, és egy korábbi döntésedet is módosíthatod. A lépés akkor sikerült,
   amikor megjelenik a következő kártya, a vizsgált pedig megőrzi a döntésedet.
4. **Ellenőrizd a csapat aktivitását.** Nyisd meg a **Csapat** nézetet. Az
   aktivitási nézet megmutatja, mi történik ezután, és a munkát a csapat
   megfelelő részéhez rendeli. A kutatók lehetőségeket találnak, az elemzők
   ellenőrzik azokat, az illeszkedés-értékelők rangsorolják az egyezést, a
   pályázatírók elkészítik a kért dokumentumokat, az ellenőrök pedig átnézik
   őket. A lépés akkor sikerült, amikor egy aktivitást vagy állapotot össze
   tudsz kapcsolni a folyamatban elfoglalt helyével.
5. **Tartsd elkülönítve a beszélgetéseket.** Nyisd meg az **Üzenetek** nézetet,
   és válassz egy beszélgetést. A támogatási tanácsadók a termékkel és a
   profiloddal kapcsolatos kérdésekre válaszolnak; a karrier-tanácsadók a
   célokra és a karrierstratégiára összpontosítanak; a koordinátorok mozgásban
   tartják a prioritásokat. Mindegyiknek saját beszélgetési szála van. A lépés
   akkor sikerült, amikor a beszélgetés megváltoztatása a szálat is megváltoztatja
   anélkül, hogy összekeverné a válaszokat.
6. **Küldj üzenetet, és kövesd a kézbesítést.** Válaszd a támogatási
   tanácsadókat, írj rövid kérdést, és küldd el. Az üzenet azonnal megjelenik
   abban a szálban, és látható kézbesítési állapotot tart fenn; a válasz ugyanabba
   a beszélgetésbe érkezik vissza. A lépés akkor sikerült, amikor látod az
   üzenetet, a kézbesítés előrehaladását és a választ anélkül, hogy elhagynád a
   szálat.
7. **Tájékozott döntéssel fejezd be.** Térj vissza ahhoz a pozícióhoz, amely a
   legfontosabb neked. A szerep, az illeszkedés magyarázata, az állapot, a
   Húzás nézetben adott visszajelzésed és a csapat környezete alapján döntsd el,
   mit szeretnél tenni ezután. A webalkalmazás segít megvizsgálni és
   kommunikálni; a végső döntés a tiéd marad.

#### Inkább megnéznéd az oktatóvideót?

Amikor a videó elérhető lesz, alternatívaként megnézheted.
