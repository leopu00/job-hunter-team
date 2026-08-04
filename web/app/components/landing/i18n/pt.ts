// Overlay traduzioni Português (pt-PT). Sovrascrive le chiavi presenti sopra
// la base it/en/hu; le chiavi assenti ripiegano automaticamente su `en`.
export const pt: Record<string, string> = {
  // Chiavi aggiunte (allineamento i18n)
  home_intro:
    "O Job Hunter Team é uma equipa de agentes IA autónomos que procuram emprego por ti, sem parar. Cada agente é um especialista: um localiza as ofertas, outro analisa-as em detalhe e outro atribui a cada uma uma pontuação, consoante o quão perto está do que realmente te importa. A teu pedido, preparam também o CV para te candidatares. Um agente dedicado também te ajuda a orientares-te no mercado de trabalho e a aproximares-te do cargo que desejas. Observar o mercado é uma utilização completa do produto. A direção dá-la tu e a última palavra é sempre tua; o resto leva-o adiante a equipa, em privado, na tua própria máquina.",
  theme_system: "sistema",
  theme_dark: "noite",
  theme_light: "dia",
  nav_run: "Como iniciar",
  nav_team: "Equipa",
  home_pricing_alt:
    "Um cadeado aberto rodeado por algumas moedas, uma verde brilhante: a plataforma é gratuita e open source, só pagas o fornecedor de IA.",
  // Nav
  // Invariati rispetto all'inglese per scelta di prodotto: il marchio
  // usa "Home" e "Studies" in tutte e sette le lingue, italiano
  // compreso. Dichiarati esplicitamente perché il fallback silenzioso
  // non distingue una decisione da una dimenticanza.
  nav_home: "Home",
  nav_case_studies: "Studies",
  nav_github: "GitHub",
  nav_download: "Instalar",
  nav_project: "Projeto",
  nav_tutorials: "Tutoriais",
  nav_pricing: "Preços",
  nav_login: "Entrar",

  // Hero
  hero_badge: "beta pública",
  hero_desc_short:
    "Uma equipa de agentes IA autónomos para a tua procura de emprego.",

  // CTA
  cta_title_1: "Pronto para revolucionar",
  cta_title_2: "a tua procura de emprego?",
  cta_button: "Começar",

  // Footer
  footer_brand_desc:
    "Uma equipa de agentes IA autónomos que procura emprego por ti. Open source, local, privado.",
  footer_product: "Produto",
  footer_stats: "Projeto",
  footer_resources: "Recursos",
  footer_tutorials: "Tutoriais",
  footer_contacts: "Contactos",
  nav_contact: "Contacto",
  footer_bug: "Reportar um erro",
  footer_privacy: "Política de Privacidade",
  footer_terms: "Termos de Serviço",
  footer_copyright: "Open Source sob licença MIT",
  tutorials_title: "Tutoriais",
  tutorial_game_title: "Jogo",
  tutorial_web_title: "Web",
  trailer_title: "Trailer",

  // Download page
  dl_desc:
    "O painel do JHT é iniciado a partir do terminal, através da configuração com CLI e TUI. O runtime corre no teu computador e os teus dados permanecem sob o teu controlo.",
  dl_back: "← Voltar",
  dl_title_1: "Configura a tua equipa",
  dl_title_2: "no teu PC",
  dl_copy_cmd: "Copiar comando",
  dl_mode_desktop_title: "Desktop",
  dl_mode_terminal_title: "CLI",
  dl_desktop_beta_desc:
    "A app de ambiente de trabalho é o escritório onde vês a equipa trabalhar. Está em beta: usamo-la todos os dias, mas muda com frequência. Se preferires um caminho mais assente, a CLI continua disponível.",
  dl_desktop_beta_badge: "Beta",
  dl_desktop_unsigned_note:
    "No macOS a app está assinada e notarizada: abre com duplo clique. No Windows não está assinada, por isso o SmartScreen mostra «O Windows protegeu o seu PC»: clica em «Mais informações» e depois «Executar mesmo assim». No Linux, extrai o arquivo e torna-o executável.",
  dl_help_text: "Não sabes onde instalá-lo?",
  dl_help_link: "Lê o guia",

  // Login page (LandingClient)
  login_save_progress: "Entre para guardar o seu progresso",
  login_auth_failed: "A autenticação falhou.",
  login_config_missing: "Configuração em falta.",
  login_with_google: "Entrar com Google",
  login_with_github: "Entrar com GitHub",
  back: "Voltar",

  // Aria-labels
  scroll_to_top: "Voltar ao topo",
  nav_main: "Navegação principal",
  nav_menu: "Menu",
  nav_language: "Idioma: {label}",
  cookie_consent: "Consentimento de cookies",

  // CTA / Footer aria-labels
  cta_section_aria: "Começar agora",
  theme_aria: "Tema",
  footer_aria: "Rodapé do Job Hunter Team",
  footer_links_aria: "Ligações do rodapé",

  // LandingHome: hero alt + secções
  home_team_alt:
    "Três agentes da equipa de corpo inteiro: o Scout com uma lupa, o Analista de bata, o Escritor com uma pena de ave — todos a usar óculos de sol.",
  home_setup_alt:
    "Um portátil que emite um cone de luz azul que se abre num cubo de vidro luminoso: lá dentro está o escritório da equipa a trabalhar.",
  home_team_kicker: "A equipa",
  home_team_title: "Uma equipa, não um único bot",
  home_team_body:
    "Um único chatbot tem de fazer tudo sozinho e não se destaca em nada. Uma equipa não: cada agente tem uma tarefa precisa e leva-a a fundo, e o trabalho de cada um passa pelo crivo do seguinte. Assim cada fase é tratada por quem melhor a sabe fazer, e o que chega até ti já foi verificado várias vezes.",
  home_team_cta: "Conheça a equipa →",
  home_setup_kicker: "Execute-o",
  home_setup_title: "Como quiser, onde quiser",
  home_setup_body:
    "Corre num computador dedicado sempre ligado ou numa VPS económica, e trabalha para ti dia e noite. Geres tudo a partir da app de ambiente de trabalho: inicias, paras e vigias a equipa com um clique. E não ficas preso a esse computador: pela web podes acompanhar os resultados e falar com a equipa também a partir de outro PC ou do telemóvel.",
  home_setup_cta: "Como executá-lo →",
  home_pricing_kicker: "Preços",
  home_pricing_title: "Código aberto. A plataforma é gratuita.",
  home_pricing_body:
    "O Job Hunter Team não se paga. O único custo é a subscrição do fornecedor de IA que escolher — a partir de cerca de €40 por mês — ou nada, se um dia usar modelos locais e pagar apenas a eletricidade.",
  home_pricing_cta: "Veja os custos →",
};
