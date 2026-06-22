"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/use-locale";

/* ── i18n inline ─────────────────────────────────────────────────── */

const T: Record<string, Record<string, string>> = {
  attach_title: {
    it: "Allega CV, certificati o altri documenti",
    en: "Attach CV, certificates or other documents",
    hu: "CV, bizonyítványok vagy más dokumentumok csatolása",
    es: "Adjunta CV, certificados u otros documentos",
    de: "Lebenslauf, Zeugnisse oder andere Dokumente anhängen",
    fr: "Joindre un CV, des certificats ou d'autres documents",
    pt: "Anexar CV, certificados ou outros documentos",
  },
  attach_aria: {
    it: "Allega file",
    en: "Attach file",
    hu: "Fájl csatolása",
    es: "Adjuntar archivo",
    de: "Datei anhängen",
    fr: "Joindre un fichier",
    pt: "Anexar ficheiro",
  },
  ph_name: {
    it: "Mario Rossi",
    en: "John Smith",
    hu: "Kovács János",
    es: "Juan Pérez",
    de: "Max Mustermann",
    fr: "Jean Dupont",
    pt: "João Silva",
  },
  ph_experience: {
    it: "Es. 5",
    en: "E.g. 5",
    hu: "Pl. 5",
    es: "Ej. 5",
    de: "Z. B. 5",
    fr: "Ex. 5",
    pt: "Ex. 5",
  },
  ph_email: {
    it: "nome@example.com",
    en: "name@example.com",
    hu: "nev@example.com",
    es: "nombre@example.com",
    de: "name@example.com",
    fr: "nom@example.com",
    pt: "nome@example.com",
  },
  ph_phone: {
    it: "+39 …",
    en: "+1 …",
    hu: "+36 …",
    es: "+34 …",
    de: "+49 …",
    fr: "+33 …",
    pt: "+351 …",
  },
  mic_title: {
    it: "Microfono bloccato",
    en: "Microphone blocked",
    hu: "Mikrofon letiltva",
    es: "Micrófono bloqueado",
    de: "Mikrofon blockiert",
    fr: "Microphone bloqué",
    pt: "Microfone bloqueado",
  },
  mic_intro: {
    it: "Per dettare a voce devi autorizzare Chrome a usare il microfono su questa pagina. Due modi rapidi:",
    en: "To dictate by voice you must allow Chrome to use the microphone on this page. Two quick ways:",
    hu: "A hangos diktáláshoz engedélyezned kell a Chrome számára a mikrofon használatát ezen az oldalon. Két gyors módszer:",
    es: "Para dictar por voz debes autorizar a Chrome a usar el micrófono en esta página. Dos formas rápidas:",
    de: "Um per Sprache zu diktieren, musst du Chrome erlauben, das Mikrofon auf dieser Seite zu verwenden. Zwei schnelle Wege:",
    fr: "Pour dicter à la voix, vous devez autoriser Chrome à utiliser le microphone sur cette page. Deux moyens rapides :",
    pt: "Para ditar por voz tens de autorizar o Chrome a usar o microfone nesta página. Duas formas rápidas:",
  },
  mic_step1: {
    it: 'Clicca il <strong>lucchetto 🔒</strong> accanto a <code class="text-[10.5px] px-1 rounded bg-[var(--color-panel)]">localhost:3000</code> nella barra indirizzi → <strong>Impostazioni sito</strong> → <strong>Microfono</strong> → <strong>Consenti</strong>.',
    en: 'Click the <strong>padlock 🔒</strong> next to <code class="text-[10.5px] px-1 rounded bg-[var(--color-panel)]">localhost:3000</code> in the address bar → <strong>Site settings</strong> → <strong>Microphone</strong> → <strong>Allow</strong>.',
    hu: 'Kattints a <strong>lakatra 🔒</strong> a <code class="text-[10.5px] px-1 rounded bg-[var(--color-panel)]">localhost:3000</code> mellett a címsorban → <strong>Webhely beállításai</strong> → <strong>Mikrofon</strong> → <strong>Engedélyezés</strong>.',
    es: 'Haz clic en el <strong>candado 🔒</strong> junto a <code class="text-[10.5px] px-1 rounded bg-[var(--color-panel)]">localhost:3000</code> en la barra de direcciones → <strong>Configuración del sitio</strong> → <strong>Micrófono</strong> → <strong>Permitir</strong>.',
    de: 'Klicke auf das <strong>Schloss 🔒</strong> neben <code class="text-[10.5px] px-1 rounded bg-[var(--color-panel)]">localhost:3000</code> in der Adressleiste → <strong>Website-Einstellungen</strong> → <strong>Mikrofon</strong> → <strong>Zulassen</strong>.',
    fr: 'Cliquez sur le <strong>cadenas 🔒</strong> à côté de <code class="text-[10.5px] px-1 rounded bg-[var(--color-panel)]">localhost:3000</code> dans la barre d\'adresse → <strong>Paramètres du site</strong> → <strong>Microphone</strong> → <strong>Autoriser</strong>.',
    pt: 'Clica no <strong>cadeado 🔒</strong> ao lado de <code class="text-[10.5px] px-1 rounded bg-[var(--color-panel)]">localhost:3000</code> na barra de endereços → <strong>Definições do site</strong> → <strong>Microfone</strong> → <strong>Permitir</strong>.',
  },
  mic_step2_pre: {
    it: "In alternativa apri le impostazioni globali:",
    en: "Alternatively open the global settings:",
    hu: "Másik lehetőségként nyisd meg a globális beállításokat:",
    es: "Como alternativa, abre la configuración global:",
    de: "Alternativ öffne die globalen Einstellungen:",
    fr: "Vous pouvez aussi ouvrir les paramètres globaux :",
    pt: "Em alternativa, abre as definições globais:",
  },
  mic_step2_post: {
    it: "e aggiungi",
    en: "and add",
    hu: "és add hozzá a",
    es: "y añade",
    de: "und füge",
    fr: "et ajoutez",
    pt: "e adiciona",
  },
  mic_step2_allow: {
    it: "a <em>Consenti</em>.",
    en: "to <em>Allow</em>.",
    hu: "az <em>Engedélyezés</em> listához.",
    es: "a <em>Permitir</em>.",
    de: "zu <em>Zulassen</em> hinzu.",
    fr: "à <em>Autoriser</em>.",
    pt: "a <em>Permitir</em>.",
  },
  mic_step3: {
    it: "Se hai anche il check a livello macOS: <strong>Impostazioni → Privacy → Microfono</strong> → spunta Chrome.",
    en: "If you also have the macOS-level check: <strong>Settings → Privacy → Microphone</strong> → tick Chrome.",
    hu: "Ha a macOS szintű ellenőrzés is aktív: <strong>Beállítások → Adatvédelem → Mikrofon</strong> → pipáld ki a Chrome-ot.",
    es: "Si también tienes el control a nivel de macOS: <strong>Ajustes → Privacidad → Micrófono</strong> → marca Chrome.",
    de: "Falls du auch die Prüfung auf macOS-Ebene hast: <strong>Einstellungen → Datenschutz → Mikrofon</strong> → Chrome ankreuzen.",
    fr: "Si vous avez aussi le contrôle au niveau de macOS : <strong>Réglages → Confidentialité → Microphone</strong> → cochez Chrome.",
    pt: "Se também tens o controlo ao nível do macOS: <strong>Definições → Privacidade → Microfone</strong> → marca o Chrome.",
  },
  mic_footer: {
    it: "Fatto uno dei passaggi, ricarica la pagina o clicca <em>Riprova</em>: Chrome ti riproporrà il prompt del microfono.",
    en: "Once you've done one of these steps, reload the page or click <em>Retry</em>: Chrome will show the microphone prompt again.",
    hu: "Ha elvégezted az egyik lépést, töltsd újra az oldalt vagy kattints az <em>Újra</em> gombra: a Chrome újra felkínálja a mikrofon engedélyezését.",
    es: "Tras realizar uno de los pasos, recarga la página o haz clic en <em>Reintentar</em>: Chrome volverá a mostrar el aviso del micrófono.",
    de: "Wenn du einen der Schritte ausgeführt hast, lade die Seite neu oder klicke auf <em>Erneut versuchen</em>: Chrome zeigt die Mikrofon-Abfrage erneut an.",
    fr: "Après avoir effectué l'une de ces étapes, rechargez la page ou cliquez sur <em>Réessayer</em> : Chrome réaffichera l'invite du microphone.",
    pt: "Depois de fazer um dos passos, recarrega a página ou clica em <em>Tentar novamente</em>: o Chrome volta a mostrar o pedido do microfone.",
  },
  mic_close: {
    it: "Chiudi",
    en: "Close",
    hu: "Bezárás",
    es: "Cerrar",
    de: "Schließen",
    fr: "Fermer",
    pt: "Fechar",
  },
  mic_retry: {
    it: "Riprova 🎤",
    en: "Retry 🎤",
    hu: "Újra 🎤",
    es: "Reintentar 🎤",
    de: "Erneut versuchen 🎤",
    fr: "Réessayer 🎤",
    pt: "Tentar novamente 🎤",
  },

  /* ── Welcome (iniettato dal boot script, non più dal client) ───── */
  welcome_text: {
    it: "Ciao! Aiutami a configurare il mio profilo. Puoi farmi qualche domanda oppure dirmi come caricare il mio CV.",
    en: "Hi! Help me set up my profile. You can ask me a few questions or tell me how to upload my CV.",
    hu: "Szia! Segíts beállítani a profilomat. Tehetsz fel néhány kérdést, vagy elmondhatod, hogyan töltsem fel a CV-met.",
    es: "¡Hola! Ayúdame a configurar mi perfil. Puedes hacerme algunas preguntas o decirme cómo subir mi CV.",
    de: "Hallo! Hilf mir, mein Profil einzurichten. Du kannst mir ein paar Fragen stellen oder mir sagen, wie ich meinen Lebenslauf hochlade.",
    fr: "Bonjour ! Aidez-moi à configurer mon profil. Vous pouvez me poser quelques questions ou m'expliquer comment téléverser mon CV.",
    pt: "Olá! Ajuda-me a configurar o meu perfil. Podes fazer-me algumas perguntas ou dizer-me como carregar o meu CV.",
  },

  /* ── Header pagina ─────────────────────────────────────────────── */
  page_h1_pre: {
    it: "Configura il tuo ",
    en: "Set up your ",
    hu: "Állítsd be a ",
    es: "Configura tu ",
    de: "Richte dein ",
    fr: "Configurez votre ",
    pt: "Configura o teu ",
  },
  page_h1_accent: {
    it: "profilo",
    en: "profile",
    hu: "profilodat",
    es: "perfil",
    de: "Profil ein",
    fr: "profil",
    pt: "perfil",
  },
  page_subtitle: {
    it: "Costruisci il tuo profilo con l'aiuto dell'assistente a destra. Man mano che vi confrontate, il pannello a sinistra si aggiorna automaticamente.",
    en: "Build your profile with the help of the assistant on the right. As you chat, the panel on the left updates automatically.",
    hu: "Építsd fel a profilodat a jobb oldali asszisztens segítségével. Ahogy beszélgettek, a bal oldali panel automatikusan frissül.",
    es: "Construye tu perfil con la ayuda del asistente a la derecha. A medida que conversáis, el panel de la izquierda se actualiza automáticamente.",
    de: "Erstelle dein Profil mit Hilfe des Assistenten auf der rechten Seite. Während ihr euch austauscht, wird das Panel links automatisch aktualisiert.",
    fr: "Construisez votre profil avec l'aide de l'assistant à droite. Au fil de vos échanges, le panneau de gauche se met à jour automatiquement.",
    pt: "Constrói o teu perfil com a ajuda do assistente à direita. À medida que conversam, o painel à esquerda atualiza-se automaticamente.",
  },

  /* ── Header pannelli ───────────────────────────────────────────── */
  panel_profile_config: {
    it: "configurazione profilo",
    en: "profile configuration",
    hu: "profil beállítása",
    es: "configuración del perfil",
    de: "Profilkonfiguration",
    fr: "configuration du profil",
    pt: "configuração do perfil",
  },
  panel_assistant: {
    it: "assistente",
    en: "assistant",
    hu: "asszisztens",
    es: "asistente",
    de: "Assistent",
    fr: "assistant",
    pt: "assistente",
  },

  /* ── Bottone procedi ───────────────────────────────────────────── */
  go_to_dashboard: {
    it: "Vai alla dashboard →",
    en: "Go to dashboard →",
    hu: "Irány az irányítópult →",
    es: "Ir al panel →",
    de: "Zum Dashboard →",
    fr: "Aller au tableau de bord →",
    pt: "Ir para o painel →",
  },
  waiting_assistant: {
    it: "In attesa dell'assistente…",
    en: "Waiting for the assistant…",
    hu: "Várakozás az asszisztensre…",
    es: "Esperando al asistente…",
    de: "Warten auf den Assistenten…",
    fr: "En attente de l'assistant…",
    pt: "À espera do assistente…",
  },

  /* ── Stati chat ────────────────────────────────────────────────── */
  close: {
    it: "chiudi",
    en: "close",
    hu: "bezárás",
    es: "cerrar",
    de: "schließen",
    fr: "fermer",
    pt: "fechar",
  },
  assistant_starting: {
    it: "Avvio dell'assistente in corso…",
    en: "Starting the assistant…",
    hu: "Az asszisztens indítása folyamatban…",
    es: "Iniciando el asistente…",
    de: "Assistent wird gestartet…",
    fr: "Démarrage de l'assistant…",
    pt: "A iniciar o assistente…",
  },

  /* ── Errori avvio ──────────────────────────────────────────────── */
  start_failed_http: {
    it: "avvio fallito (HTTP {status})",
    en: "start failed (HTTP {status})",
    hu: "az indítás sikertelen (HTTP {status})",
    es: "fallo al iniciar (HTTP {status})",
    de: "Start fehlgeschlagen (HTTP {status})",
    fr: "échec du démarrage (HTTP {status})",
    pt: "falha no arranque (HTTP {status})",
  },
  network_error: {
    it: "errore di rete",
    en: "network error",
    hu: "hálózati hiba",
    es: "error de red",
    de: "Netzwerkfehler",
    fr: "erreur réseau",
    pt: "erro de rede",
  },

  /* ── Errori voce ───────────────────────────────────────────────── */
  speech_unsupported: {
    it: "SpeechRecognition non supportato da questo browser",
    en: "SpeechRecognition not supported by this browser",
    hu: "A SpeechRecognition nem támogatott ebben a böngészőben",
    es: "SpeechRecognition no es compatible con este navegador",
    de: "SpeechRecognition wird von diesem Browser nicht unterstützt",
    fr: "SpeechRecognition n'est pas pris en charge par ce navigateur",
    pt: "SpeechRecognition não é suportado por este navegador",
  },
  speech_mic_error: {
    it: "Mic {name}: {msg}",
    en: "Mic {name}: {msg}",
    hu: "Mikrofon {name}: {msg}",
    es: "Micrófono {name}: {msg}",
    de: "Mikrofon {name}: {msg}",
    fr: "Micro {name} : {msg}",
    pt: "Microfone {name}: {msg}",
  },
  speech_init_error: {
    it: "Errore init: {msg}",
    en: "Init error: {msg}",
    hu: "Inicializálási hiba: {msg}",
    es: "Error de inicialización: {msg}",
    de: "Init-Fehler: {msg}",
    fr: "Erreur d'initialisation : {msg}",
    pt: "Erro de inicialização: {msg}",
  },
  speech_mic_generic_error: {
    it: "Errore mic: {msg}",
    en: "Mic error: {msg}",
    hu: "Mikrofonhiba: {msg}",
    es: "Error de micrófono: {msg}",
    de: "Mikrofonfehler: {msg}",
    fr: "Erreur micro : {msg}",
    pt: "Erro de microfone: {msg}",
  },
  speech_start_failed: {
    it: "Start fallito: {msg}",
    en: "Start failed: {msg}",
    hu: "Az indítás sikertelen: {msg}",
    es: "Fallo al iniciar: {msg}",
    de: "Start fehlgeschlagen: {msg}",
    fr: "Échec du démarrage : {msg}",
    pt: "Falha no arranque: {msg}",
  },

  /* ── Microfono / input ─────────────────────────────────────────── */
  mic_stop: {
    it: "Ferma registrazione",
    en: "Stop recording",
    hu: "Felvétel leállítása",
    es: "Detener grabación",
    de: "Aufnahme stoppen",
    fr: "Arrêter l'enregistrement",
    pt: "Parar gravação",
  },
  mic_dictate: {
    it: "Detta a voce ({lang})",
    en: "Dictate by voice ({lang})",
    hu: "Diktálás hanggal ({lang})",
    es: "Dictar por voz ({lang})",
    de: "Per Sprache diktieren ({lang})",
    fr: "Dicter à la voix ({lang})",
    pt: "Ditar por voz ({lang})",
  },
  mic_start_aria: {
    it: "Avvia registrazione vocale",
    en: "Start voice recording",
    hu: "Hangfelvétel indítása",
    es: "Iniciar grabación de voz",
    de: "Sprachaufnahme starten",
    fr: "Démarrer l'enregistrement vocal",
    pt: "Iniciar gravação de voz",
  },
  input_files_attached_one: {
    it: "{n} file allegato — aggiungi un messaggio…",
    en: "{n} file attached — add a message…",
    hu: "{n} fájl csatolva — adj hozzá egy üzenetet…",
    es: "{n} archivo adjunto — añade un mensaje…",
    de: "{n} Datei angehängt — füge eine Nachricht hinzu…",
    fr: "{n} fichier joint — ajoutez un message…",
    pt: "{n} ficheiro anexado — adiciona uma mensagem…",
  },
  input_files_attached_many: {
    it: "{n} file allegati — aggiungi un messaggio…",
    en: "{n} files attached — add a message…",
    hu: "{n} fájl csatolva — adj hozzá egy üzenetet…",
    es: "{n} archivos adjuntos — añade un mensaje…",
    de: "{n} Dateien angehängt — füge eine Nachricht hinzu…",
    fr: "{n} fichiers joints — ajoutez un message…",
    pt: "{n} ficheiros anexados — adiciona uma mensagem…",
  },
  input_write_assistant: {
    it: "Scrivi all'assistente…",
    en: "Write to the assistant…",
    hu: "Írj az asszisztensnek…",
    es: "Escribe al asistente…",
    de: "Schreibe dem Assistenten…",
    fr: "Écrivez à l'assistant…",
    pt: "Escreve ao assistente…",
  },
  send: {
    it: "invia",
    en: "send",
    hu: "küldés",
    es: "enviar",
    de: "senden",
    fr: "envoyer",
    pt: "enviar",
  },

  /* ── Avatar aria ───────────────────────────────────────────────── */
  avatar_you: {
    it: "tu",
    en: "you",
    hu: "te",
    es: "tú",
    de: "du",
    fr: "vous",
    pt: "tu",
  },

  /* ── Sezioni profilo ───────────────────────────────────────────── */
  sec_identity: {
    it: "Identità",
    en: "Identity",
    hu: "Azonosság",
    es: "Identidad",
    de: "Identität",
    fr: "Identité",
    pt: "Identidade",
  },
  sec_contacts: {
    it: "Contatti",
    en: "Contacts",
    hu: "Kapcsolatok",
    es: "Contactos",
    de: "Kontakte",
    fr: "Contacts",
    pt: "Contatos",
  },
  sec_skills: {
    it: "Competenze",
    en: "Skills",
    hu: "Készségek",
    es: "Habilidades",
    de: "Fähigkeiten",
    fr: "Compétences",
    pt: "Competências",
  },
  sec_languages: {
    it: "Lingue",
    en: "Languages",
    hu: "Nyelvek",
    es: "Idiomas",
    de: "Sprachen",
    fr: "Langues",
    pt: "Idiomas",
  },
  sec_experience: {
    it: "Esperienza",
    en: "Experience",
    hu: "Tapasztalat",
    es: "Experiencia",
    de: "Erfahrung",
    fr: "Expérience",
    pt: "Experiência",
  },
  sec_sector_details: {
    it: "Dettagli del settore",
    en: "Sector details",
    hu: "Ágazati részletek",
    es: "Detalles del sector",
    de: "Branchendetails",
    fr: "Détails du secteur",
    pt: "Detalhes do setor",
  },
  sec_projects: {
    it: "Progetti",
    en: "Projects",
    hu: "Projektek",
    es: "Proyectos",
    de: "Projekte",
    fr: "Projets",
    pt: "Projetos",
  },
  sec_certifications: {
    it: "Certificazioni",
    en: "Certifications",
    hu: "Tanúsítványok",
    es: "Certificaciones",
    de: "Zertifizierungen",
    fr: "Certifications",
    pt: "Certificações",
  },
  sec_education: {
    it: "Titoli di studio",
    en: "Education",
    hu: "Végzettség",
    es: "Formación",
    de: "Ausbildung",
    fr: "Formation",
    pt: "Formação",
  },
  sec_work_prefs: {
    it: "Preferenze di lavoro",
    en: "Work preferences",
    hu: "Munkavégzési preferenciák",
    es: "Preferencias laborales",
    de: "Arbeitspräferenzen",
    fr: "Préférences de travail",
    pt: "Preferências de trabalho",
  },

  /* ── Field label ───────────────────────────────────────────────── */
  fld_name: {
    it: "Nome",
    en: "Name",
    hu: "Név",
    es: "Nombre",
    de: "Name",
    fr: "Nom",
    pt: "Nome",
  },
  fld_target_role: {
    it: "Ruolo target",
    en: "Target role",
    hu: "Cél pozíció",
    es: "Puesto objetivo",
    de: "Zielposition",
    fr: "Poste visé",
    pt: "Cargo-alvo",
  },
  fld_location: {
    it: "Località",
    en: "Location",
    hu: "Helyszín",
    es: "Ubicación",
    de: "Standort",
    fr: "Localisation",
    pt: "Localização",
  },
  fld_years_experience: {
    it: "Anni esperienza",
    en: "Years of experience",
    hu: "Évek tapasztalat",
    es: "Años de experiencia",
    de: "Jahre Erfahrung",
    fr: "Années d'expérience",
    pt: "Anos de experiência",
  },
  fld_email: {
    it: "Email",
    en: "Email",
    hu: "E-mail",
    es: "Email",
    de: "E-Mail",
    fr: "Email",
    pt: "Email",
  },
  fld_phone: {
    it: "Telefono",
    en: "Phone",
    hu: "Telefon",
    es: "Teléfono",
    de: "Telefon",
    fr: "Téléphone",
    pt: "Telefone",
  },
  fld_website: {
    it: "Sito",
    en: "Website",
    hu: "Weboldal",
    es: "Sitio web",
    de: "Webseite",
    fr: "Site web",
    pt: "Site",
  },
  fld_work_mode: {
    it: "Modalità",
    en: "Mode",
    hu: "Munkamód",
    es: "Modalidad",
    de: "Modus",
    fr: "Mode",
    pt: "Modalidade",
  },
  fld_relocation: {
    it: "Trasferimento",
    en: "Relocation",
    hu: "Költözés",
    es: "Traslado",
    de: "Umzug",
    fr: "Déménagement",
    pt: "Mudança",
  },
  fld_salary: {
    it: "Retribuzione",
    en: "Salary",
    hu: "Fizetés",
    es: "Salario",
    de: "Vergütung",
    fr: "Rémunération",
    pt: "Remuneração",
  },

  /* ── Valori / formattazioni ────────────────────────────────────── */
  relocation_available: {
    it: "disponibile",
    en: "available",
    hu: "elérhető",
    es: "disponible",
    de: "verfügbar",
    fr: "disponible",
    pt: "disponível",
  },
  relocation_unavailable: {
    it: "non disponibile",
    en: "not available",
    hu: "nem elérhető",
    es: "no disponible",
    de: "nicht verfügbar",
    fr: "non disponible",
    pt: "indisponível",
  },
  year_singular: {
    it: "anno",
    en: "year",
    hu: "év",
    es: "año",
    de: "Jahr",
    fr: "an",
    pt: "ano",
  },
  year_plural: {
    it: "anni",
    en: "years",
    hu: "év",
    es: "años",
    de: "Jahre",
    fr: "ans",
    pt: "anos",
  },
  more_other_f: {
    it: "+{n} altre",
    en: "+{n} more",
    hu: "+{n} további",
    es: "+{n} más",
    de: "+{n} weitere",
    fr: "+{n} autres",
    pt: "+{n} mais",
  },
  more_other_m: {
    it: "+{n} altri",
    en: "+{n} more",
    hu: "+{n} további",
    es: "+{n} más",
    de: "+{n} weitere",
    fr: "+{n} autres",
    pt: "+{n} mais",
  },

  /* ── Placeholder fallback ──────────────────────────────────────── */
  ph_languages: {
    it: "Italiano C2 · Inglese B2",
    en: "Italian C2 · English B2",
    hu: "Olasz C2 · Angol B2",
    es: "Italiano C2 · Inglés B2",
    de: "Italienisch C2 · Englisch B2",
    fr: "Italien C2 · Anglais B2",
    pt: "Italiano C2 · Inglês B2",
  },
  ph_work_prefs: {
    it: "Es. Remoto · Disponibile al trasferimento · 30–35k",
    en: "E.g. Remote · Open to relocation · 30–35k",
    hu: "Pl. Távmunka · Költözésre nyitott · 30–35k",
    es: "Ej. Remoto · Disponible para traslado · 30–35k",
    de: "Z. B. Remote · Umzugsbereit · 30–35k",
    fr: "Ex. Télétravail · Ouvert au déménagement · 30–35k",
    pt: "Ex. Remoto · Disponível para mudança · 30–35k",
  },
};

/* ── Tag locale BCP-47 per Intl/date e nome lingua per dettatura ─── */
const LOCALE_TAG: Record<string, string> = {
  it: "it-IT",
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  hu: "hu-HU",
  pt: "pt-PT",
};

/* Placeholder per settore, per ogni lingua. Indice condiviso = stesso
   settore tra ruoli / località / esperienza / titoli / competenze. */
const PLACEHOLDERS: Record<
  string,
  {
    roles: string[];
    locations: string[];
    experience: string[];
    education: string[];
    skills: string[][];
  }
> = {
  it: {
    roles: [
      "Es. Sous chef",
      "Es. Infermiere di reparto",
      "Es. Avvocato civilista",
      "Es. Graphic designer",
      "Es. Insegnante di scuola primaria",
      "Es. Project manager",
      "Es. Estetista",
      "Es. Elettricista specializzato",
      "Es. Addetto vendita",
      "Es. Full Stack Developer",
    ],
    locations: [
      "Es. Bologna, IT",
      "Es. Napoli, IT",
      "Es. Palermo, IT",
      "Es. Torino, IT",
      "Es. Verona, IT",
      "Es. Firenze, IT",
      "Es. Bari, IT",
      "Es. Genova, IT",
      "Es. Cagliari, IT",
      "Es. Milano, IT",
    ],
    experience: [
      "Es. Capopartita · Ristorante Da Mario · 4 anni",
      "Es. Infermiere · Ospedale San Raffaele · 6 anni",
      "Es. Avvocato associato · Studio Rossi & C. · 3 anni",
      "Es. Art director · Agenzia Pop · 5 anni",
      "Es. Insegnante di sostegno · IC Verdi · 7 anni",
      "Es. Project manager · Acme Srl · 4 anni",
      "Es. Responsabile SPA · Hotel Terme · 3 anni",
      "Es. Elettricista · Impianti Neri · 8 anni",
      "Es. Commessa · Boutique Luna · 2 anni",
      "Es. Senior Developer · Acme · 3 anni",
    ],
    education: [
      "Es. Diploma Istituto Alberghiero · IPSAR Milano",
      "Es. Laurea in Scienze Infermieristiche · Università di Bologna",
      "Es. Laurea magistrale in Giurisprudenza · La Sapienza",
      "Es. Diploma Accademia Belle Arti · Brera",
      "Es. Laurea in Scienze della Formazione · Università di Padova",
      "Es. Laurea in Economia · Bocconi",
      "Es. Diploma tecnico · ITIS Fermi",
      "Es. Qualifica professionale · CFP Salesiani",
      "Es. Diploma scientifico · Liceo Galilei",
      "Es. Laurea in Informatica · Università di …",
    ],
    skills: [
      ["Cucina italiana", "Pasticceria", "Gestione magazzino", "…"],
      ["Triage", "Assistenza post-op", "Medicazioni", "…"],
      ["Diritto civile", "Stesura atti", "Udienze", "…"],
      ["Photoshop", "Illustrazione", "Branding", "…"],
      ["Didattica inclusiva", "Programmazione lezioni", "Valutazione", "…"],
      ["Team leadership", "Budgeting", "Public speaking", "…"],
      ["Massaggi", "Trattamenti viso", "Consulenza prodotto", "…"],
      ["Impianti civili", "Quadri elettrici", "Sicurezza CEI", "…"],
      ["Vendita assistita", "Visual merchandising", "Gestione cassa", "…"],
      ["React", "Python", "PostgreSQL", "…"],
    ],
  },
  en: {
    roles: [
      "E.g. Sous chef",
      "E.g. Ward nurse",
      "E.g. Civil lawyer",
      "E.g. Graphic designer",
      "E.g. Primary school teacher",
      "E.g. Project manager",
      "E.g. Beautician",
      "E.g. Licensed electrician",
      "E.g. Sales assistant",
      "E.g. Full Stack Developer",
    ],
    locations: [
      "E.g. Manchester, UK",
      "E.g. Bristol, UK",
      "E.g. Leeds, UK",
      "E.g. Glasgow, UK",
      "E.g. Liverpool, UK",
      "E.g. Sheffield, UK",
      "E.g. Cardiff, UK",
      "E.g. Newcastle, UK",
      "E.g. Edinburgh, UK",
      "E.g. London, UK",
    ],
    experience: [
      "E.g. Line cook · Da Mario Restaurant · 4 years",
      "E.g. Nurse · St. Mary's Hospital · 6 years",
      "E.g. Associate lawyer · Smith & Co. · 3 years",
      "E.g. Art director · Pop Agency · 5 years",
      "E.g. Support teacher · Green Primary · 7 years",
      "E.g. Project manager · Acme Ltd · 4 years",
      "E.g. Spa manager · Thermae Hotel · 3 years",
      "E.g. Electrician · Bright Wiring · 8 years",
      "E.g. Sales assistant · Luna Boutique · 2 years",
      "E.g. Senior Developer · Acme · 3 years",
    ],
    education: [
      "E.g. Catering College diploma · Milan IPSAR",
      "E.g. BSc in Nursing · University of Bologna",
      "E.g. Master's in Law · La Sapienza",
      "E.g. Fine Arts Academy diploma · Brera",
      "E.g. BA in Education · University of Padua",
      "E.g. Degree in Economics · Bocconi",
      "E.g. Technical diploma · Fermi Institute",
      "E.g. Vocational qualification · Salesian VTC",
      "E.g. Scientific diploma · Galilei High School",
      "E.g. BSc in Computer Science · University of …",
    ],
    skills: [
      ["Italian cuisine", "Pastry", "Inventory management", "…"],
      ["Triage", "Post-op care", "Wound care", "…"],
      ["Civil law", "Drafting documents", "Court hearings", "…"],
      ["Photoshop", "Illustration", "Branding", "…"],
      ["Inclusive teaching", "Lesson planning", "Assessment", "…"],
      ["Team leadership", "Budgeting", "Public speaking", "…"],
      ["Massage", "Facial treatments", "Product advice", "…"],
      ["Domestic wiring", "Switchboards", "Electrical safety", "…"],
      ["Assisted selling", "Visual merchandising", "Cash handling", "…"],
      ["React", "Python", "PostgreSQL", "…"],
    ],
  },
  es: {
    roles: [
      "Ej. Sous chef",
      "Ej. Enfermero de planta",
      "Ej. Abogado civilista",
      "Ej. Diseñador gráfico",
      "Ej. Maestro de primaria",
      "Ej. Jefe de proyecto",
      "Ej. Esteticista",
      "Ej. Electricista especializado",
      "Ej. Dependiente de ventas",
      "Ej. Full Stack Developer",
    ],
    locations: [
      "Ej. Valencia, ES",
      "Ej. Sevilla, ES",
      "Ej. Bilbao, ES",
      "Ej. Zaragoza, ES",
      "Ej. Málaga, ES",
      "Ej. Granada, ES",
      "Ej. Murcia, ES",
      "Ej. Vigo, ES",
      "Ej. Valladolid, ES",
      "Ej. Madrid, ES",
    ],
    experience: [
      "Ej. Cocinero de partida · Restaurante Da Mario · 4 años",
      "Ej. Enfermero · Hospital San Rafael · 6 años",
      "Ej. Abogado asociado · Bufete Rossi · 3 años",
      "Ej. Director de arte · Agencia Pop · 5 años",
      "Ej. Maestro de apoyo · CEIP Verdi · 7 años",
      "Ej. Jefe de proyecto · Acme S.L. · 4 años",
      "Ej. Responsable de SPA · Hotel Termas · 3 años",
      "Ej. Electricista · Instalaciones Neri · 8 años",
      "Ej. Dependiente · Boutique Luna · 2 años",
      "Ej. Senior Developer · Acme · 3 años",
    ],
    education: [
      "Ej. Diploma de Escuela de Hostelería · IPSAR Milán",
      "Ej. Grado en Enfermería · Universidad de Bolonia",
      "Ej. Máster en Derecho · La Sapienza",
      "Ej. Diploma de Bellas Artes · Brera",
      "Ej. Grado en Educación · Universidad de Padua",
      "Ej. Grado en Economía · Bocconi",
      "Ej. Diploma técnico · Instituto Fermi",
      "Ej. Cualificación profesional · CFP Salesianos",
      "Ej. Bachillerato científico · Liceo Galilei",
      "Ej. Grado en Informática · Universidad de …",
    ],
    skills: [
      ["Cocina italiana", "Pastelería", "Gestión de almacén", "…"],
      ["Triaje", "Cuidados postoperatorios", "Curas", "…"],
      ["Derecho civil", "Redacción de escritos", "Vistas", "…"],
      ["Photoshop", "Ilustración", "Branding", "…"],
      ["Enseñanza inclusiva", "Planificación de clases", "Evaluación", "…"],
      ["Liderazgo de equipos", "Presupuestos", "Hablar en público", "…"],
      ["Masajes", "Tratamientos faciales", "Asesoría de producto", "…"],
      ["Instalaciones domésticas", "Cuadros eléctricos", "Seguridad eléctrica", "…"],
      ["Venta asistida", "Visual merchandising", "Gestión de caja", "…"],
      ["React", "Python", "PostgreSQL", "…"],
    ],
  },
  fr: {
    roles: [
      "Ex. Sous-chef",
      "Ex. Infirmier de service",
      "Ex. Avocat civiliste",
      "Ex. Graphiste",
      "Ex. Professeur des écoles",
      "Ex. Chef de projet",
      "Ex. Esthéticienne",
      "Ex. Électricien qualifié",
      "Ex. Vendeur",
      "Ex. Full Stack Developer",
    ],
    locations: [
      "Ex. Lyon, FR",
      "Ex. Marseille, FR",
      "Ex. Toulouse, FR",
      "Ex. Bordeaux, FR",
      "Ex. Lille, FR",
      "Ex. Nantes, FR",
      "Ex. Strasbourg, FR",
      "Ex. Nice, FR",
      "Ex. Rennes, FR",
      "Ex. Paris, FR",
    ],
    experience: [
      "Ex. Chef de partie · Restaurant Da Mario · 4 ans",
      "Ex. Infirmier · Hôpital Saint-Raphaël · 6 ans",
      "Ex. Avocat collaborateur · Cabinet Rossi · 3 ans",
      "Ex. Directeur artistique · Agence Pop · 5 ans",
      "Ex. Enseignant spécialisé · École Verdi · 7 ans",
      "Ex. Chef de projet · Acme SARL · 4 ans",
      "Ex. Responsable SPA · Hôtel Thermal · 3 ans",
      "Ex. Électricien · Installations Neri · 8 ans",
      "Ex. Vendeuse · Boutique Luna · 2 ans",
      "Ex. Senior Developer · Acme · 3 ans",
    ],
    education: [
      "Ex. Diplôme d'école hôtelière · IPSAR Milan",
      "Ex. Licence en sciences infirmières · Université de Bologne",
      "Ex. Master en droit · La Sapienza",
      "Ex. Diplôme des Beaux-Arts · Brera",
      "Ex. Licence en sciences de l'éducation · Université de Padoue",
      "Ex. Licence en économie · Bocconi",
      "Ex. Diplôme technique · Institut Fermi",
      "Ex. Qualification professionnelle · CFP Salésiens",
      "Ex. Baccalauréat scientifique · Lycée Galilei",
      "Ex. Licence en informatique · Université de …",
    ],
    skills: [
      ["Cuisine italienne", "Pâtisserie", "Gestion des stocks", "…"],
      ["Triage", "Soins post-opératoires", "Pansements", "…"],
      ["Droit civil", "Rédaction d'actes", "Audiences", "…"],
      ["Photoshop", "Illustration", "Branding", "…"],
      ["Pédagogie inclusive", "Préparation des cours", "Évaluation", "…"],
      ["Management d'équipe", "Budgétisation", "Prise de parole", "…"],
      ["Massages", "Soins du visage", "Conseil produit", "…"],
      ["Installations domestiques", "Tableaux électriques", "Sécurité électrique", "…"],
      ["Vente assistée", "Merchandising visuel", "Tenue de caisse", "…"],
      ["React", "Python", "PostgreSQL", "…"],
    ],
  },
  de: {
    roles: [
      "Z. B. Sous-Chef",
      "Z. B. Stationspfleger",
      "Z. B. Zivilrechtsanwalt",
      "Z. B. Grafikdesigner",
      "Z. B. Grundschullehrer",
      "Z. B. Projektmanager",
      "Z. B. Kosmetiker",
      "Z. B. Geprüfter Elektriker",
      "Z. B. Verkäufer",
      "Z. B. Full Stack Developer",
    ],
    locations: [
      "Z. B. München, DE",
      "Z. B. Hamburg, DE",
      "Z. B. Köln, DE",
      "Z. B. Frankfurt, DE",
      "Z. B. Stuttgart, DE",
      "Z. B. Düsseldorf, DE",
      "Z. B. Leipzig, DE",
      "Z. B. Dresden, DE",
      "Z. B. Hannover, DE",
      "Z. B. Berlin, DE",
    ],
    experience: [
      "Z. B. Chef de Partie · Restaurant Da Mario · 4 Jahre",
      "Z. B. Pfleger · St.-Raphael-Klinik · 6 Jahre",
      "Z. B. Anwalt · Kanzlei Rossi · 3 Jahre",
      "Z. B. Art Director · Agentur Pop · 5 Jahre",
      "Z. B. Förderlehrer · Verdi-Schule · 7 Jahre",
      "Z. B. Projektmanager · Acme GmbH · 4 Jahre",
      "Z. B. Spa-Leiter · Thermenhotel · 3 Jahre",
      "Z. B. Elektriker · Elektro Neri · 8 Jahre",
      "Z. B. Verkäuferin · Boutique Luna · 2 Jahre",
      "Z. B. Senior Developer · Acme · 3 Jahre",
    ],
    education: [
      "Z. B. Diplom Hotelfachschule · IPSAR Mailand",
      "Z. B. BSc Pflegewissenschaft · Universität Bologna",
      "Z. B. Master in Rechtswissenschaft · La Sapienza",
      "Z. B. Diplom Kunstakademie · Brera",
      "Z. B. BA Erziehungswissenschaft · Universität Padua",
      "Z. B. Studium der Wirtschaft · Bocconi",
      "Z. B. Technisches Diplom · Fermi-Institut",
      "Z. B. Berufsqualifikation · CFP Salesianer",
      "Z. B. Naturwissenschaftliches Abitur · Galilei-Gymnasium",
      "Z. B. BSc Informatik · Universität …",
    ],
    skills: [
      ["Italienische Küche", "Patisserie", "Lagerverwaltung", "…"],
      ["Triage", "Postoperative Pflege", "Wundversorgung", "…"],
      ["Zivilrecht", "Schriftsatzerstellung", "Verhandlungen", "…"],
      ["Photoshop", "Illustration", "Branding", "…"],
      ["Inklusiver Unterricht", "Unterrichtsplanung", "Bewertung", "…"],
      ["Teamführung", "Budgetierung", "Präsentation", "…"],
      ["Massagen", "Gesichtsbehandlungen", "Produktberatung", "…"],
      ["Hausinstallationen", "Schaltschränke", "Elektrosicherheit", "…"],
      ["Beratungsverkauf", "Visual Merchandising", "Kassenführung", "…"],
      ["React", "Python", "PostgreSQL", "…"],
    ],
  },
  hu: {
    roles: [
      "Pl. Sous chef",
      "Pl. Osztályos ápoló",
      "Pl. Polgári jogi ügyvéd",
      "Pl. Grafikus",
      "Pl. Általános iskolai tanító",
      "Pl. Projektmenedzser",
      "Pl. Kozmetikus",
      "Pl. Szakképzett villanyszerelő",
      "Pl. Eladó",
      "Pl. Full Stack Developer",
    ],
    locations: [
      "Pl. Debrecen, HU",
      "Pl. Szeged, HU",
      "Pl. Miskolc, HU",
      "Pl. Pécs, HU",
      "Pl. Győr, HU",
      "Pl. Nyíregyháza, HU",
      "Pl. Kecskemét, HU",
      "Pl. Székesfehérvár, HU",
      "Pl. Szombathely, HU",
      "Pl. Budapest, HU",
    ],
    experience: [
      "Pl. Szakács · Da Mario Étterem · 4 év",
      "Pl. Ápoló · Szent Rafael Kórház · 6 év",
      "Pl. Ügyvéd · Rossi Ügyvédi Iroda · 3 év",
      "Pl. Art director · Pop Ügynökség · 5 év",
      "Pl. Fejlesztő pedagógus · Verdi Iskola · 7 év",
      "Pl. Projektmenedzser · Acme Kft. · 4 év",
      "Pl. SPA-vezető · Termál Hotel · 3 év",
      "Pl. Villanyszerelő · Neri Villanyszerelés · 8 év",
      "Pl. Eladó · Luna Butik · 2 év",
      "Pl. Senior Developer · Acme · 3 év",
    ],
    education: [
      "Pl. Vendéglátóipari oklevél · IPSAR Milánó",
      "Pl. Ápolástudományi BSc · Bolognai Egyetem",
      "Pl. Jogi mesterképzés · La Sapienza",
      "Pl. Képzőművészeti oklevél · Brera",
      "Pl. Neveléstudományi BA · Padovai Egyetem",
      "Pl. Közgazdaságtan diploma · Bocconi",
      "Pl. Technikusi oklevél · Fermi Intézet",
      "Pl. Szakképzettség · Szalézi Szakképző",
      "Pl. Reál érettségi · Galilei Gimnázium",
      "Pl. Informatikai BSc · … Egyetem",
    ],
    skills: [
      ["Olasz konyha", "Cukrászat", "Raktárkezelés", "…"],
      ["Triázs", "Műtét utáni ellátás", "Kötözés", "…"],
      ["Polgári jog", "Beadványok szerkesztése", "Tárgyalások", "…"],
      ["Photoshop", "Illusztráció", "Branding", "…"],
      ["Inkluzív oktatás", "Óratervezés", "Értékelés", "…"],
      ["Csapatvezetés", "Költségvetés", "Nyilvános beszéd", "…"],
      ["Masszázs", "Arckezelések", "Termék-tanácsadás", "…"],
      ["Háztartási szerelés", "Kapcsolószekrények", "Elektromos biztonság", "…"],
      ["Asszisztált értékesítés", "Visual merchandising", "Pénztárkezelés", "…"],
      ["React", "Python", "PostgreSQL", "…"],
    ],
  },
  pt: {
    roles: [
      "Ex. Sous chef",
      "Ex. Enfermeiro de enfermaria",
      "Ex. Advogado civil",
      "Ex. Designer gráfico",
      "Ex. Professor do 1.º ciclo",
      "Ex. Gestor de projeto",
      "Ex. Esteticista",
      "Ex. Eletricista qualificado",
      "Ex. Assistente de vendas",
      "Ex. Full Stack Developer",
    ],
    locations: [
      "Ex. Porto, PT",
      "Ex. Braga, PT",
      "Ex. Coimbra, PT",
      "Ex. Faro, PT",
      "Ex. Aveiro, PT",
      "Ex. Funchal, PT",
      "Ex. Setúbal, PT",
      "Ex. Évora, PT",
      "Ex. Leiria, PT",
      "Ex. Lisboa, PT",
    ],
    experience: [
      "Ex. Cozinheiro de partida · Restaurante Da Mario · 4 anos",
      "Ex. Enfermeiro · Hospital São Rafael · 6 anos",
      "Ex. Advogado associado · Escritório Rossi · 3 anos",
      "Ex. Diretor de arte · Agência Pop · 5 anos",
      "Ex. Professor de apoio · Escola Verdi · 7 anos",
      "Ex. Gestor de projeto · Acme Lda · 4 anos",
      "Ex. Responsável de SPA · Hotel Termas · 3 anos",
      "Ex. Eletricista · Instalações Neri · 8 anos",
      "Ex. Vendedora · Boutique Luna · 2 anos",
      "Ex. Senior Developer · Acme · 3 anos",
    ],
    education: [
      "Ex. Diploma de Escola de Hotelaria · IPSAR Milão",
      "Ex. Licenciatura em Enfermagem · Universidade de Bolonha",
      "Ex. Mestrado em Direito · La Sapienza",
      "Ex. Diploma de Belas-Artes · Brera",
      "Ex. Licenciatura em Educação · Universidade de Pádua",
      "Ex. Licenciatura em Economia · Bocconi",
      "Ex. Diploma técnico · Instituto Fermi",
      "Ex. Qualificação profissional · CFP Salesianos",
      "Ex. Curso científico · Liceu Galilei",
      "Ex. Licenciatura em Informática · Universidade de …",
    ],
    skills: [
      ["Cozinha italiana", "Pastelaria", "Gestão de armazém", "…"],
      ["Triagem", "Cuidados pós-operatórios", "Pensos", "…"],
      ["Direito civil", "Redação de peças", "Audiências", "…"],
      ["Photoshop", "Ilustração", "Branding", "…"],
      ["Ensino inclusivo", "Planeamento de aulas", "Avaliação", "…"],
      ["Liderança de equipas", "Orçamentação", "Falar em público", "…"],
      ["Massagens", "Tratamentos faciais", "Aconselhamento de produto", "…"],
      ["Instalações domésticas", "Quadros elétricos", "Segurança elétrica", "…"],
      ["Venda assistida", "Visual merchandising", "Gestão de caixa", "…"],
      ["React", "Python", "PostgreSQL", "…"],
    ],
  },
};

function makeTr(locale: string) {
  return (k: string, params?: Record<string, string | number>) => {
    let s = T[k]?.[locale] ?? T[k]?.en ?? k;
    if (params) {
      for (const [pk, pv] of Object.entries(params)) {
        s = s.replaceAll(`{${pk}}`, String(pv));
      }
    }
    return s;
  };
}

// Nome lingua corrente (per "Detta a voce (…)") nella lingua dell'UI.
function languageDisplayName(locale: string): string {
  try {
    const dn = new Intl.DisplayNames([LOCALE_TAG[locale] ?? "en-US"], {
      type: "language",
    });
    return dn.of(locale) ?? locale;
  } catch {
    return locale;
  }
}

// `done` è opzionale per retrocompatibilità: messaggi vecchi senza il flag
// vengono trattati come turno finito (done=true implicito). L'agente usa
// `jht-send --partial` per i checkpoint intermedi (done=false) e mantiene
// accesi i 3 puntini finché non invia un messaggio senza --partial.
type ChatMsg = {
  role: "user" | "assistant";
  text: string;
  ts: number;
  done?: boolean;
};
type AssistantStatus = { active: boolean };

type Profile = {
  name?: string | null;
  email?: string | null;
  location?: string | null;
  target_role?: string | null;
  experience_years?: number | null;
  skills?: Record<string, string[]> | null;
  languages?: Array<{ language?: string | null; level?: string | null }> | null;
  positioning?: {
    contacts?: {
      email?: string | null;
      phone?: string | null;
      linkedin?: string | null;
      github?: string | null;
      website?: string | null;
    };
    experience?: Array<{
      company?: string | null;
      role?: string | null;
      years?: number | string | null;
      summary?: string | null;
    }> | null;
    education?: Array<{
      institution?: string | null;
      degree?: string | null;
      year?: number | string | null;
    }> | null;
    certifications?: Array<{
      name?: string | null;
      issuer?: string | null;
      year?: number | string | null;
    }> | null;
    projects?: Array<{
      name?: string | null;
      description?: string | null;
      tech?: string | string[] | null;
    }> | null;
    preferences?: {
      work_mode?: string | null;
      work_mode_flexibility?: string | null;
      relocation?: boolean | string | null;
      salary_annual_eur?: string | null;
    } | null;
    sector_details?: Record<
      string,
      string | number | boolean | string[] | null
    > | null;
  } | null;
  candidate?: {
    experience?: Array<{
      company?: string | null;
      role?: string | null;
      years?: number | string | null;
      summary?: string | null;
    }> | null;
    education?: Array<{
      institution?: string | null;
      degree?: string | null;
      year?: number | string | null;
    }> | null;
  } | null;
} | null;

// ─────────────────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const locale = useLocale();
  const tr = makeTr(locale);

  // Profilo (sinistra, polling YAML)
  const [profile, setProfile] = useState<Profile>(null);

  // Assistente (destra, polling chat + status)
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [attached, setAttached] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const autoStartedRef = useRef(false);

  // Voice input via Web Speech API (Chrome/Safari on macOS). When the
  // user taps the microphone we open a continuous recognition session
  // in Italian and append each final transcript chunk to the input.
  // Tap again to stop. The browser handles the permission prompt on
  // first use.
  const [isRecording, setIsRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    setSpeechSupported(!!SR);
  }, []);

  const toggleRecording = useCallback(async () => {
    if (typeof window === "undefined") return;
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SR) {
      setSpeechError(tr("speech_unsupported"));
      return;
    }
    if (isRecording && recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        /* ignore */
      }
      return;
    }

    // Pre-flight: forza il prompt di permesso microfono con
    // getUserMedia. In Chromium 2026 SpeechRecognition spesso non
    // chiede il permesso da sola e onerror viene chiamata con un
    // event vuoto. Con getUserMedia otteniamo un errore chiaro
    // (NotAllowedError / NotFoundError) da mostrare all'utente.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Subito chiuso — volevamo solo triggerare/verificare il permesso.
      stream.getTracks().forEach((t) => t.stop());
    } catch (err: any) {
      const name = err?.name || "Error";
      const msg = err?.message || String(err);
      setSpeechError(tr("speech_mic_error", { name, msg }));
      console.error("[getUserMedia] failed", err);
      return;
    }

    let rec: any;
    try {
      rec = new SR();
    } catch (err: any) {
      setSpeechError(tr("speech_init_error", { msg: err?.message ?? String(err) }));
      return;
    }
    rec.lang = LOCALE_TAG[locale] ?? "en-US";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onstart = () => {
      setSpeechError(null);
      setIsRecording(true);
    };
    rec.onresult = (event: any) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalText += r[0].transcript;
      }
      if (finalText) {
        setInput((prev) => (prev ? prev + " " : "") + finalText.trim());
      }
    };
    rec.onend = () => {
      setIsRecording(false);
      recognitionRef.current = null;
    };
    rec.onerror = (event: any) => {
      // SpeechRecognitionErrorEvent non è enumerable su tutti i
      // browser — il campo utile è event.error (stringa: 'not-allowed',
      // 'no-speech', 'audio-capture', 'network', 'aborted',
      // 'language-not-supported', 'service-not-allowed'). Loggo tutti
      // i campi possibili perché console.error(event) spesso stampa
      // solo `{}`.
      const code = event?.error || event?.name || event?.type || "unknown";
      const msg = event?.message || "";
      setSpeechError(
        tr("speech_mic_generic_error", {
          msg: `${code}${msg ? " — " + msg : ""}`,
        }),
      );
      console.error("[SpeechRecognition]", {
        error: event?.error,
        name: event?.name,
        type: event?.type,
        message: event?.message,
        timeStamp: event?.timeStamp,
      });
      setIsRecording(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = rec;
    try {
      rec.start();
    } catch (err: any) {
      setSpeechError(tr("speech_start_failed", { msg: err?.message ?? String(err) }));
      setIsRecording(false);
      recognitionRef.current = null;
    }
  }, [isRecording, locale, tr]);

  // Boot progress bar — the agent's first turn in chat.jsonl typically
  // lands ~50–60s after page mount (container → tmux → kimi TUI → first
  // LLM reply). A static "In attesa…" placeholder for that long feels
  // broken, so we drive a simple bar against a 60s ETA. It caps at 95%
  // until the real first message arrives, then the whole block unmounts.
  const [bootProgress, setBootProgress] = useState(0);
  const bootStartRef = useRef<number | null>(null);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Profilo polling ───────────────────────────────────────────────────────
  // ready = il flag che l'assistente crea quando il profilo è completo
  // abbastanza per la dashboard. Unico gate: non c'è fallback client-side.
  const [profileReady, setProfileReady] = useState(false);
  // Riassunti discorsivi (MD) scritti dall'assistente: about, preferences,
  // goals, strengths. Complementari al YAML, mostrati sotto il profilo.
  const [summaries, setSummaries] = useState<
    Array<{ id: string; title: string; content: string; updatedAt: number }>
  >([]);
  // Documenti originali del candidato archiviati dall'assistente (CV,
  // lettere, certificati). Servono come fallback per gli scrittori CV +
  // trasparenza lato utente ("ecco cosa ho preso in carico").
  const [sources, setSources] = useState<
    Array<{ name: string; size: number; ext: string; updatedAt: number }>
  >([]);

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch("/api/profile");
      if (!res.ok) return;
      const data = (await res.json()) as { profile: Profile; ready?: boolean };
      setProfile(data.profile ?? null);
      setProfileReady(Boolean(data.ready));
    } catch {
      /* noop */
    }
  }, []);

  const fetchSummaries = useCallback(async () => {
    try {
      const res = await fetch("/api/profile/summaries");
      if (!res.ok) return;
      const data = (await res.json()) as {
        summaries?: Array<{
          id: string;
          title: string;
          content: string;
          updatedAt: number;
        }>;
      };
      setSummaries(data.summaries ?? []);
    } catch {
      /* noop */
    }
  }, []);

  const fetchSources = useCallback(async () => {
    try {
      const res = await fetch("/api/profile/sources");
      if (!res.ok) return;
      const data = (await res.json()) as {
        sources?: Array<{
          name: string;
          size: number;
          ext: string;
          updatedAt: number;
        }>;
      };
      setSources(data.sources ?? []);
    } catch {
      /* noop */
    }
  }, []);

  // ── Chat polling ──────────────────────────────────────────────────────────
  const fetchChat = useCallback(async () => {
    try {
      const res = await fetch("/api/assistente/chat?after=0");
      if (!res.ok) return;
      const data = (await res.json()) as { messages?: ChatMsg[] };
      if (data.messages) setMessages(data.messages);
    } catch {
      /* noop */
    }
  }, []);

  // ── Status polling ────────────────────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/assistente/status");
      if (!res.ok) {
        setStatus({ active: false });
        return;
      }
      const data = (await res.json()) as AssistantStatus;
      setStatus(data);
    } catch {
      setStatus({ active: false });
    }
  }, []);

  // ── Start assistente ──────────────────────────────────────────────────────
  const startAssistant = useCallback(async (): Promise<boolean> => {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch("/api/assistente/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok || data.ok === false) {
        setStartError(
          data.error ??
            data.message ??
            tr("start_failed_http", { status: res.status }),
        );
        return false;
      }
      return true;
    } catch (err) {
      setStartError(err instanceof Error ? err.message : tr("network_error"));
      return false;
    } finally {
      setStarting(false);
    }
  }, [tr]);

  // ── Invia messaggio ──────────────────────────────────────────────────────
  const sendText = useCallback(
    async (text: string) => {
      try {
        await fetch("/api/assistente/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        await fetchChat();
      } catch {
        /* noop */
      }
    },
    [fetchChat],
  );

  const handleSend = useCallback(async () => {
    if ((!input.trim() && attached.length === 0) || sending) return;
    setSending(true);
    const textToSend = input.trim();
    const filesToSend = [...attached];
    setInput("");
    setAttached([]);

    let filePaths: string[] = [];
    if (filesToSend.length > 0) {
      try {
        const formData = new FormData();
        filesToSend.forEach((f) => formData.append("files", f));
        const res = await fetch("/api/assistente/upload", {
          method: "POST",
          body: formData,
        });
        const data = (await res.json().catch(() => null)) as {
          saved?: Array<{ name: string; path: string }>;
        } | null;
        filePaths = data?.saved?.map((f) => f.path) ?? [];
      } catch {
        /* noop */
      }
    }

    let fullText = textToSend;
    if (filePaths.length > 0) {
      // Formato compatto: solo il marcatore + i path. Le istruzioni su cosa
      // fare con gli allegati vivono nel system prompt dell'assistente
      // (agents/assistente/assistente.md), non vanno ripetute a ogni turno.
      // Il frontend riconosce [FILE ALLEGATI] e rende i path come chip.
      const list = filePaths.join("\n");
      fullText = fullText
        ? `${fullText}\n\n[FILE ALLEGATI]\n${list}`
        : `[FILE ALLEGATI]\n${list}`;
    }

    if (fullText) await sendText(fullText);
    setSending(false);
  }, [input, attached, sending, sendText]);

  // ── Auto-avvio assistente (nessun welcome client-side) ──────────────────
  // Il welcome prompt viene iniettato dal boot script nel container
  // (.launcher/start-agent.sh → tmux send-keys dopo ~12s). Non mandiamo
  // più un sendText(WELCOME_TEXT) qui, altrimenti l'utente vede due
  // benvenuti sovrapposti.
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (status == null) return;
    if (status.active) {
      autoStartedRef.current = true;
      return;
    }
    autoStartedRef.current = true;
    (async () => {
      await startAssistant();
      await fetchStatus();
    })();
  }, [status, startAssistant, fetchStatus]);

  // ── Polling loops ────────────────────────────────────────────────────────
  useEffect(() => {
    fetchProfile();
    fetchStatus();
    fetchChat();
    fetchSummaries();
    fetchSources();
    const profileId = setInterval(fetchProfile, 2500);
    const statusId = setInterval(fetchStatus, 5000);
    const chatId = setInterval(fetchChat, 3000);
    const summariesId = setInterval(fetchSummaries, 5000);
    const sourcesId = setInterval(fetchSources, 5000);
    return () => {
      clearInterval(profileId);
      clearInterval(statusId);
      clearInterval(chatId);
      clearInterval(summariesId);
      clearInterval(sourcesId);
    };
  }, [fetchProfile, fetchStatus, fetchChat, fetchSummaries, fetchSources]);

  // ── Boot progress bar ────────────────────────────────────────────────────
  useEffect(() => {
    if (messages.length > 0) return;
    if (bootStartRef.current == null) bootStartRef.current = Date.now();
    const ESTIMATED_MS = 60_000;
    const tick = () => {
      const elapsed = Date.now() - (bootStartRef.current ?? Date.now());
      setBootProgress(Math.min(95, (elapsed / ESTIMATED_MS) * 100));
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [messages.length]);

  // ── Auto-scroll chat ─────────────────────────────────────────────────────
  const prevCountRef = useRef(0);
  useEffect(() => {
    if (messages.length > prevCountRef.current && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
    prevCountRef.current = messages.length;
  }, [messages]);

  // ── File handlers ────────────────────────────────────────────────────────
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) setAttached((prev) => [...prev, ...files]);
    e.target.value = "";
  };
  const removeAttached = (i: number) =>
    setAttached((prev) => prev.filter((_, j) => j !== i));

  // ── Completeness gate ────────────────────────────────────────────────────
  // "Profilo davvero configurato" — non bastano nome + ruolo, il team
  // ha bisogno di abbastanza sostanza da poter scrivere un CV serio.
  // Minimum viable:
  //   - identità base (nome, ruolo, città, anni, email)
  //   - almeno 2 skill primarie
  //   - almeno 1 lingua
  //   - almeno 1 esperienza lavorativa
  //   - almeno 1 titolo di studio
  // Il bottone è sbloccato SOLO dall'assistente (crea ~/.jht/profile/ready.flag).
  // Nessuna euristica qui: l'agente sa meglio del frontend quando il profilo
  // è davvero pronto, e può re-bloccare rimuovendo il file se serve.
  const canProceed = profileReady;

  // Altezza divisa per --zoom: la body ha zoom globale, ma `vh` in
  // Chromium è calcolato sul viewport non zoomato → senza la divisione
  // il container trabocca di --zoom volte. Niente -4rem: su /onboarding
  // la navbar è nascosta (FULLSCREEN_FLOWS).
  return (
    <div
      className="flex flex-col max-w-7xl mx-auto px-5 py-5"
      style={{
        height: "calc(100vh / var(--zoom))",
        animation: "fade-in 0.35s ease both",
      }}
    >
      <header className="mb-4">
        <h1 className="text-xl font-bold tracking-tight text-[var(--color-white)]">
          {tr("page_h1_pre")}
          <span className="text-[var(--color-green)]">
            {tr("page_h1_accent")}
          </span>
        </h1>
        <p className="text-[10px] text-[var(--color-dim)] mt-0.5">
          {tr("page_subtitle")}
        </p>
      </header>

      <div className="flex flex-1 gap-4 min-h-0">
        {/* ── Sinistra: Live profile ──────────────────────────────────── */}
        <aside className="w-[46%] flex flex-col min-w-0">
          <div
            className="flex-1 rounded-lg overflow-auto"
            style={{
              background: "var(--color-card)",
              border: "1px solid var(--color-border)",
            }}
          >
            <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center gap-2">
              <Avatar role="user" size={32} />
              <span className="text-[11px] font-semibold tracking-widest uppercase text-[var(--color-muted)]">
                {tr("panel_profile_config")}
              </span>
            </div>
            <ProfileLive
              profile={profile}
              summaries={summaries}
              sources={sources}
            />
          </div>

          <button
            disabled={!canProceed}
            onClick={() => {
              if (canProceed) router.push("/onboarding/cloud");
            }}
            className="mt-3 px-4 py-2.5 rounded-lg text-[11px] font-bold tracking-wide transition-opacity"
            style={{
              background: canProceed
                ? "var(--color-green)"
                : "var(--color-card)",
              color: canProceed ? "#000" : "var(--color-dim)",
              border: canProceed ? "none" : "1px solid var(--color-border)",
              cursor: canProceed ? "pointer" : "not-allowed",
            }}
          >
            {canProceed ? tr("go_to_dashboard") : tr("waiting_assistant")}
          </button>
        </aside>

        {/* ── Destra: Chat assistente ─────────────────────────────────── */}
        <section
          className="flex-1 flex flex-col min-w-0 rounded-lg overflow-hidden"
          style={{
            background: "var(--color-card)",
            border: "1px solid var(--color-border)",
          }}
        >
          <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center gap-2">
            <Avatar role="assistant" size={32} />
            <span className="text-[11px] font-semibold tracking-widest uppercase text-[var(--color-muted)]">
              {tr("panel_assistant")}
            </span>
            {startError && !speechError && (
              <span className="text-[9px] text-[var(--color-red)] truncate max-w-[260px] ml-auto">
                {startError}
              </span>
            )}
          </div>

          {/* Modal: microfono bloccato */}
          {speechError && speechError.includes("not-allowed") && (
            <MicBlockedModal
              onRetry={() => {
                setSpeechError(null);
                void toggleRecording();
              }}
              onClose={() => setSpeechError(null)}
            />
          )}
          {speechError && !speechError.includes("not-allowed") && (
            <div
              className="mx-4 mt-3 mb-0 px-3 py-2 rounded-md border flex items-center justify-between gap-3"
              style={{
                background: "rgba(232, 138, 122, 0.08)",
                borderColor: "rgba(232, 138, 122, 0.35)",
                color: "var(--color-red)",
              }}
            >
              <span className="text-[11px]">{speechError}</span>
              <button
                onClick={() => setSpeechError(null)}
                className="text-[10px] underline opacity-70 hover:opacity-100"
                type="button"
              >
                {tr("close")}
              </button>
            </div>
          )}

          {/* Messaggi */}
          <div
            ref={chatScrollRef}
            className="flex-1 overflow-auto px-4 py-4 min-h-0"
          >
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center px-6">
                <div className="text-3xl mb-3 opacity-30">👨‍💼</div>
                <p className="text-[11px] text-[var(--color-dim)] max-w-xs leading-relaxed mb-4">
                  {tr("assistant_starting")}
                </p>
                <div
                  className="w-full max-w-[240px] h-1 rounded-full overflow-hidden"
                  style={{ background: "var(--color-border)" }}
                >
                  <div
                    className="h-full rounded-full transition-all duration-500 ease-out"
                    style={{
                      width: `${bootProgress}%`,
                      background: "var(--color-green)",
                    }}
                  />
                </div>
                <span
                  className="text-[9.5px] text-[var(--color-dim)] mt-2"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {Math.round(bootProgress)}%
                </span>
              </div>
            )}
            {messages.map((m, i) => (
              <ChatBubble key={`${m.ts}-${i}`} msg={m} />
            ))}
            {/* 3 puntini "sto lavorando". Mostrati quando:
                 (a) l'ultima bubble è dell'utente (aspetto il primo reply), oppure
                 (b) l'ultima bubble dell'assistente è un checkpoint intermedio (done=false).
                 Safety stale: dopo 10 minuti di silenzio con done=false consideriamo
                 l'agente bloccato/crashato e spegniamo i puntini.
                 I puntini escono sempre "dalla testa dell'assistente": stesso layout
                 avatar+bubble di ChatBubble, così visivamente l'animazione è ancorata
                 al personaggio invece che fluttuare a vuoto. */}
            {(() => {
              if (messages.length === 0) return null;
              const last = messages[messages.length - 1];
              const waitingFirstReply = last.role === "user";
              const inProgress =
                last.role === "assistant" && last.done === false;
              const stale = Date.now() / 1000 - last.ts > 600;
              if (!waitingFirstReply && (!inProgress || stale)) return null;
              return (
                // items-center + tail centrato verticalmente: la bubble dei 3
                // puntini è più bassa del testo normale, quindi se lasciassimo
                // items-start con tail a top-2.5 il tail finirebbe nella parte
                // alta mentre l'avatar rimane al centro → disallineato.
                <div className="flex mb-3 justify-start items-center gap-2">
                  <Avatar role="assistant" />
                  <div
                    className="relative px-3 py-2 rounded-lg"
                    style={{ background: "#1c2333" }}
                  >
                    <span
                      aria-hidden
                      className="absolute top-1/2 -left-1.5 w-3 h-3 rotate-45 -translate-y-1/2"
                      style={{ background: "#1c2333" }}
                    />
                    <span className="flex gap-1">
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-[var(--color-muted)]"
                        style={{
                          animation: "pulse-dot 1.4s ease-in-out infinite",
                        }}
                      />
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-[var(--color-muted)]"
                        style={{
                          animation: "pulse-dot 1.4s ease-in-out 0.2s infinite",
                        }}
                      />
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-[var(--color-muted)]"
                        style={{
                          animation: "pulse-dot 1.4s ease-in-out 0.4s infinite",
                        }}
                      />
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Allegati preview */}
          {attached.length > 0 && (
            <div
              className="flex flex-wrap gap-2 px-4 py-2 border-t border-[var(--color-border)]"
              style={{ background: "var(--color-deep)" }}
            >
              {attached.map((f, i) => (
                <div
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px]"
                  style={{
                    background: "var(--color-card)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-muted)",
                  }}
                >
                  <span className="truncate max-w-[160px]">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => removeAttached(i)}
                    className="hover:text-[var(--color-red)] transition-colors cursor-pointer"
                    style={{ color: "var(--color-dim)" }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Input — zero effetti al focus: niente ring, niente bordi
               colorati. Solo un schiarimento quasi impercettibile del
               background quando il cursore è dentro, giusto per segnalare
               "stai scrivendo qui" senza invadenza.
               NB: background via classe (bg-[var(--color-deep)]) e non
               inline style, altrimenti focus-within:bg-... non si applica
               (lo style inline ha sempre precedenza sulla classe). */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSend();
            }}
            className="flex items-center border-t border-[var(--color-border)] outline-none bg-[var(--color-deep)] focus-within:bg-[var(--color-row)] transition-colors"
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileSelect}
              className="hidden"
              accept=".pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg,.yaml,.yml"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending || !status?.active}
              title={tr("attach_title")}
              className="px-3 py-3 transition-colors cursor-pointer disabled:cursor-not-allowed"
              style={{
                color:
                  attached.length > 0
                    ? "var(--color-green)"
                    : "var(--color-dim)",
              }}
              aria-label={tr("attach_aria")}
            >
              <svg
                aria-hidden="true"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            {speechSupported && (
              <button
                type="button"
                onClick={toggleRecording}
                disabled={sending || !status?.active}
                title={
                  isRecording
                    ? tr("mic_stop")
                    : tr("mic_dictate", { lang: languageDisplayName(locale) })
                }
                className="px-3 py-3 transition-colors cursor-pointer disabled:cursor-not-allowed"
                style={{
                  color: isRecording ? "var(--color-red)" : "var(--color-dim)",
                  animation: isRecording
                    ? "pulse-dot 1.4s ease-in-out infinite"
                    : undefined,
                }}
                aria-label={
                  isRecording ? tr("mic_stop") : tr("mic_start_aria")
                }
              >
                <svg
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="9" y="3" width="6" height="12" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0" />
                  <line x1="12" y1="18" x2="12" y2="22" />
                </svg>
              </button>
            )}
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={sending || !status?.active}
              placeholder={
                status?.active
                  ? attached.length > 0
                    ? tr(
                        attached.length === 1
                          ? "input_files_attached_one"
                          : "input_files_attached_many",
                        { n: attached.length },
                      )
                    : tr("input_write_assistant")
                  : tr("waiting_assistant")
              }
              // outline:none inline per battere la regola globale
              // `:focus-visible { outline: 2px solid green }` in globals.css
              // senza toglierla al resto dell'app (serve a11y tastiera).
              className="flex-1 px-2 py-3 text-[12px] bg-transparent outline-none"
              style={{ color: "var(--color-bright)", outline: "none" }}
            />
            <button
              type="submit"
              disabled={
                (!input.trim() && attached.length === 0) ||
                sending ||
                !status?.active
              }
              className="px-5 py-3 text-[11px] font-semibold tracking-widest uppercase transition-colors disabled:cursor-not-allowed"
              style={{
                color:
                  (!input.trim() && attached.length === 0) ||
                  sending ||
                  !status?.active
                    ? "var(--color-dim)"
                    : "var(--color-green)",
              }}
            >
              {sending ? "…" : tr("send")}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function ChatBubble({ msg }: { msg: ChatMsg }) {
  const isUser = msg.role === "user";
  const { text, attachments } = extractAttachments(msg.text);
  const bubbleBg = isUser ? "var(--color-green)" : "#1c2333";

  const bubble = (
    <div
      className="relative max-w-[80%] px-3 py-2 rounded-lg text-[12px] leading-relaxed flex flex-col gap-2"
      style={{
        background: bubbleBg,
        color: isUser ? "#000" : "var(--color-bright)",
        wordBreak: "break-word",
      }}
    >
      {/* Tail del fumetto: triangolino che punta verso l'avatar.
          Per l'assistente: a sinistra. Per l'utente: a destra. */}
      <span
        aria-hidden
        className={`absolute top-2.5 w-3 h-3 rotate-45 ${isUser ? "-right-1.5" : "-left-1.5"}`}
        style={{ background: bubbleBg }}
      />
      {text && <MiniMarkdown text={text} />}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((name, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px]"
              style={{
                background: isUser ? "rgba(0,0,0,0.12)" : "var(--color-card)",
                border: `1px solid ${isUser ? "rgba(0,0,0,0.15)" : "var(--color-border)"}`,
              }}
            >
              <span>📎</span>
              <span className="font-mono">{name}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );

  if (isUser) {
    return (
      <div className="flex mb-3 justify-end items-start gap-2">
        {bubble}
        <Avatar role="user" />
      </div>
    );
  }

  return (
    <div className="flex mb-3 justify-start items-start gap-2">
      <Avatar role="assistant" />
      {bubble}
    </div>
  );
}

// Avatar condiviso tra ChatBubble e indicatore "sta scrivendo".
// Emoji user: 👤 (sagoma busto) — placeholder finché non c'è un avatar
// configurato per il profilo utente.
function Avatar({
  role,
  size = 28,
}: {
  role: "user" | "assistant";
  size?: number;
}) {
  const isUser = role === "user";
  const locale = useLocale();
  const tr = makeTr(locale);
  return (
    <div
      className="flex items-center justify-center shrink-0 rounded-full select-none"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.57),
        background: "var(--color-card)",
        border: "1px solid var(--color-border)",
      }}
      aria-label={isUser ? tr("avatar_you") : tr("panel_assistant")}
    >
      {isUser ? "👤" : "👨‍💼"}
    </div>
  );
}

function extractAttachments(raw: string): {
  text: string;
  attachments: string[];
} {
  const m = /\n*\[FILE ALLEGATI\]\n([\s\S]*?)$/i.exec(raw);
  if (!m) return { text: raw, attachments: [] };
  const text = raw.slice(0, m.index).trim();
  const paths = m[1]
    .split("\n")
    .map((l) => l.trim().replace(/^📎\s*/, ""))
    .filter(Boolean);
  // Mostra solo il basename: "cv-developer-IT.pdf" invece del path completo
  const names = paths.map((p) => p.split("/").filter(Boolean).pop() ?? p);
  return { text, attachments: names };
}

// Renderer markdown minimale: bold (**x**), italic (*x*), inline code (`x`),
// link [t](u), liste numerate (\d+\.) e puntate (- / *), paragrafi separati
// da riga vuota. Niente dipendenze esterne — abbastanza per i messaggi
// dell'assistente, che non produce HTML né blocchi di codice lunghi.
function MiniMarkdown({ text }: { text: string }) {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, bi) => {
        const lines = block.split("\n");
        const isOrdered = lines.every((l) => /^\s*\d+\.\s+/.test(l));
        const isBulleted = lines.every((l) => /^\s*[-*]\s+/.test(l));
        if (isOrdered && lines.length > 1) {
          return (
            <ol key={bi} className="list-decimal list-outside pl-5 space-y-1">
              {lines.map((l, li) => (
                <li key={li}>{renderInline(l.replace(/^\s*\d+\.\s+/, ""))}</li>
              ))}
            </ol>
          );
        }
        if (isBulleted && lines.length > 1) {
          return (
            <ul key={bi} className="list-disc list-outside pl-5 space-y-1">
              {lines.map((l, li) => (
                <li key={li}>{renderInline(l.replace(/^\s*[-*]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={bi} className="whitespace-pre-wrap">
            {lines.map((l, li) => (
              <span key={li}>
                {renderInline(l)}
                {li < lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function renderInline(s: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const regex = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]]+\]\([^\)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(s)) !== null) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      out.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      out.push(
        <code
          key={key++}
          className="px-1 rounded text-[11px]"
          style={{
            background: "var(--color-row)",
            color: "var(--color-green)",
          }}
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("[")) {
      const mm = /^\[([^\]]+)\]\(([^\)]+)\)$/.exec(tok);
      if (mm)
        out.push(
          <a
            key={key++}
            href={mm[2]}
            target="_blank"
            rel="noreferrer"
            className="underline"
            style={{ color: "var(--color-green)" }}
          >
            {mm[1]}
          </a>,
        );
      else out.push(tok);
    } else if (tok.startsWith("*")) {
      out.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

// Esempi placeholder mix di settori — cuochi, infermieri, avvocati, designer,
// insegnanti, muratori, ecc. Uno casuale è scelto al mount così ogni avvio
// l'utente vede un esempio diverso: niente bias verso il tech. Tutti i pool
// hanno la stessa lunghezza semantica (indice condiviso = stesso settore).
// I pool per lingua vivono in PLACEHOLDERS (vedi in cima al file).
function placeholders(locale: string) {
  return PLACEHOLDERS[locale] ?? PLACEHOLDERS.en;
}
// NB: non usare Math.random() all'init dello state perché SSR e client
// calcolerebbero valori diversi → hydration mismatch. La randomizzazione
// avviene dentro useEffect (vedi ProfileLive), lato client-only. Tutti i
// pool hanno la stessa lunghezza (10), uso quella di `en` come riferimento.
function pickIndex(): number {
  return Math.floor(Math.random() * PLACEHOLDERS.en.roles.length);
}

// Formatta il campo `years` di un'esperienza. Se è un numero o stringa
// puramente numerica → "N anni". Se è già una frase ("2025 - in corso",
// "gennaio 2022 - oggi", ecc.) la mostra tale e quale senza appendere
// "anni" che porterebbe a cose tipo "2025 - in corso anni".
function formatYears(
  raw: number | string | null | undefined,
  tr: (k: string, p?: Record<string, string | number>) => string,
): string {
  if (raw == null) return "";
  const s = String(raw).trim();
  if (!s) return "";
  return /^\d+(?:[.,]\d+)?$/.test(s)
    ? `${s} ${tr(Number(s) === 1 ? "year_singular" : "year_plural")}`
    : s;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ProfileLive({
  profile,
  summaries,
  sources,
}: {
  profile: Profile;
  summaries: Array<{
    id: string;
    title: string;
    content: string;
    updatedAt: number;
  }>;
  sources: Array<{
    name: string;
    size: number;
    ext: string;
    updatedAt: number;
  }>;
}) {
  // Randomizzazione post-mount per evitare hydration mismatch su Math.random.
  // Server e primo render client partono da idx=0 (cucina: sous chef /
  // ristorante / alberghiero — non tech, default neutro), poi dopo il mount
  // useEffect sceglie un settore casuale. Il flip è istantaneo all'occhio.
  const [phIdx, setPhIdx] = useState(0);
  const locale = useLocale();
  const tr = makeTr(locale);
  const ph = placeholders(locale);
  useEffect(() => {
    setPhIdx(pickIndex());
  }, []);
  const skills = profile?.skills
    ? Object.values(profile.skills).flat().filter(Boolean)
    : [];
  const langs = (profile?.languages ?? [])
    .map((l) => [l.language, l.level].filter(Boolean).join(" "))
    .filter(Boolean);
  // Il reader sposta candidate.experience/education sotto positioning.*
  // (vedi profile-reader.ts). Leggi da lì, con fallback sul vecchio path
  // per retrocompatibilità con eventuali profili salvati prima del fix.
  const experience =
    profile?.positioning?.experience ?? profile?.candidate?.experience ?? [];
  const education =
    profile?.positioning?.education ?? profile?.candidate?.education ?? [];
  const contacts = profile?.positioning?.contacts ?? {};
  const prefs = profile?.positioning?.preferences ?? null;
  const projects = profile?.positioning?.projects ?? [];
  const certifications = profile?.positioning?.certifications ?? [];
  // Dict aperto: ogni settore ha i suoi campi (cucina: specializzazione,
  // sanità: iscrizione_albo, edile: patentini, ecc.). Il frontend non sa
  // quali chiavi arriveranno, le mostra come lista generica key: value.
  const sectorDetails = profile?.positioning?.sector_details ?? null;
  const sectorEntries: Array<[string, string]> = sectorDetails
    ? Object.entries(sectorDetails)
        .filter(
          ([, v]) =>
            v != null && v !== "" && !(Array.isArray(v) && v.length === 0),
        )
        .map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v)])
    : [];

  return (
    <div className="px-4 py-4 flex flex-col gap-4 text-[11px]">
      <Section label={tr("sec_identity")} icon="👤">
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={tr("fld_name")}
            value={profile?.name}
            placeholder={tr("ph_name")}
            highlight
          />
          <Field
            label={tr("fld_target_role")}
            value={profile?.target_role}
            placeholder={ph.roles[phIdx]}
            highlight
          />
          <Field
            label={tr("fld_location")}
            value={profile?.location}
            placeholder={ph.locations[phIdx]}
          />
          <Field
            label={tr("fld_years_experience")}
            value={
              profile?.experience_years != null
                ? String(profile.experience_years)
                : null
            }
            placeholder={tr("ph_experience")}
          />
        </div>
      </Section>

      <Section label={tr("sec_contacts")} icon="📱">
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={tr("fld_email")}
            value={profile?.email ?? contacts.email ?? null}
            placeholder={tr("ph_email")}
          />
          <Field
            label={tr("fld_phone")}
            value={contacts.phone ?? null}
            placeholder={tr("ph_phone")}
          />
          {contacts.linkedin && (
            <Field label="LinkedIn" value={contacts.linkedin} />
          )}
          {contacts.github && <Field label="GitHub" value={contacts.github} />}
          {contacts.website && (
            <Field label={tr("fld_website")} value={contacts.website} />
          )}
        </div>
      </Section>

      <Section label={tr("sec_skills")} icon="🛠️">
        {skills.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {skills.slice(0, 30).map((s, i) => (
              <span
                key={`${s}-${i}`}
                className="px-2 py-0.5 rounded text-[10px]"
                style={{
                  background: "var(--color-row)",
                  color: "var(--color-bright)",
                  border: "1px solid var(--color-border)",
                }}
              >
                {s}
              </span>
            ))}
            {skills.length > 30 && (
              <span className="px-2 py-0.5 text-[10px] text-[var(--color-dim)]">
                +{skills.length - 30}
              </span>
            )}
          </div>
        ) : (
          <PlaceholderChips items={ph.skills[phIdx]} />
        )}
      </Section>

      <Section label={tr("sec_languages")} icon="🌍">
        {langs.length > 0 ? (
          <div className="flex flex-wrap gap-3">
            {langs.map((l, i) => (
              <span
                key={`${l}-${i}`}
                className="text-[10px] text-[var(--color-bright)]"
              >
                {l}
              </span>
            ))}
          </div>
        ) : (
          <PlaceholderChips items={tr("ph_languages").split(" · ")} />
        )}
      </Section>

      <Section label={tr("sec_experience")} icon="💼">
        {experience.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {experience.slice(0, 4).map((e, i) => (
              <li
                key={i}
                className="text-[10.5px] text-[var(--color-bright)] leading-snug"
              >
                <span className="font-semibold">{e.role ?? "—"}</span>
                {e.company ? (
                  <span className="text-[var(--color-muted)]">
                    {" "}
                    · {e.company}
                  </span>
                ) : null}
                {e.years ? (
                  <span className="text-[var(--color-dim)]">
                    {" "}
                    · {formatYears(e.years, tr)}
                  </span>
                ) : null}
              </li>
            ))}
            {experience.length > 4 && (
              <li className="text-[9.5px] text-[var(--color-dim)]">
                {tr("more_other_f", { n: experience.length - 4 })}
              </li>
            )}
          </ul>
        ) : (
          <div className="text-[10px] text-[var(--color-border)] italic">
            {ph.experience[phIdx]}
          </div>
        )}
      </Section>

      {sectorEntries.length > 0 && (
        <Section label={tr("sec_sector_details")} icon="🏢">
          <ul className="flex flex-col gap-1">
            {sectorEntries.map(([k, v]) => (
              <li
                key={k}
                className="text-[10.5px] text-[var(--color-bright)] leading-snug"
              >
                <span className="text-[var(--color-dim)] uppercase tracking-wide text-[9px] mr-1.5">
                  {k.replace(/_/g, " ")}
                </span>
                {v}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {projects.length > 0 && (
        <Section label={tr("sec_projects")} icon="🚀">
          <ul className="flex flex-col gap-1.5">
            {projects.slice(0, 4).map((p, i) => (
              <li
                key={i}
                className="text-[10.5px] text-[var(--color-bright)] leading-snug"
              >
                <span className="font-semibold">{p.name ?? "—"}</span>
                {p.description ? (
                  <div className="text-[10px] text-[var(--color-muted)] leading-snug mt-0.5">
                    {String(p.description).split("\n")[0].slice(0, 180)}
                  </div>
                ) : null}
              </li>
            ))}
            {projects.length > 4 && (
              <li className="text-[9.5px] text-[var(--color-dim)]">
                {tr("more_other_m", { n: projects.length - 4 })}
              </li>
            )}
          </ul>
        </Section>
      )}

      {certifications.length > 0 && (
        <Section label={tr("sec_certifications")} icon="🏅">
          <ul className="flex flex-col gap-0.5">
            {certifications.slice(0, 5).map((c, i) => (
              <li
                key={i}
                className="text-[10.5px] text-[var(--color-bright)] leading-snug"
              >
                {c.name ?? "—"}
                {c.issuer ? (
                  <span className="text-[var(--color-muted)]">
                    {" "}
                    · {c.issuer}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section label={tr("sec_education")} icon="🎓">
        {education.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {education.slice(0, 3).map((e, i) => (
              <li
                key={i}
                className="text-[10.5px] text-[var(--color-bright)] leading-snug"
              >
                {e.degree ?? "—"}
                {e.institution ? (
                  <span className="text-[var(--color-muted)]">
                    {" "}
                    · {e.institution}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-[10px] text-[var(--color-border)] italic">
            {ph.education[phIdx]}
          </div>
        )}
      </Section>

      {summaries.length > 0 && (
        <div className="flex flex-col gap-3 pt-1 border-t border-[var(--color-border)] mt-1">
          {summaries.map((s) => (
            <Section key={s.id} label={s.title} icon={iconForSummary(s.title)}>
              <div className="text-[11px] leading-relaxed text-[var(--color-bright)]">
                <MiniMarkdown text={s.content} />
              </div>
            </Section>
          ))}
        </div>
      )}

      {/* I file in profile/sources/ NON sono mostrati qui: sono un dettaglio
           interno di archiviazione, non informazione del profilo. Gli
           scrittori CV a valle li leggono via /api/profile/sources — al
           resto della UI l'utente non deve pensarci. */}

      <Section label={tr("sec_work_prefs")} icon="🎯">
        {prefs ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap gap-3">
              {prefs.work_mode && (
                <Field label={tr("fld_work_mode")} value={prefs.work_mode} />
              )}
              {prefs.relocation != null && (
                <Field
                  label={tr("fld_relocation")}
                  value={
                    typeof prefs.relocation === "boolean"
                      ? prefs.relocation
                        ? tr("relocation_available")
                        : tr("relocation_unavailable")
                      : String(prefs.relocation)
                  }
                />
              )}
              {prefs.salary_annual_eur && (
                <Field
                  label={tr("fld_salary")}
                  value={prefs.salary_annual_eur}
                />
              )}
            </div>
            {prefs.work_mode_flexibility && (
              <div className="text-[10px] text-[var(--color-muted)] italic leading-snug">
                {prefs.work_mode_flexibility}
              </div>
            )}
          </div>
        ) : (
          <div className="text-[10px] text-[var(--color-border)] italic">
            {tr("ph_work_prefs")}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[8px] font-bold tracking-widest uppercase text-[var(--color-dim)] mb-1.5 flex items-center gap-1.5">
        {icon && <span className="text-[13px] leading-none">{icon}</span>}
        <span>{label}</span>
      </div>
      {children}
    </div>
  );
}

// Icona euristica per i summary dinamici (about, preferences, goals, …).
// I titoli arrivano dall'assistente NELLA LINGUA DELL'UTENTE, quindi il match
// è fuzzy su keyword di tutte e 7 le lingue supportate (it/en/es/fr/de/hu/pt).
function iconForSummary(title: string): string {
  const t = title.toLowerCase();
  // Preferenze / desideri
  if (/preferenz|desider|prefer|deseo|souhait|wunsch|präferen|vágy/.test(t))
    return "⚙️";
  // Obiettivi / aspirazioni
  if (/obiett|goal|aspiraz|objetiv|aspirac|objectif|ziel|cél/.test(t))
    return "🎯";
  // Punti di forza
  if (
    /forza|strength|punti\s+forti|fortaleza|fuerte|force|atout|stärke|erőss/.test(
      t,
    )
  )
    return "⭐";
  // Chi sono / about
  if (
    /chi\s+sono|about|di\s+me|profilo|sobre|acerca|à\s+propos|moi|über\s+mich|rólam|profil/.test(
      t,
    )
  )
    return "👋";
  // Storia / percorso
  if (/stor|percorso|histor|trayector|parcours|werdegang|út|pálya/.test(t))
    return "🧭";
  return "📝";
}

function PlaceholderChips({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((s, i) => (
        <span
          key={`${s}-${i}`}
          className="px-2 py-0.5 rounded text-[10px] italic"
          style={{
            background: "transparent",
            color: "var(--color-border)",
            border: "1px dashed var(--color-border)",
          }}
        >
          {s}
        </span>
      ))}
    </div>
  );
}

function Field({
  label,
  value,
  highlight,
  placeholder,
}: {
  label: string;
  value?: string | null;
  highlight?: boolean;
  placeholder?: string;
}) {
  const empty = !value;
  return (
    <div className="min-w-0">
      <div className="text-[8px] font-bold tracking-widest uppercase text-[var(--color-dim)] mb-0.5">
        {label}
      </div>
      <div
        className="text-[11px] truncate"
        style={{
          color: empty
            ? "var(--color-border)"
            : highlight
              ? "var(--color-green)"
              : "var(--color-bright)",
          fontWeight: highlight && !empty ? 600 : 400,
          fontStyle: empty ? "italic" : "normal",
        }}
      >
        {value ?? placeholder ?? "—"}
      </div>
    </div>
  );
}

function MicBlockedModal({
  onRetry,
  onClose,
}: {
  onRetry: () => void;
  onClose: () => void;
}) {
  // Chrome non espone `chrome://settings/content/microphone` via JS
  // per security — l'utente deve cliccarlo manualmente. Forniamo il
  // link come <a> così il click diretto funziona.
  const chromeSettingsUrl = "chrome://settings/content/microphone";
  const locale = useLocale();
  const tr = makeTr(locale);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.7)" }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-w-md w-full rounded-xl border p-6"
        style={{
          background: "var(--color-card)",
          borderColor: "var(--color-border-glow)",
        }}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="text-2xl">🎤</div>
          <div>
            <h2 className="text-[14px] font-bold text-[var(--color-bright)] mb-1">
              {tr("mic_title")}
            </h2>
            <p className="text-[11.5px] text-[var(--color-muted)] leading-relaxed">
              {tr("mic_intro")}
            </p>
          </div>
        </div>

        <ol className="text-[11.5px] text-[var(--color-bright)] space-y-3 pl-5 list-decimal mb-5">
          <li dangerouslySetInnerHTML={{ __html: tr("mic_step1") }} />
          <li>
            {tr("mic_step2_pre")}
            <a
              href={chromeSettingsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1 underline text-[var(--color-green)] hover:text-[var(--color-bright)]"
            >
              chrome://settings/content/microphone
            </a>{" "}
            {tr("mic_step2_post")}{" "}
            <code className="text-[10.5px] px-1 rounded bg-[var(--color-panel)]">
              http://localhost:3000
            </code>{" "}
            <span dangerouslySetInnerHTML={{ __html: tr("mic_step2_allow") }} />
          </li>
          <li dangerouslySetInnerHTML={{ __html: tr("mic_step3") }} />
        </ol>

        <p
          className="text-[10.5px] text-[var(--color-dim)] mb-4"
          dangerouslySetInnerHTML={{ __html: tr("mic_footer") }}
        />

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            type="button"
            className="px-4 py-2 rounded-md text-[11px] font-semibold tracking-wide border transition-colors cursor-pointer"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-muted)",
            }}
          >
            {tr("mic_close")}
          </button>
          <button
            onClick={onRetry}
            type="button"
            className="px-4 py-2 rounded-md text-[11px] font-bold tracking-wide transition-opacity cursor-pointer"
            style={{ background: "var(--color-green)", color: "#000" }}
          >
            {tr("mic_retry")}
          </button>
        </div>
      </div>
    </div>
  );
}
