// Overlay traduzioni Español (es). Sovrascrive le chiavi presenti sopra la
// base it/en/hu; le chiavi assenti ripiegano automaticamente su `en`.
// Le chiavi array (ta()) non passano dall'overlay: vivono solo nella base.
export const es: Record<string, string> = {
  // Nav
  nav_features: "Funciones",
  nav_how: "Cómo funciona",
  nav_github: "GitHub",
  nav_download: "Descargar",
  nav_project: "Proyecto",
  nav_demo: "Demo",
  nav_guide: "Guía",
  nav_faq: "FAQ",
  nav_pricing: "Precios",
  nav_about: "Quiénes somos",
  nav_stats: "Estadísticas",
  nav_chronicles: "Crónicas",
  nav_login: "Iniciar sesión",

  // Hero
  hero_badge: "beta pública",
  hero_title_1: "Tu equipo de agentes IA",
  hero_title_2: "para encontrar empleo",
  hero_desc_short: "Un equipo de agentes IA para tu búsqueda de empleo.",
  hero_desc:
    "Un sistema multiagente que automatiza cada fase de tu búsqueda: desde el escaneo de ofertas hasta la candidatura personalizada. Tú decides la estrategia, los agentes la ejecutan.",
  hero_cta: "Empieza aquí",
  hero_cta2: "Descubre cómo funciona",
  hero_project_cta: "GitHub",
  cta_start_team: "Crea tu equipo",

  // Features
  feat_aria: "Funcionalidades",
  feat_label: "capacidades",
  feat_title_1: "Todo lo que necesitas,",
  feat_title_2: "nada superfluo",
  feat_0_title: "Equipo Multiagente",
  feat_0_desc:
    "7 agentes IA especializados — Scout, Analista, Scorer, Escritor, Crítico, Centinela y Capitán — que colaboran como un equipo real.",
  feat_1_title: "Escaneo Continuo",
  feat_1_desc:
    "Monitoreo automático de portales de empleo, LinkedIn y canales dedicados. No vuelvas a perderte una oportunidad relevante.",
  feat_2_title: "Candidaturas Inteligentes",
  feat_2_desc:
    "CV y cartas de presentación personalizadas para cada puesto, optimizadas para los sistemas ATS y para el reclutador.",
  feat_3_title: "Puntuación Inteligente",
  feat_3_desc:
    "Cada oferta se analiza y se valora según tu perfil, competencias y preferencias. Céntrate en lo que importa.",
  feat_4_title: "Panel en Tiempo Real",
  feat_4_desc:
    "Métricas, analíticas y estado de cada candidatura. Todo en una vista: tokens, costes, latencia, pipeline completo.",
  feat_5_title: "Tú al Mando",
  feat_5_desc:
    "Los agentes proponen, tú decides. Cada candidatura requiere tu aprobación antes del envío.",

  // Steps
  steps_label: "flujo de trabajo",
  steps_title: "Cómo funciona",
  step_0_title: "Configura",
  step_0_desc:
    "Define tu perfil, las competencias, el puesto deseado y los criterios de búsqueda. Los agentes se calibran según tú.",
  step_1_title: "Los agentes trabajan",
  step_1_desc:
    "El equipo escanea ofertas, analiza requisitos, calcula la puntuación de coincidencia y prepara candidaturas personalizadas.",
  step_2_title: "Tú decides",
  step_2_desc:
    "Revisa las candidaturas listas en el panel. Aprueba, edita o descarta. Siempre tú al mando.",

  // Get Started
  gs_label: "empieza ya",
  gs_title: "Cómo empezar",
  gs_0_title: "Descarga",
  gs_0_desc:
    "Descarga el paquete para tu sistema operativo. Un solo archivo, sin instalaciones complejas.",
  gs_1_title: "Configura el perfil",
  gs_1_desc:
    "Indica tu puesto, tus competencias y la zona de búsqueda. El equipo se calibra según tú en pocos segundos.",
  gs_2_title: "Deja trabajar al equipo",
  gs_2_desc:
    "Los agentes buscan, analizan y preparan candidaturas mientras tú haces otras cosas. Revisa y aprueba desde el panel.",

  // Demo page
  demo_badge: "tour guiado",
  demo_title: "Cómo funciona JHT",
  demo_subtitle:
    "Un recorrido paso a paso del sistema: desde la instalación hasta los resultados.",
  demo_s0_title: "Descarga e inicia",
  demo_s0_desc:
    "Descarga el instalador de escritorio para tu sistema operativo, completa el primer arranque y deja que el launcher abra el panel local en tu navegador.",
  demo_s1_title: "Configura el perfil",
  demo_s1_desc:
    "Introduce nombre, competencias, zona de búsqueda y tipo de trabajo. Los agentes se calibran según tu perfil para buscar las ofertas adecuadas.",
  demo_s2_title: "Inicia el equipo",
  demo_s2_desc:
    'Desde la página Equipo, pulsa "Iniciar todos". Cada agente se activa en su sesión: el Scout busca, el Analista evalúa, el Scorer clasifica.',
  demo_s3_title: "Pipeline en acción",
  demo_s3_desc:
    "El pipeline trabaja de forma autónoma. El Scout encuentra ofertas, el Analista las examina, el Scorer calcula la coincidencia, el Escritor prepara los documentos.",
  demo_s4_title: "Panel de resultados",
  demo_s4_desc:
    "En el panel ves las candidaturas listas, la puntuación de coincidencia y el estado de cada oferta. Aprueba, edita o descarta con un clic.",
  demo_s5_title: "Candidatura final",
  demo_s5_desc:
    "El Crítico revisa cada documento. Cuando todo está listo, apruebas el envío. Tú siempre al mando, los agentes ejecutan.",
  demo_cta: "Pruébalo ahora",
  demo_prev: "Anterior",
  demo_next: "Siguiente",
  demo_all_steps: "Todos los pasos",

  // CTA
  cta_title_1: "¿Listo para revolucionar",
  cta_title_2: "tu búsqueda de empleo?",
  cta_desc:
    "Deja de enviar candidaturas genéricas. Que un equipo de agentes IA trabaje por ti, de forma inteligente y personalizada.",
  cta_button: "Empieza ahora — es gratis",
  cta_team: "Conoce al equipo",
  cta_note: "No se requiere tarjeta de crédito · Beta pública",

  // Footer
  footer_jht: "Job Hunter Team",
  footer_brand_desc:
    "Un equipo de agentes IA que busca empleo por ti. Open source, local, privado.",
  footer_product: "Producto",
  footer_stats: "Proyecto",
  footer_report: "Informes",
  footer_resources: "Recursos",
  footer_guide: "Guía",
  footer_docs: "Documentación",
  footer_about: "Quiénes somos",
  footer_contacts: "Contacto",
  footer_bug: "Reportar un error",
  footer_discuss: "Discusiones",
  footer_privacy: "Política de privacidad",
  footer_terms: "Términos del servicio",
  footer_copyright: "Open Source bajo licencia MIT",

  // Download page
  dl_desc:
    "El panel web de JHT puede iniciarse desde el launcher de escritorio o desde la terminal mediante una configuración avanzada con CLI y TUI. El runtime se ejecuta en tu ordenador y tus datos permanecen bajo tu control.",
  dl_back: "← Atrás",
  dl_title_1: "Configura tu equipo",
  dl_title_2: "en tu PC",
  dl_toggle_hide: "− Ocultar otras opciones",
  dl_toggle_show: "+ Otras opciones (otros SO / arquitecturas)",
  dl_copy_cmd: "Copiar comando",
  dl_norelease_title: "Aún no se ha publicado ninguna release de escritorio",
  dl_norelease_desc:
    "En cuanto se publique la próxima release, esta página ofrecerá la descarga directa. Mientras tanto, puedes usar la instalación desde terminal de abajo o consultar la lista en GitHub.",
  dl_open_releases: "Abrir GitHub Releases",
  dl_detected_label: "Detectado",
  dl_download_for: "Descargar para",
  dl_detected: "detectado",
  dl_mode_desktop_title: "Escritorio",
  dl_mode_terminal_title: "CLI",
  dl_instructions: "Instrucciones",
  dl_close: "Cerrar",
  dl_download: "Descargar",
  dl_view_release: "Ver release",
  dl_asset_pending:
    "El instalador aún no está presente en la última release: se abre la página de la release en lugar de la descarga directa.",
  dl_how_title: "Cómo funciona",
  dl_step1_title: "Descarga",
  dl_step1_desc: "Elige el paquete para tu sistema operativo",
  dl_step2_title: "Inicia",
  dl_step2_desc:
    "Abre el launcher de escritorio y deja que el bootstrap y el arranque del runtime se ejecuten automáticamente",
  dl_step3_title: "Usa",
  dl_step3_desc:
    "El navegador se abre en localhost con el panel web del equipo",
  dl_setup_title: "Nota de instalación",
  dl_setup_desc:
    "Los paquetes de escritorio para macOS, Windows y Linux incluyen el launcher y el payload web ya listo. La CLI y la TUI ofrecen en cambio un acceso más avanzado al mismo runtime local. En Linux pueden hacer falta bibliotecas de sistema estándar para AppImage.",
  dl_terminal_title: "Terminal",
  dl_terminal_desc:
    "Si prefieres partir desde la línea de comandos, puedes clonar el repositorio e iniciar el panel web local o usar CLI y TUI para un control más avanzado del runtime.",
  dl_terminal_source_tab: "Desde el código fuente",
  dl_terminal_cli_tab: "One-liner",
  dl_terminal_source_title: "Compilar desde el código fuente",
  dl_terminal_source_desc:
    "Clona el repo, compila TUI y CLI. Recomendado para quienes quieran contribuir.",
  dl_terminal_source_note:
    "Tras la compilación puedes lanzar el asistente con node cli/bin/jht.js. Los datos van a ~/.jht y ~/Documents/Job Hunter Team.",
  dl_terminal_cli_title: "Instalador one-liner",
  dl_terminal_cli_desc:
    "Instala todo con un solo comando: dependencias del sistema, Node, Claude CLI, repo y asistente.",
  dl_terminal_cli_note:
    "Compatible con macOS, Linux (apt/dnf/pacman) y WSL. Crea ~/.jht (config, BD, agentes) y ~/Documents/Job Hunter Team (CV, salida).",
  dl_setup_link: "Node.js disponible en",
  dl_home: "Inicio",
  dl_all_releases: "Todas las releases",
  dl_demo_question: "¿Quieres ver cómo funciona antes de descargar?",
  dl_demo_cta: "Mira la demo interactiva",
  dl_mac_guide_title: "Guía de instalación de macOS",
  dl_mac_prereq_title: "Requisitos",
  dl_mac_node_title: "Paso 1 — Abre el paquete",
  dl_mac_node_desc:
    "El launcher de escritorio no requiere una instalación de Node.js aparte. Para empezar:",
  dl_mac_node_alt:
    'Si Gatekeeper bloquea la app, ve a Ajustes del Sistema > Privacidad y seguridad y elige "Abrir igualmente".',
  dl_mac_install_title: "Paso 2 — Descarga e inicia",
  dl_mac_expect_title: "Qué sucede",

  // Guide page
  guide_title: "Guía del usuario",
  guide_subtitle:
    "Cómo instalar, configurar y usar Job Hunter Team con el launcher de escritorio, el panel local y herramientas avanzadas.",
  guide_docs_link: "Documentación técnica",

  // FAQ page
  faq_title: "Preguntas frecuentes",
  faq_subtitle: "Todo lo que necesitas saber sobre Job Hunter Team.",
  faq_no_answer: "¿No encuentras la respuesta?",
  faq_no_answer_desc: "Consulta la guía completa o la documentación técnica.",
  faq_guide_btn: "Guía del usuario",
  faq_docs_btn: "Documentación",

  // About page
  about_badge: "quiénes somos",
  about_title_1: "Un equipo de agentes IA",
  about_title_2: "a tu servicio",
  about_intro:
    "Job Hunter Team es un proyecto open-source que automatiza la búsqueda de empleo con un sistema multiagente. Cada agente tiene un rol preciso, y juntos forman un pipeline completo: desde el descubrimiento de ofertas hasta la candidatura final.",
  about_story_label: "la historia",
  about_story_title: "Cómo nació el proyecto",
  about_story_desc:
    "Job Hunter Team nació de la idea de que buscar empleo no debería ser un trabajo a tiempo completo. Candidarse requiere horas de búsqueda, personalización de CV y cartas de presentación, seguimiento de candidaturas. Pensamos: ¿y si un equipo de agentes IA pudiera hacer todo esto por ti?",
  about_tl_0: "Idea inicial — sistema multiagente para la búsqueda de empleo",
  about_tl_1: "Primer prototipo con pipeline Scout → Analista → Scorer",
  about_tl_2: "Añadidos el panel local y herramientas de terminal avanzadas",
  about_tl_3: "Beta pública — launcher de escritorio y equipo operativo",
  about_agents_label: "el equipo",
  about_agents_title: "Los agentes",
  about_agents_desc:
    "El sistema incluye 7 agentes operativos especializados y un asistente de apoyo. Trabajan en local, coordinados por un runtime común y un pipeline estructurado.",
  about_agent_alfa_name: "Capitán",
  about_agent_alfa_desc:
    "El coordinador del equipo. Recibe las directrices del usuario, asigna las tareas a los agentes, monitorea el progreso y garantiza que el pipeline funcione sin contratiempos. Es el punto de contacto entre tú y el equipo.",
  about_agent_scout_name: "Scout",
  about_agent_scout_desc:
    "El explorador. Escanea portales de empleo, LinkedIn, canales de Telegram y otras fuentes en busca de ofertas relevantes. Filtra el ruido y lleva al equipo solo las oportunidades que coinciden con tu perfil.",
  about_agent_analista_name: "Analista",
  about_agent_analista_desc:
    "El estratega. Analiza cada oferta en profundidad: requisitos, cultura de empresa, tecnologías, seniority. Produce un informe estructurado para cada puesto, destacando puntos fuertes y riesgos.",
  about_agent_scorer_name: "Scorer",
  about_agent_scorer_desc:
    "El evaluador. Calcula una puntuación de coincidencia entre tu perfil y cada oferta analizada. Considera competencias técnicas, experiencia, ubicación, salario y preferencias personales. Las mejores ofertas suben a lo más alto.",
  about_agent_scrittore_name: "Escritor",
  about_agent_scrittore_desc:
    "El copywriter. Para cada candidatura aprobada, genera un CV personalizado y una carta de presentación a medida. Adapta el tono, las keywords y la estructura a los requisitos específicos del puesto y de la empresa.",
  about_agent_critico_name: "Crítico",
  about_agent_critico_desc:
    "El revisor. Examina con ojo crítico cada documento producido por el Escritor: coherencia, errores, keywords ausentes, tono inadecuado. Si es necesario, devuelve el trabajo al Escritor con feedback preciso.",
  about_agent_sentinella_name: "Centinela",
  about_agent_sentinella_desc:
    "El guardián. Monitorea los costes de API, el consumo de tokens, la latencia y la salud del sistema. Te avisa si algo va mal y garantiza que el equipo opere dentro de los límites de presupuesto establecidos.",
  about_agent_assistente_name: "Asistente",
  about_agent_assistente_desc:
    "El apoyo. Responde a tus preguntas, te guía en la configuración, explica las decisiones de los demás agentes. Es tu referente cuando necesitas ayuda o quieres entender qué está pasando.",
  about_how_label: "arquitectura",
  about_how_title: "Cómo funciona el sistema",
  about_how_desc:
    "Job Hunter Team usa una arquitectura multiagente local: cada agente se ejecuta como un worker independiente, mientras el runtime coordina los pasos, el estado y la comunicación entre los módulos.",
  about_how_0: "Cada agente se ejecuta como un worker local aislado",
  about_how_1:
    "El runtime orquesta los pasos y mensajes estructurados entre los módulos",
  about_how_2:
    "Pipeline coordinado: Scout → Analista → Scorer → Escritor → Crítico",
  about_how_3: "Sistema de tareas con estado (pendiente → en curso → hecho)",
  about_how_4: "El Centinela monitorea costes y salud en tiempo real",
  about_vision_label: "visión",
  about_vision_title: "El futuro",
  about_vision_desc:
    "Estamos construyendo el futuro de la búsqueda de empleo automatizada. Nuestra visión es un sistema que aprende de tus preferencias, mejora con cada candidatura y te permite centrarte en lo que importa: prepararte para las entrevistas.",
  about_vision_0: "Aprendizaje continuo a partir del feedback del usuario",
  about_vision_1: "Integración directa con portales de candidatura",
  about_vision_2: "Preparación automática de entrevistas con simulacros",
  about_vision_3: "Networking asistido y seguimientos automatizados",

  // Onboarding wizard
  ob_title: "Bienvenido a Job Hunter Team",
  ob_skip: "Saltar",
  ob_next: "Siguiente",
  ob_back: "Atrás",
  ob_finish: "Empieza a buscar",
  ob_step: "Paso",
  ob_s1_title: "Bienvenido",
  ob_s1_desc:
    "Job Hunter Team es tu equipo personal de agentes IA. Buscan ofertas, las analizan, escriben CV y cartas de presentación a medida — todo de forma automática, todo en tu ordenador.",
  ob_s1_hint: "Configuremos juntos tu espacio en 5 pasos rápidos.",
  ob_s2_title: "Configura el perfil",
  ob_s2_desc:
    "Indica tu nombre, el puesto que buscas y un breve resumen de tu experiencia. Los agentes usarán esta información para personalizar cada candidatura.",
  ob_s2_name: "Nombre",
  ob_s2_role: "Puesto objetivo",
  ob_s2_bio: "Breve bio",
  ob_s3_title: "Elige las competencias",
  ob_s3_desc:
    "Selecciona las tecnologías y competencias que conoces. El Scorer las usará para calcular la coincidencia con cada oferta.",
  ob_s3_hint:
    "Haz clic para seleccionar, haz clic de nuevo para deseleccionar.",
  ob_s4_title: "Conecta un proveedor de IA",
  ob_s4_desc:
    "Los agentes se ejecutan en una de las tres CLI compatibles (Claude Code, Codex, Kimi). Necesitarás iniciar sesión con la suscripción que ya tienes activa con el proveedor; JHT no pide ni almacena claves API.",
  ob_s4_placeholder: "claude login / codex login / kimi login",
  ob_s4_hint:
    "El inicio de sesión se realiza dentro del contenedor desde la terminal de la CLI elegida. Los tokens de sesión los gestiona la CLI en local.",
  ob_s5_title: "Inicia el primer agente",
  ob_s5_desc:
    "¡Todo listo! Pulsa el botón para iniciar el Scout — el primer agente que buscará ofertas por ti. Podrás iniciar el equipo completo desde la página Equipo.",
  ob_s5_launch: "Iniciar Scout",
  ob_s5_skip_agent: "Lo haré después",
  ob_s5_launched: "¡Scout iniciado!",

  // Home-beta: tabla top matches
  table_title: "Top {n} coincidencias",
  table_updated: "Actualizado",
  table_match_score: "Coincidencia",
  table_title_col: "Puesto",
  table_company: "Empresa",
  table_location: "Ubicación",
  table_salary: "Salario",
  table_cv: "CV",
  table_empty: "Aún no hay posiciones.",

  // Home-beta: nodos del team flow
  agent_captain: "Capitán",
  agent_scout: "Scout",
  agent_analyst: "Analista",
  agent_scorer: "Scorer",
  agent_writer: "Escritor",
  agent_critic: "Crítico",

  // Home-beta: speech bubbles del team flow
  chat_captain_go: "¡OK equipo, vamos!",
  chat_captain_profile: "Objetivo: Sommelier en hoteles 5★",
  chat_scout_europe: "¡Encontrados 3 en Europa!",
  chat_scout_asia: "Asia en camino…",
  chat_scout_usa: "¡Gran mercado USA!",
  chat_analyst_check: "Verifico la coincidencia…",
  chat_captain_good: "Todo bien",
  chat_scorer_top: "Top matches encontrados",
  chat_writer_cvs: "Escribo los CV…",
  chat_critic_reviewing: "Revisión…",
};
