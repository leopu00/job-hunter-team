// Overlay traduzioni Français (fr). Sovrascrive le chiavi presenti sopra la
// base it/en/hu; le chiavi assenti ripiegano automaticamente su `en`.
export const fr: Record<string, string> = {
  // Chiavi aggiunte (allineamento i18n)
  home_intro:
    "Job Hunter Team est une équipe d'agents IA autonomes qui cherchent un emploi pour vous, sans relâche. Chaque agent est un spécialiste : l'un repère les offres, un autre les analyse en détail et un autre attribue à chacune une note, selon sa proximité avec ce qui compte vraiment pour vous. Sur votre demande, ils préparent aussi le CV pour votre candidature. Et quand les candidatures envoyées ne suffisent pas à trouver un emploi, un agent dédié vous accompagne : il vous aide à vous orienter sur le marché du travail et à vous rapprocher du poste que vous désirez. C'est vous qui donnez la direction et gardez le dernier mot ; le reste, l'équipe s'en charge, en privé, sur votre propre machine.",
  theme_system: "système",
  theme_dark: "nuit",
  theme_light: "jour",
  nav_run: "Comment le lancer",
  nav_team: "Équipe",
  home_pricing_alt:
    "Un cadenas ouvert entouré de quelques pièces, une verte lumineuse : la plateforme est gratuite et open source, vous ne payez que le fournisseur d'IA.",
  // Nav
  nav_github: "GitHub",
  nav_download: "Installer",
  nav_project: "Projet",
  nav_pricing: "Tarifs",
  nav_login: "Se connecter",

  // Hero
  hero_badge: "bêta publique",
  hero_desc_short:
    "Une équipe d'agents IA autonomes pour votre recherche d'emploi.",

  // CTA
  cta_title_1: "Prêt à révolutionner",
  cta_title_2: "votre recherche d'emploi ?",
  cta_button: "Commencer",

  // Footer
  footer_brand_desc:
    "Une équipe d'agents IA autonomes qui cherche un emploi pour vous. Open source, local, privé.",
  footer_product: "Produit",
  footer_stats: "Projet",
  footer_resources: "Ressources",
  footer_contacts: "Contacts",
  footer_write: "Écris-nous",
  footer_bug: "Signaler un bug",
  footer_privacy: "Politique de confidentialité",
  footer_terms: "Conditions d'utilisation",
  footer_copyright: "Open Source sous licence MIT",

  // Download page
  dl_desc:
    "Le tableau de bord de JHT se lance depuis le terminal, via la configuration CLI et TUI. Le runtime tourne sur votre ordinateur et vos données restent sous votre contrôle.",
  dl_back: "← Retour",
  dl_title_1: "Configurez votre équipe",
  dl_title_2: "sur votre PC",
  dl_copy_cmd: "Copier la commande",
  dl_mode_desktop_title: "Bureau",
  dl_mode_terminal_title: "CLI",
  dl_desktop_soon_desc:
    "L'app de bureau arrive sur les trois systèmes d'exploitation : nous la peaufinons et elle n'est pas encore téléchargeable. En attendant, la CLI installe tout.",
  dl_desktop_soon_badge: "Bientôt disponible",
  dl_help_text: "Vous ne savez pas où l'installer ?",
  dl_help_link: "Lire le guide",

  // Login page (LandingClient)
  login_save_progress: "Connectez-vous pour sauvegarder votre progression",
  login_auth_failed: "L'authentification a échoué.",
  login_config_missing: "Configuration manquante.",
  login_with_google: "Se connecter avec Google",
  login_with_github: "Se connecter avec GitHub",
  back: "Retour",

  // Aria-labels
  scroll_to_top: "Retour en haut",
  nav_main: "Navigation principale",
  nav_menu: "Menu",
  nav_language: "Langue : {label}",
  cookie_consent: "Consentement aux cookies",

  // CTA / Footer aria-labels
  cta_section_aria: "Commencer",
  theme_aria: "Thème",
  footer_aria: "Pied de page Job Hunter Team",
  footer_links_aria: "Liens du pied de page",

  // LandingHome: hero alt + sections
  home_hero_alt:
    "Illustration de style BD : une équipe d'agents IA — tous portant les mêmes lunettes de soleil noires — assis autour d'une longue table de réunion dans un élégant bureau de gratte-ciel, tandis qu'un agent debout présente des graphiques sur un tableau.",
  home_team_alt:
    "Trois agents de l'équipe en pied : le Scout avec une loupe, l'Analyste en blouse de laboratoire, le Rédacteur avec une plume d'oie — tous portant des lunettes de soleil.",
  home_setup_alt:
    "Un ordinateur portable émettant un cône de lumière bleue qui s'ouvre sur un cube de verre lumineux : à l'intérieur se trouve le bureau de l'équipe au travail.",
  home_team_kicker: "L'équipe",
  home_team_title: "Une équipe, pas un seul bot",
  home_team_body:
    "Un seul chatbot doit tout faire lui-même et n'excelle en rien. Une équipe, non : chaque agent a une tâche précise et la mène à fond, et le travail de chacun passe au crible du suivant. Ainsi chaque étape est confiée à celui qui sait le mieux la faire, et ce qui vous parvient a déjà été vérifié plusieurs fois.",
  home_team_cta: "Découvrez l'équipe →",
  home_setup_kicker: "Lancez-le",
  home_setup_title: "Comme vous voulez, où vous voulez",
  home_setup_body:
    "Elle tourne sur un ordinateur dédié toujours allumé ou sur un VPS économique, et travaille pour vous jour et nuit. Vous la gérez depuis l’app de bureau : vous démarrez, arrêtez et surveillez l’équipe d’un clic. Et vous n’êtes pas lié à cet ordinateur : depuis le web, vous pouvez suivre les résultats et parler à l’équipe aussi depuis un autre PC ou votre téléphone.",
  home_setup_cta: "Comment le lancer →",
  home_pricing_kicker: "Tarifs",
  home_pricing_title: "Open source. La plateforme est gratuite.",
  home_pricing_body:
    "Job Hunter Team est gratuit. Le seul coût est l'abonnement au fournisseur IA que vous choisissez — à partir d'environ 40 € par mois — ou rien, si un jour vous utilisez des modèles locaux et ne payez que l'électricité.",
  home_pricing_cta: "Voir les coûts →",
};
