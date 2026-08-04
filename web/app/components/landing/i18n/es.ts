// Overlay traduzioni Español (es). Sovrascrive le chiavi presenti sopra la
// base it/en/hu; le chiavi assenti ripiegano automaticamente su `en`.
export const es: Record<string, string> = {
  // Chiavi aggiunte (allineamento i18n)
  home_intro:
    "Job Hunter Team es un equipo de agentes IA autónomos que buscan empleo por ti, sin descanso. Cada agente es un especialista: uno localiza las ofertas, otro las analiza en detalle y otro asigna a cada una una puntuación, según lo cerca que esté de lo que de verdad te importa. Si se lo pides, también preparan el CV para que te presentes. Un agente dedicado también te ayuda a orientarte en el mercado laboral y a acercarte al puesto que deseas. Observar el mercado es un uso completo del producto. La dirección la marcas tú y la última palabra es siempre tuya; el resto lo lleva adelante el equipo, en privado, en tu propia máquina.",
  theme_system: "sistema",
  theme_dark: "noche",
  theme_light: "día",
  nav_run: "Cómo se inicia",
  nav_team: "Equipo",
  home_pricing_alt:
    "Un candado abierto rodeado de unas pocas monedas, una verde brillante: la plataforma es gratuita y open source, solo pagas el proveedor de IA.",
  // Nav
  // Invariati rispetto all'inglese per scelta di prodotto: il marchio
  // usa "Home" e "Studies" in tutte e sette le lingue, italiano
  // compreso. Dichiarati esplicitamente perché il fallback silenzioso
  // non distingue una decisione da una dimenticanza.
  nav_home: "Home",
  nav_case_studies: "Studies",
  nav_github: "GitHub",
  nav_download: "Instalar",
  nav_project: "Proyecto",
  nav_pricing: "Precios",
  nav_login: "Iniciar sesión",

  // Hero
  hero_badge: "beta pública",
  hero_desc_short:
    "Un equipo de agentes IA autónomos para tu búsqueda de empleo.",

  // CTA
  cta_title_1: "¿Listo para revolucionar",
  cta_title_2: "tu búsqueda de empleo?",
  cta_button: "Empezar",

  // Footer
  footer_brand_desc:
    "Un equipo de agentes IA autónomos que busca empleo por ti. Open source, local, privado.",
  footer_product: "Producto",
  footer_stats: "Proyecto",
  footer_resources: "Recursos",
  footer_contacts: "Contacto",
  nav_contact: "Contacto",
  footer_bug: "Reportar un error",
  footer_privacy: "Política de privacidad",
  footer_terms: "Términos del servicio",
  footer_copyright: "Open Source bajo licencia MIT",

  // Download page
  dl_desc:
    "El panel de JHT se inicia desde la terminal, mediante la configuración con CLI y TUI. El runtime se ejecuta en tu ordenador y tus datos permanecen bajo tu control.",
  dl_back: "← Atrás",
  dl_title_1: "Configura tu equipo",
  dl_title_2: "en tu PC",
  dl_copy_cmd: "Copiar comando",
  dl_mode_desktop_title: "Escritorio",
  dl_mode_terminal_title: "CLI",
  dl_desktop_beta_desc:
    "La app de escritorio es la oficina donde ves trabajar al equipo. Está en beta: la usamos a diario, pero cambia a menudo. Si prefieres un camino más asentado, la CLI sigue ahí.",
  dl_desktop_beta_badge: "Beta",
  dl_desktop_unsigned_note:
    "En macOS la app está firmada y notarizada: se abre con doble clic. En Windows no está firmada, así que SmartScreen muestra «Windows protegió su PC»: pulsa «Más información» y luego «Ejecutar de todas formas». En Linux, extrae el archivo y hazlo ejecutable.",
  dl_help_text: "¿No sabes dónde instalarlo?",
  dl_help_link: "Lee la guía",

  // Login page (LandingClient)
  login_save_progress: "Inicia sesión para guardar tu progreso",
  login_auth_failed: "La autenticación falló.",
  login_config_missing: "Falta la configuración.",
  login_with_google: "Iniciar sesión con Google",
  login_with_github: "Iniciar sesión con GitHub",
  back: "Atrás",

  // Aria-labels
  scroll_to_top: "Volver arriba",
  nav_main: "Navegación principal",
  nav_menu: "Menú",
  nav_language: "Idioma: {label}",
  cookie_consent: "Consentimiento de cookies",

  // CTA / Footer aria-labels
  cta_section_aria: "Empezar ahora",
  theme_aria: "Tema",
  footer_aria: "Pie de página de Job Hunter Team",
  footer_links_aria: "Enlaces del pie de página",

  // LandingHome: hero alt + secciones
  home_team_alt:
    "Tres agentes del equipo de cuerpo entero: el Scout con una lupa, el Analista con bata de laboratorio, el Escritor con una pluma de ave — todos con gafas de sol.",
  home_setup_alt:
    "Un portátil que emite un cono de luz azul que se abre hasta un cubo de vidrio luminoso: dentro está la oficina del equipo trabajando.",
  home_team_kicker: "El equipo",
  home_team_title: "Un equipo, no un solo bot",
  home_team_body:
    "Un solo chatbot tiene que hacerlo todo por su cuenta y no destaca en nada. Un equipo no: cada agente tiene una tarea precisa y la lleva a fondo, y el trabajo de cada uno pasa por el filtro del siguiente. Así cada fase la cuida quien mejor sabe hacerla, y lo que llega a ti ya ha sido revisado varias veces.",
  home_team_cta: "Conoce al equipo →",
  home_setup_kicker: "Ejecútalo",
  home_setup_title: "Como quieras, donde quieras",
  home_setup_body:
    "Funciona en un ordenador dedicado siempre encendido o en una VPS económica, y trabaja para ti día y noche. Lo gestionas desde la app de escritorio: inicias, detienes y vigilas al equipo con un clic. Y no estás atado a ese ordenador: desde la web puedes seguir los resultados y hablar con el equipo también desde otro PC o el móvil.",
  home_setup_cta: "Cómo ejecutarlo →",
  home_pricing_kicker: "Precios",
  home_pricing_title: "Código abierto. La plataforma es gratis.",
  home_pricing_body:
    "Job Hunter Team no se paga. El único coste es la suscripción al proveedor de IA que elijas — desde unos €40 al mes — o nada, si algún día usas modelos locales y solo pagas la electricidad.",
  home_pricing_cta: "Mira los costes →",
};
