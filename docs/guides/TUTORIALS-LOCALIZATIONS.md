# Tutorials — UI localizations

This source supplies the six non-English versions of the text-first tutorials
in [TUTORIALS.md](TUTORIALS.md). It is for the public `/tutorials` UI: preserve
the `#game` and `#web` anchors, the order of the steps, and the text-before-
video structure in every language. The video wording stays conditional because
the public videos are not yet published.

## Italiano (`it`)

### App desktop (`#game`)

Questo tutorial segue l'app desktop: prepara il team, mostra come il lavoro
attraversa il team e come controllare un risultato prima di decidere cosa fare.

#### Pianifica il setup

Questo percorso parte dal download sul sito e termina quando il team è pronto e
l'app apre la chat con l'Assistente. Non presuppone che l'app desktop o un
motore di container siano già installati. Durante il primo setup l'app installa
ciò che serve al team nell'ambiente che scegli e scarica l'immagine del team:
quanto tempo serve dipende dalla connessione e dal computer. Tieni l'app aperta
mentre lavora.

#### Configura il team

1. **Scarica l'app desktop nativa.** Vai su
   [jobhunterteam.ai/download](https://jobhunterteam.ai/download). **Desktop**
   è già selezionato: clicca una volta macOS, Windows o Linux per avviare il
   download della release corrente per quella piattaforma.
2. **Apri il download per il tuo sistema.** Su Windows avvia
   `job-hunter-team-windows-x64-setup.exe`: installa l'app per il tuo utente.
   Su macOS apri `job-hunter-team-macos-universal.dmg` e trascina l'app in
   Applicazioni; è firmata con un Developer ID Apple e notarizzata da Apple. Su
   Linux consenti a `job-hunter-team-linux-x64.AppImage` di essere eseguito
   come programma e aprilo, oppure installa `job-hunter-team-linux-x64.deb` sui
   sistemi basati su Debian. Windows e Linux possono mostrare un avviso:
   prosegui solo se il download viene dal sito ufficiale o dalla release
   collegata.
3. **Scegli come iniziare.** L'app usa la lingua del sistema, oppure l'inglese
   se non ha quella lingua. Seleziona **Continua con Google**, oppure **Usa in
   locale**: inserisci un nome visualizzato, che resta su questo dispositivo, e
   seleziona **Continua in locale**. Per preparare un nuovo team su una VPS
   serve l'accesso con Google.
4. **Scegli l'ambiente.** Seleziona **Inizia la configurazione**, poi **Questo
   computer** o **Server VPS**. Su Windows 0.4 il team gira su questo computer
   in Podman dentro WSL, installato dall'app: WSL deve essere già attivo e
   Docker Desktop non serve. Su macOS l'app installa Podman con Homebrew, che
   deve essere già installato; se manca, l'app lo dice prima di installare
   qualsiasi cosa. Su Linux l'app usa Docker: installa Docker Engine e il suo
   plugin Compose prima di iniziare, perché per installarli servono i permessi
   di amministratore. La release per Linux è costruita, ma questo setup non è
   ancora stato collaudato. Per una VPS inserisci indirizzo, utente SSH, porta
   e file della chiave privata, che resta su questo computer.
5. **Scegli il provider.** Seleziona Codex, poi
   **Rivedi il setup**. Accedi con il tuo abbonamento più avanti nel setup: non
   serve una chiave API.
6. **Conferma e prepara la squadra.** L'ultima schermata riassume ambiente e
   provider. Quando il team gira su questo computer con Windows, elenca anche
   cosa installa l'app e come rimuoverlo in seguito. Seleziona **Prepara la
   squadra** e tieni l'app aperta mentre prepara runtime, container e strumento
   del provider. Per una VPS l'app mostra prima l'impronta SSH del server:
   confermala solo se è uguale a quella mostrata dal tuo provider VPS.
7. **Accedi al provider.** Quando la schermata dice che tocca a te, segui la
   richiesta che mostra: il link di accesso del provider, un codice da inserire
   nella pagina del provider o un campo per la risposta che il provider ti dà.
8. **Conosci l'Assistente.** Quando provider, container e agenti sono
   verificati, l'app dice che il team è pronto e apre la chat con l'Assistente,
   che impara i tuoi obiettivi e le tue preferenze parlando con te. Se un passo
   non riesce, la schermata ne dice la causa con **Riprova la preparazione** e
   **Mostra il file del registro**; se l'app si chiude a metà, all'avvio
   successivo propone **Riprendi la preparazione** o **Ricomincia da capo**.

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

### Aplicación de escritorio (`#game`)

Este tutorial sigue la aplicación de escritorio: prepara el equipo, muestra
cómo avanza el trabajo por el equipo y cómo revisar un resultado antes de
decidir qué hacer.

#### Planifica la configuración

Este recorrido empieza en la descarga del sitio web y termina cuando el equipo
está listo y la aplicación abre el chat con el Asistente. No da por hecho que
la aplicación de escritorio o un motor de contenedores ya estén instalados.
Durante la primera configuración la aplicación instala lo que el equipo
necesita en el entorno que elijas y descarga la imagen del equipo: cuánto tarda
depende de tu conexión y de tu ordenador. Mantén la aplicación abierta mientras
trabaja.

#### Configura el equipo

1. **Descarga la aplicación de escritorio nativa.** Ve a
   [jobhunterteam.ai/download](https://jobhunterteam.ai/download). **Desktop**
   ya está seleccionado: haz clic una vez en macOS, Windows o Linux para iniciar
   la descarga de la versión actual para esa plataforma.
2. **Abre la descarga para tu sistema.** En Windows ejecuta
   `job-hunter-team-windows-x64-setup.exe`: instala la aplicación para tu
   usuario. En macOS abre `job-hunter-team-macos-universal.dmg` y arrastra la
   aplicación a Aplicaciones; está firmada con un Developer ID de Apple y
   notarizada por Apple. En Linux permite que
   `job-hunter-team-linux-x64.AppImage` se ejecute como programa y ábrelo, o
   instala `job-hunter-team-linux-x64.deb` en sistemas basados en Debian.
   Windows y Linux pueden mostrar un aviso: continúa solo si descargaste desde
   el sitio oficial o desde la versión enlazada.
3. **Elige cómo empezar.** La aplicación usa el idioma de tu sistema, o el
   inglés si no tiene ese idioma. Selecciona **Continuar con Google**, o **Usar
   en local**: escribe un nombre visible, que se queda en este dispositivo, y
   selecciona **Continuar en local**. Para preparar un equipo nuevo en un VPS
   hace falta iniciar sesión con Google.
4. **Elige el entorno.** Selecciona **Empezar la configuración** y luego **Este
   ordenador** o **Servidor VPS**. En Windows 0.4 el equipo se ejecuta en este
   ordenador en Podman dentro de WSL, instalado por la aplicación: WSL ya debe
   estar activado y Docker Desktop no hace falta. En macOS la aplicación
   instala Podman con Homebrew, que ya debe estar instalado; si falta, la
   aplicación lo dice antes de instalar nada. En Linux la aplicación usa
   Docker: instala Docker Engine y su plugin Compose antes de empezar, porque
   instalarlos requiere permisos de administrador. La versión para Linux está
   compilada, pero esta configuración todavía no se ha probado. Para un VPS,
   introduce su dirección, el usuario SSH, el puerto y el archivo de la clave
   privada, que se queda en este ordenador.
5. **Elige el proveedor.** Selecciona Codex y
   luego **Revisar la configuración**. Inicias sesión con tu suscripción más
   adelante en la configuración: no hace falta una clave API.
6. **Confirma y prepara el equipo.** La última pantalla resume el entorno y el
   proveedor. Cuando el equipo se ejecuta en este ordenador con Windows,
   también enumera lo que instala la aplicación y cómo quitarlo después.
   Selecciona **Preparar el equipo** y mantén la aplicación abierta mientras
   prepara el runtime, el contenedor y la herramienta del proveedor. Para un
   VPS, la aplicación muestra primero la huella SSH del servidor: confírmala
   solo si coincide con la que muestra tu proveedor de VPS.
7. **Inicia sesión en el proveedor.** Cuando la pantalla diga que es tu turno,
   sigue la solicitud que muestra: el enlace de inicio de sesión del proveedor,
   un código que introducir en la página del proveedor o un campo para la
   respuesta que te da el proveedor.
8. **Conoce al Asistente.** Cuando el proveedor, el contenedor y los agentes
   están verificados, la aplicación dice que el equipo está listo y abre el
   chat con el Asistente, que aprende tus objetivos y preferencias hablando
   contigo. Si un paso falla, la pantalla indica la causa con **Reintentar la
   preparación** y **Mostrar el archivo de registro**; si la aplicación se
   cierra a medias, el siguiente inicio ofrece **Reanudar la preparación** o
   **Empezar de nuevo**.

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

### Application de bureau (`#game`)

Ce tutoriel suit l'application de bureau : il prépare l'équipe, montre comment
le travail traverse l'équipe et comment examiner un résultat avant de décider
quoi faire.

#### Planifiez la configuration

Ce parcours commence au téléchargement sur le site et se termine quand l'équipe
est prête et que l'application ouvre la conversation avec l'Assistant. Il ne
suppose pas que l'application de bureau ou un moteur de conteneurs soit déjà
installé. Pendant la première configuration, l'application installe ce dont
l'équipe a besoin dans l'environnement que vous choisissez et télécharge
l'image de l'équipe : la durée dépend de votre connexion et de votre
ordinateur. Gardez l'application ouverte pendant qu'elle travaille.

#### Configurez l'équipe

1. **Téléchargez l'application de bureau native.** Allez sur
   [jobhunterteam.ai/download](https://jobhunterteam.ai/download). **Desktop**
   est déjà sélectionné : cliquez une fois sur macOS, Windows ou Linux pour
   lancer le téléchargement de la version actuelle pour cette plateforme.
2. **Ouvrez le téléchargement pour votre système.** Sous Windows, lancez
   `job-hunter-team-windows-x64-setup.exe` : il installe l'application pour
   votre utilisateur. Sous macOS, ouvrez `job-hunter-team-macos-universal.dmg`
   et faites glisser l'application dans Applications ; elle est signée avec un
   Developer ID Apple et notarisée par Apple. Sous Linux, autorisez
   `job-hunter-team-linux-x64.AppImage` à s'exécuter comme programme et
   ouvrez-le, ou installez `job-hunter-team-linux-x64.deb` sur les systèmes
   basés sur Debian. Windows et Linux peuvent afficher un avertissement :
   continuez uniquement si le téléchargement vient du site officiel ou de la
   version liée.
3. **Choisissez comment commencer.** L'application utilise la langue de votre
   système, ou l'anglais si elle n'a pas cette langue. Sélectionnez **Continuer
   avec Google**, ou **Utiliser en local** : saisissez un nom affiché, qui
   reste sur cet appareil, puis sélectionnez **Continuer en local**. Pour
   préparer une nouvelle équipe sur un VPS, la connexion avec Google est
   nécessaire.
4. **Choisissez l'environnement.** Sélectionnez **Commencer la configuration**,
   puis **Cet ordinateur** ou **Serveur VPS**. Sous Windows 0.4, l'équipe
   tourne sur cet ordinateur dans Podman dans WSL, installé par l'application :
   WSL doit déjà être activé et Docker Desktop n'est pas nécessaire. Sous
   macOS, l'application installe Podman avec Homebrew, qui doit déjà être
   installé ; s'il manque, l'application le dit avant d'installer quoi que ce
   soit. Sous Linux, l'application utilise Docker : installez Docker Engine et
   son plugin Compose avant de commencer, car leur installation demande des
   droits d'administrateur. La version Linux est construite, mais cette
   configuration n'a pas encore été testée. Pour un VPS, saisissez son adresse,
   l'utilisateur SSH, le port et le fichier de la clé privée, qui reste sur cet
   ordinateur.
5. **Choisissez le fournisseur.** Sélectionnez Codex,
   puis **Vérifier la configuration**. Vous vous connectez avec votre
   abonnement plus tard dans la configuration : aucune clé API n'est
   nécessaire.
6. **Confirmez et préparez l'équipe.** Le dernier écran résume l'environnement
   et le fournisseur. Quand l'équipe tourne sur cet ordinateur sous Windows, il
   liste aussi ce que l'application installe et comment le supprimer plus tard.
   Sélectionnez **Préparer l’équipe** et gardez l'application ouverte pendant
   qu'elle prépare le runtime, le conteneur et l'outil du fournisseur. Pour un
   VPS, l'application affiche d'abord l'empreinte SSH du serveur : confirmez-la
   seulement si elle est identique à celle qu'affiche votre fournisseur de VPS.
7. **Connectez-vous au fournisseur.** Quand l'écran indique que c'est à vous,
   suivez la demande qu'il affiche : le lien de connexion du fournisseur, un
   code à saisir sur la page du fournisseur ou un champ pour la réponse que le
   fournisseur vous donne.
8. **Faites connaissance avec l'Assistant.** Quand le fournisseur, le conteneur
   et les agents sont vérifiés, l'application indique que l'équipe est prête et
   ouvre la conversation avec l'Assistant, qui apprend vos objectifs et vos
   préférences en discutant avec vous. Si une étape échoue, l'écran en donne la
   cause avec **Relancer la préparation** et **Afficher le fichier journal** ;
   si l'application se ferme en cours de route, le lancement suivant propose
   **Reprendre la préparation** ou **Recommencer**.

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

### Desktop-App (`#game`)

Dieses Tutorial folgt der Desktop-App: Es richtet das Team ein, zeigt, wie die
Arbeit durch das Team läuft, und wie du ein Ergebnis prüfst, bevor du
entscheidest, was als Nächstes geschieht.

#### Plane die Einrichtung

Dieser Weg beginnt beim Download auf der Website und endet, wenn das Team
bereit ist und die App den Chat mit dem Assistenten öffnet. Er setzt nicht
voraus, dass die Desktop-App oder eine Container-Engine bereits installiert
ist. Bei der ersten Einrichtung installiert die App, was das Team in der
gewählten Umgebung braucht, und lädt das Image des Teams herunter: Wie lange
das dauert, hängt von deiner Verbindung und deinem Computer ab. Lass die App
geöffnet, während sie arbeitet.

#### Richte das Team ein

1. **Lade die native Desktop-App herunter.** Gehe zu
   [jobhunterteam.ai/download](https://jobhunterteam.ai/download). **Desktop**
   ist bereits ausgewählt: Klicke einmal auf macOS, Windows oder Linux, um den
   Download der aktuellen Version für diese Plattform zu starten.
2. **Öffne den Download für dein System.** Starte unter Windows
   `job-hunter-team-windows-x64-setup.exe`: Es installiert die App für deinen
   Benutzer. Öffne unter macOS `job-hunter-team-macos-universal.dmg` und ziehe
   die App in den Ordner Programme; sie ist mit einer Apple Developer ID
   signiert und von Apple notarisiert. Erlaube unter Linux
   `job-hunter-team-linux-x64.AppImage`, als Programm ausgeführt zu werden, und
   öffne es, oder installiere `job-hunter-team-linux-x64.deb` auf
   Debian-basierten Systemen. Windows und Linux können eine Warnung anzeigen:
   fahre nur fort, wenn der Download von der offiziellen Website oder der
   verlinkten Version stammt.
3. **Wähle, wie du beginnst.** Die App verwendet die Sprache deines Systems,
   oder Englisch, wenn sie diese Sprache nicht hat. Wähle **Mit Google
   fortfahren** oder **Lokal verwenden**: Gib einen Anzeigenamen ein, der auf
   diesem Gerät bleibt, und wähle **Lokal fortfahren**. Um ein neues Team auf
   einem VPS einzurichten, brauchst du die Anmeldung mit Google.
4. **Wähle die Umgebung.** Wähle **Einrichtung starten**, dann **Dieser
   Computer** oder **VPS-Server**. Unter Windows 0.4 läuft das Team auf diesem
   Computer in Podman in WSL, das die App installiert: WSL muss bereits
   aktiviert sein, Docker Desktop wird nicht gebraucht. Unter macOS installiert
   die App Podman mit Homebrew, das bereits installiert sein muss; fehlt es,
   sagt die App das, bevor sie etwas installiert. Unter Linux verwendet die App
   Docker: Installiere Docker Engine und sein Compose-Plugin vor dem Start,
   denn dafür sind Administratorrechte nötig. Die Linux-Version ist gebaut,
   aber diese Einrichtung wurde noch nicht getestet. Für einen VPS gibst du
   seine Adresse, den SSH-Benutzer, den Port und die Datei des privaten
   Schlüssels ein, der auf diesem Computer bleibt.
5. **Wähle den Anbieter.** Wähle Codex, dann
   **Einrichtung prüfen**. Du meldest dich später in der Einrichtung mit deinem
   Abo an: Ein API-Schlüssel ist nicht nötig.
6. **Bestätige und bereite das Team vor.** Der letzte Bildschirm fasst Umgebung
   und Anbieter zusammen. Wenn das Team unter Windows auf diesem Computer
   läuft, listet er auch auf, was die App installiert und wie du es später
   entfernst. Wähle **Team vorbereiten** und lass die App geöffnet, während sie
   Runtime, Container und das Werkzeug des Anbieters vorbereitet. Bei einem VPS
   zeigt die App zuerst den SSH-Fingerabdruck des Servers: Bestätige ihn nur,
   wenn er mit dem übereinstimmt, den dein VPS-Anbieter anzeigt.
7. **Melde dich beim Anbieter an.** Wenn der Bildschirm sagt, dass du dran
   bist, folge der Anfrage, die er zeigt: dem Anmeldelink des Anbieters, einem
   Code für die Seite des Anbieters oder einem Feld für die Antwort, die dir
   der Anbieter gibt.
8. **Lerne den Assistenten kennen.** Wenn Anbieter, Container und Agenten
   geprüft sind, meldet die App, dass das Team bereit ist, und öffnet den Chat
   mit dem Assistenten, der im Gespräch mit dir deine Ziele und Vorlieben
   kennenlernt. Schlägt ein Schritt fehl, nennt der Bildschirm die Ursache, mit
   **Vorbereitung erneut versuchen** und **Protokolldatei anzeigen**; schließt
   sich die App mittendrin, bietet der nächste Start **Einrichtung fortsetzen**
   oder **Neu beginnen** an.

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

### Aplicação de ambiente de trabalho (`#game`)

Este tutorial segue a aplicação de ambiente de trabalho: prepara a equipa,
mostra como o trabalho passa pela equipa e como verificar um resultado antes de
decidires o que fazer.

#### Planeia a configuração

Este percurso começa no download do site e termina quando a equipa está pronta
e a aplicação abre a conversa com o Assistente. Não pressupõe que a aplicação
de ambiente de trabalho ou um motor de contentores já estejam instalados.
Durante a primeira configuração, a aplicação instala o que a equipa precisa no
ambiente que escolheres e descarrega a imagem da equipa: quanto tempo demora
depende da tua ligação e do teu computador. Mantém a aplicação aberta enquanto
trabalha.

#### Configura a equipa

1. **Descarrega a aplicação de ambiente de trabalho nativa.** Vai a
   [jobhunterteam.ai/download](https://jobhunterteam.ai/download). **Desktop**
   já está selecionado: clica uma vez em macOS, Windows ou Linux para iniciar
   a transferência da versão atual para essa plataforma.
2. **Abre o download para o teu sistema.** No Windows executa
   `job-hunter-team-windows-x64-setup.exe`: instala a aplicação para o teu
   utilizador. No macOS abre `job-hunter-team-macos-universal.dmg` e arrasta a
   aplicação para Aplicações; está assinada com um Developer ID da Apple e
   notarizada pela Apple. No Linux permite que
   `job-hunter-team-linux-x64.AppImage` seja executado como programa e abre-o,
   ou instala `job-hunter-team-linux-x64.deb` em sistemas baseados em Debian.
   Windows e Linux podem mostrar um aviso: avança apenas se o download vier do
   site oficial ou da versão ligada.
3. **Escolhe como começar.** A aplicação usa o idioma do teu sistema, ou o
   inglês se não tiver esse idioma. Seleciona **Continuar com Google**, ou
   **Usar localmente**: escreve um nome apresentado, que fica neste
   dispositivo, e seleciona **Continuar localmente**. Para preparar uma equipa
   nova numa VPS é preciso iniciar sessão com Google.
4. **Escolhe o ambiente.** Seleciona **Começar a configuração** e depois **Este
   computador** ou **Servidor VPS**. No Windows 0.4 a equipa corre neste
   computador em Podman dentro do WSL, instalado pela aplicação: o WSL já tem
   de estar ativado e o Docker Desktop não é necessário. No macOS a aplicação
   instala o Podman com o Homebrew, que já tem de estar instalado; se faltar, a
   aplicação diz isso antes de instalar o que quer que seja. No Linux a
   aplicação usa o Docker: instala o Docker Engine e o seu plugin Compose antes
   de começar, porque instalá-los exige permissões de administrador. A versão
   para Linux está compilada, mas esta configuração ainda não foi testada. Para
   uma VPS, introduz o endereço, o utilizador SSH, a porta e o ficheiro da
   chave privada, que fica neste computador.
5. **Escolhe o fornecedor.** Seleciona Codex e
   depois **Rever a configuração**. Inicias sessão com a tua subscrição mais à
   frente na configuração: não é precisa uma chave API.
6. **Confirma e prepara a equipa.** O último ecrã resume o ambiente e o
   fornecedor. Quando a equipa corre neste computador com Windows, também
   enumera o que a aplicação instala e como o remover mais tarde. Seleciona
   **Preparar a equipa** e mantém a aplicação aberta enquanto prepara o
   runtime, o contentor e a ferramenta do fornecedor. Para uma VPS, a aplicação
   mostra primeiro a impressão digital SSH do servidor: confirma-a só se for
   igual à que o teu fornecedor de VPS mostra.
7. **Inicia sessão no fornecedor.** Quando o ecrã disser que é a tua vez, segue
   o pedido que mostra: o link de início de sessão do fornecedor, um código
   para introduzir na página do fornecedor ou um campo para a resposta que o
   fornecedor te dá.
8. **Conhece o Assistente.** Quando o fornecedor, o contentor e os agentes
   estão verificados, a aplicação diz que a equipa está pronta e abre a
   conversa com o Assistente, que aprende os teus objetivos e preferências a
   conversar contigo. Se um passo falhar, o ecrã indica a causa com **Repetir a
   preparação** e **Mostrar o ficheiro de registo**; se a aplicação fechar a
   meio, o arranque seguinte propõe **Retomar a preparação** ou **Recomeçar**.

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

### Asztali alkalmazás (`#game`)

Ez az oktatóanyag az asztali alkalmazást követi: beállítja a csapatot,
megmutatja, hogyan halad a munka a csapaton át, és hogyan ellenőrizz egy
eredményt, mielőtt eldöntöd, mi legyen a következő lépés.

#### Tervezd meg a beállítást

Ez az útvonal a weboldalról való letöltéssel kezdődik, és akkor ér véget,
amikor a csapat készen áll, és az alkalmazás megnyitja a csevegést az
Asszisztenssel. Nem feltételezi, hogy az asztali alkalmazás vagy egy
konténermotor már telepítve van. Az első beállítás során az alkalmazás
telepíti, amire a csapatnak szüksége van a választott környezetben, és letölti
a csapat konténerképét: hogy ez mennyi ideig tart, az a kapcsolatodtól és a
számítógépedtől függ. Hagyd nyitva az alkalmazást, amíg dolgozik.

#### Állítsd be a csapatot

1. **Töltsd le a natív asztali alkalmazást.** Nyisd meg a
   [jobhunterteam.ai/download](https://jobhunterteam.ai/download) oldalt. A
   **Desktop** már ki van jelölve: kattints egyszer a macOS, Windows vagy Linux
   lehetőségre az adott platform aktuális kiadásának letöltéséhez.
2. **Nyisd meg a rendszeredhez való letöltést.** Windowson futtasd a
   `job-hunter-team-windows-x64-setup.exe` fájlt: a felhasználódnak telepíti az
   alkalmazást. macOS-en nyisd meg a `job-hunter-team-macos-universal.dmg`
   fájlt, és húzd az alkalmazást az Alkalmazások mappába; Apple Developer
   ID-val van aláírva, és az Apple hitelesítette. Linuxon engedélyezd, hogy a
   `job-hunter-team-linux-x64.AppImage` programként fusson, és nyisd meg, vagy
   Debian-alapú rendszeren telepítsd a `job-hunter-team-linux-x64.deb`
   csomagot. Windows és Linux figyelmeztetést jeleníthet meg: csak akkor
   folytasd, ha a letöltés a hivatalos oldalról vagy a hivatkozott kiadásból
   származik.
3. **Válaszd ki, hogyan kezdesz.** Az alkalmazás a rendszered nyelvét
   használja, vagy az angolt, ha azt a nyelvet nem ismeri. Válaszd a
   **Folytatás Google-fiókkal** lehetőséget, vagy a **Helyi használat**
   lehetőséget: adj meg egy megjelenített nevet, amely ezen az eszközön marad,
   majd válaszd a **Folytatás helyben** gombot. Új csapat VPS-en való
   beállításához Google-bejelentkezés kell.
4. **Válaszd ki a környezetet.** Válaszd **A beállítás indítása** gombot, majd
   az **Ez a számítógép** vagy a **VPS-szerver** lehetőséget. Windows 0.4 alatt
   a csapat ezen a számítógépen fut, a WSL-en belül futó Podman alatt, amelyet
   az alkalmazás telepít: a WSL-nek már engedélyezve kell lennie, a Docker
   Desktopra nincs szükség. macOS-en az alkalmazás a Homebrew segítségével
   telepíti a Podmant; a Homebrew-nak már telepítve kell lennie, és ha
   hiányzik, az alkalmazás ezt még a telepítés előtt jelzi. Linuxon az
   alkalmazás Dockert használ: kezdés előtt telepítsd a Docker Engine-t és a
   Compose bővítményét, mert a telepítésükhöz rendszergazdai jogok kellenek. A
   linuxos kiadás elkészült, de ezt a beállítást még nem tesztelték. VPS esetén
   add meg a címét, az SSH-felhasználót, a portot és a privát kulcs fájlját,
   amely ezen a számítógépen marad.
5. **Válaszd ki a szolgáltatót.** Válaszd a Codexet,
   majd **A beállítás áttekintése** gombot. Az előfizetéseddel a
   beállítás egy későbbi lépésében jelentkezel be: API-kulcsra nincs szükség.
6. **Erősítsd meg, és készítsd elő a csapatot.** Az utolsó képernyő
   összefoglalja a környezetet és a szolgáltatót. Ha a csapat Windowson ezen a
   számítógépen fut, azt is felsorolja, mit telepít az alkalmazás, és hogyan
   távolíthatod el később. Válaszd **A csapat előkészítése** gombot, és hagyd
   nyitva az alkalmazást, amíg előkészíti a futtatókörnyezetet, a konténert és
   a szolgáltató eszközét. VPS esetén az alkalmazás először a szerver
   SSH-ujjlenyomatát mutatja: csak akkor erősítsd meg, ha megegyezik azzal,
   amelyet a VPS-szolgáltatód mutat.
7. **Jelentkezz be a szolgáltatónál.** Amikor a képernyő jelzi, hogy te
   következel, kövesd a megjelenített kérést: a szolgáltató bejelentkezési
   linkjét, egy kódot, amelyet a szolgáltató oldalán kell megadnod, vagy egy
   mezőt a szolgáltatótól kapott válasznak.
8. **Ismerd meg az Asszisztenst.** Amikor a szolgáltató, a konténer és az
   ügynökök ellenőrizve vannak, az alkalmazás jelzi, hogy a csapat készen áll,
   és megnyitja a csevegést az Asszisztenssel, aki beszélgetés közben megismeri
   a céljaidat és a preferenciáidat. Ha egy lépés nem sikerül, a képernyő
   megmondja az okát, és felkínálja **Az előkészítés újrapróbálása** és a
   **Naplófájl megjelenítése** gombot; ha az alkalmazás félúton bezárul, a
   következő indításkor az **Előkészítés folytatása** vagy az **Újrakezdés**
   közül választhatsz.

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
