"use client";

import React, {
  useState,
  useEffect,
  useTransition,
  useRef,
  useId,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { CandidateProfile, Language } from "@/lib/types";
import ProfileAssistantFab from "@/components/ProfileAssistantFab";
import { useLocale } from "@/lib/use-locale";

/* ── i18n inline ─────────────────────────────────────────────────── */
const T: Record<string, Record<string, string>> = {
  loading: {
    it: "Caricamento...",
    en: "Loading...",
    hu: "Betöltés...",
    es: "Cargando...",
    de: "Wird geladen...",
    fr: "Chargement...",
    pt: "Carregando...",
  },
  bcDashboard: {
    it: "Dashboard",
    en: "Dashboard",
    hu: "Vezérlőpult",
    es: "Panel",
    de: "Dashboard",
    fr: "Tableau de bord",
    pt: "Painel",
  },
  bcProfile: {
    it: "Profilo",
    en: "Profile",
    hu: "Profil",
    es: "Perfil",
    de: "Profil",
    fr: "Profil",
    pt: "Perfil",
  },
  bcEdit: {
    it: "Modifica",
    en: "Edit",
    hu: "Szerkesztés",
    es: "Editar",
    de: "Bearbeiten",
    fr: "Modifier",
    pt: "Editar",
  },
  pageTitle: {
    it: "Modifica Profilo",
    en: "Edit Profile",
    hu: "Profil szerkesztése",
    es: "Editar perfil",
    de: "Profil bearbeiten",
    fr: "Modifier le profil",
    pt: "Editar perfil",
  },
  pageSubtitle: {
    it: "Questi dati vengono usati dagli agenti per personalizzare CV e cover letter",
    en: "This data is used by the agents to personalize CVs and cover letters",
    hu: "Ezeket az adatokat az ügynökök az önéletrajzok és motivációs levelek személyre szabásához használják",
    es: "Estos datos los usan los agentes para personalizar CV y cartas de presentación",
    de: "Diese Daten werden von den Agenten zur Personalisierung von Lebensläufen und Anschreiben verwendet",
    fr: "Ces données sont utilisées par les agents pour personnaliser les CV et lettres de motivation",
    pt: "Estes dados são usados pelos agentes para personalizar currículos e cartas de apresentação",
  },
  formAria: {
    it: "Modifica profilo",
    en: "Edit profile",
    hu: "Profil szerkesztése",
    es: "Editar perfil",
    de: "Profil bearbeiten",
    fr: "Modifier le profil",
    pt: "Editar perfil",
  },
  secInfoBase: {
    it: "Info Base",
    en: "Basic Info",
    hu: "Alapadatok",
    es: "Información básica",
    de: "Basisdaten",
    fr: "Infos de base",
    pt: "Informações básicas",
  },
  fName: {
    it: "Nome completo",
    en: "Full name",
    hu: "Teljes név",
    es: "Nombre completo",
    de: "Vollständiger Name",
    fr: "Nom complet",
    pt: "Nome completo",
  },
  phName: {
    it: "Es. Mario Rossi",
    en: "e.g. John Smith",
    hu: "Pl. Kovács János",
    es: "Ej. Juan Pérez",
    de: "z. B. Max Mustermann",
    fr: "Ex. Jean Dupont",
    pt: "Ex. João Silva",
  },
  fTargetRole: {
    it: "Ruolo target principale",
    en: "Main target role",
    hu: "Fő célpozíció",
    es: "Rol objetivo principal",
    de: "Hauptzielrolle",
    fr: "Rôle cible principal",
    pt: "Função-alvo principal",
  },
  phBackendDev: {
    it: "Es. Backend Developer",
    en: "e.g. Backend Developer",
    hu: "Pl. Backend fejlesztő",
    es: "Ej. Backend Developer",
    de: "z. B. Backend-Entwickler",
    fr: "Ex. Développeur Backend",
    pt: "Ex. Desenvolvedor Backend",
  },
  fLocation: {
    it: "Location",
    en: "Location",
    hu: "Helyszín",
    es: "Ubicación",
    de: "Standort",
    fr: "Lieu",
    pt: "Localização",
  },
  phRemoteEu: {
    it: "Es. Remote EU",
    en: "e.g. Remote EU",
    hu: "Pl. Távmunka EU",
    es: "Ej. Remoto UE",
    de: "z. B. Remote EU",
    fr: "Ex. Télétravail UE",
    pt: "Ex. Remoto UE",
  },
  fExpYears: {
    it: "Anni di esperienza",
    en: "Years of experience",
    hu: "Tapasztalat (év)",
    es: "Años de experiencia",
    de: "Jahre Erfahrung",
    fr: "Années d'expérience",
    pt: "Anos de experiência",
  },
  phYears: {
    it: "Es. 3",
    en: "e.g. 3",
    hu: "Pl. 3",
    es: "Ej. 3",
    de: "z. B. 3",
    fr: "Ex. 3",
    pt: "Ex. 3",
  },
  fDegree: {
    it: "Ho una laurea (triennale o magistrale)",
    en: "I have a degree (bachelor's or master's)",
    hu: "Van diplomám (alap- vagy mesterszak)",
    es: "Tengo un título (grado o máster)",
    de: "Ich habe einen Abschluss (Bachelor oder Master)",
    fr: "J'ai un diplôme (licence ou master)",
    pt: "Tenho um diploma (licenciatura ou mestrado)",
  },
  secContacts: {
    it: "Contatti",
    en: "Contacts",
    hu: "Elérhetőségek",
    es: "Contactos",
    de: "Kontakte",
    fr: "Contacts",
    pt: "Contatos",
  },
  fEmail: {
    it: "Email",
    en: "Email",
    hu: "E-mail",
    es: "Correo electrónico",
    de: "E-Mail",
    fr: "E-mail",
    pt: "E-mail",
  },
  phEmail: {
    it: "nome@example.com",
    en: "name@example.com",
    hu: "nev@example.com",
    es: "nombre@example.com",
    de: "name@example.com",
    fr: "nom@example.com",
    pt: "nome@example.com",
  },
  fPhone: {
    it: "Telefono",
    en: "Phone",
    hu: "Telefon",
    es: "Teléfono",
    de: "Telefon",
    fr: "Téléphone",
    pt: "Telefone",
  },
  fLinkedin: {
    it: "LinkedIn",
    en: "LinkedIn",
    hu: "LinkedIn",
    es: "LinkedIn",
    de: "LinkedIn",
    fr: "LinkedIn",
    pt: "LinkedIn",
  },
  fGithub: {
    it: "GitHub",
    en: "GitHub",
    hu: "GitHub",
    es: "GitHub",
    de: "GitHub",
    fr: "GitHub",
    pt: "GitHub",
  },
  fWebsite: {
    it: "Website",
    en: "Website",
    hu: "Weboldal",
    es: "Sitio web",
    de: "Website",
    fr: "Site web",
    pt: "Site",
  },
  secSkills: {
    it: "Skills",
    en: "Skills",
    hu: "Készségek",
    es: "Habilidades",
    de: "Fähigkeiten",
    fr: "Compétences",
    pt: "Competências",
  },
  fSkills: {
    it: "Skills (separate da virgola)",
    en: "Skills (comma-separated)",
    hu: "Készségek (vesszővel elválasztva)",
    es: "Habilidades (separadas por comas)",
    de: "Fähigkeiten (durch Komma getrennt)",
    fr: "Compétences (séparées par des virgules)",
    pt: "Competências (separadas por vírgula)",
  },
  secLanguages: {
    it: "Lingue",
    en: "Languages",
    hu: "Nyelvek",
    es: "Idiomas",
    de: "Sprachen",
    fr: "Langues",
    pt: "Idiomas",
  },
  removeLang: {
    it: "Rimuovi lingua {x}",
    en: "Remove language {x}",
    hu: "{x} nyelv eltávolítása",
    es: "Eliminar idioma {x}",
    de: "Sprache {x} entfernen",
    fr: "Supprimer la langue {x}",
    pt: "Remover idioma {x}",
  },
  remove: {
    it: "× rimuovi",
    en: "× remove",
    hu: "× eltávolítás",
    es: "× eliminar",
    de: "× entfernen",
    fr: "× supprimer",
    pt: "× remover",
  },
  fLanguage: {
    it: "Lingua",
    en: "Language",
    hu: "Nyelv",
    es: "Idioma",
    de: "Sprache",
    fr: "Langue",
    pt: "Idioma",
  },
  phLanguage: {
    it: "Es. inglese",
    en: "e.g. English",
    hu: "Pl. angol",
    es: "Ej. inglés",
    de: "z. B. Englisch",
    fr: "Ex. anglais",
    pt: "Ex. inglês",
  },
  fLevel: {
    it: "Livello",
    en: "Level",
    hu: "Szint",
    es: "Nivel",
    de: "Niveau",
    fr: "Niveau",
    pt: "Nível",
  },
  selectPlaceholder: {
    it: "— seleziona —",
    en: "— select —",
    hu: "— válasszon —",
    es: "— seleccionar —",
    de: "— auswählen —",
    fr: "— sélectionner —",
    pt: "— selecionar —",
  },
  optNative: {
    it: "madrelingua",
    en: "native",
    hu: "anyanyelvi",
    es: "nativo",
    de: "Muttersprache",
    fr: "langue maternelle",
    pt: "nativo",
  },
  addLang: {
    it: "+ Aggiungi lingua",
    en: "+ Add language",
    hu: "+ Nyelv hozzáadása",
    es: "+ Añadir idioma",
    de: "+ Sprache hinzufügen",
    fr: "+ Ajouter une langue",
    pt: "+ Adicionar idioma",
  },
  secExperience: {
    it: "Esperienza Lavorativa",
    en: "Work Experience",
    hu: "Szakmai tapasztalat",
    es: "Experiencia laboral",
    de: "Berufserfahrung",
    fr: "Expérience professionnelle",
    pt: "Experiência profissional",
  },
  removeExp: {
    it: "Rimuovi esperienza {x}",
    en: "Remove experience {x}",
    hu: "{x} tapasztalat eltávolítása",
    es: "Eliminar experiencia {x}",
    de: "Erfahrung {x} entfernen",
    fr: "Supprimer l'expérience {x}",
    pt: "Remover experiência {x}",
  },
  fRole: {
    it: "Ruolo",
    en: "Role",
    hu: "Pozíció",
    es: "Rol",
    de: "Rolle",
    fr: "Rôle",
    pt: "Função",
  },
  fCompany: {
    it: "Azienda",
    en: "Company",
    hu: "Cég",
    es: "Empresa",
    de: "Unternehmen",
    fr: "Entreprise",
    pt: "Empresa",
  },
  phCompany: {
    it: "Es. Acme S.r.l.",
    en: "e.g. Acme Ltd.",
    hu: "Pl. Acme Kft.",
    es: "Ej. Acme S.L.",
    de: "z. B. Acme GmbH",
    fr: "Ex. Acme SARL",
    pt: "Ex. Acme Lda.",
  },
  fPeriod: {
    it: "Periodo",
    en: "Period",
    hu: "Időszak",
    es: "Período",
    de: "Zeitraum",
    fr: "Période",
    pt: "Período",
  },
  phPeriod: {
    it: "Es. 2022–2024",
    en: "e.g. 2022–2024",
    hu: "Pl. 2022–2024",
    es: "Ej. 2022–2024",
    de: "z. B. 2022–2024",
    fr: "Ex. 2022–2024",
    pt: "Ex. 2022–2024",
  },
  fExpDesc: {
    it: "Descrizione (opzionale)",
    en: "Description (optional)",
    hu: "Leírás (opcionális)",
    es: "Descripción (opcional)",
    de: "Beschreibung (optional)",
    fr: "Description (facultatif)",
    pt: "Descrição (opcional)",
  },
  phExpDesc: {
    it: "Breve descrizione delle responsabilità",
    en: "Brief description of responsibilities",
    hu: "A feladatok rövid leírása",
    es: "Breve descripción de las responsabilidades",
    de: "Kurze Beschreibung der Aufgaben",
    fr: "Brève description des responsabilités",
    pt: "Breve descrição das responsabilidades",
  },
  addExp: {
    it: "+ Aggiungi esperienza",
    en: "+ Add experience",
    hu: "+ Tapasztalat hozzáadása",
    es: "+ Añadir experiencia",
    de: "+ Erfahrung hinzufügen",
    fr: "+ Ajouter une expérience",
    pt: "+ Adicionar experiência",
  },
  secEducation: {
    it: "Formazione",
    en: "Education",
    hu: "Tanulmányok",
    es: "Formación",
    de: "Ausbildung",
    fr: "Formation",
    pt: "Formação",
  },
  removeEdu: {
    it: "Rimuovi titolo {x}",
    en: "Remove qualification {x}",
    hu: "{x} végzettség eltávolítása",
    es: "Eliminar título {x}",
    de: "Abschluss {x} entfernen",
    fr: "Supprimer le diplôme {x}",
    pt: "Remover título {x}",
  },
  fTitle: {
    it: "Titolo",
    en: "Qualification",
    hu: "Végzettség",
    es: "Título",
    de: "Abschluss",
    fr: "Diplôme",
    pt: "Título",
  },
  phEduTitle: {
    it: "Es. Laurea in Informatica",
    en: "e.g. Computer Science Degree",
    hu: "Pl. Informatikai diploma",
    es: "Ej. Grado en Informática",
    de: "z. B. Bachelor in Informatik",
    fr: "Ex. Licence en informatique",
    pt: "Ex. Licenciatura em Informática",
  },
  fInstitution: {
    it: "Istituto",
    en: "Institution",
    hu: "Intézmény",
    es: "Institución",
    de: "Einrichtung",
    fr: "Établissement",
    pt: "Instituição",
  },
  phInstitution: {
    it: "Es. Università di Bologna",
    en: "e.g. University of Bologna",
    hu: "Pl. Bolognai Egyetem",
    es: "Ej. Universidad de Bolonia",
    de: "z. B. Universität Bologna",
    fr: "Ex. Université de Bologne",
    pt: "Ex. Universidade de Bolonha",
  },
  fYear: {
    it: "Anno",
    en: "Year",
    hu: "Év",
    es: "Año",
    de: "Jahr",
    fr: "Année",
    pt: "Ano",
  },
  phYear: {
    it: "Es. 2020",
    en: "e.g. 2020",
    hu: "Pl. 2020",
    es: "Ej. 2020",
    de: "z. B. 2020",
    fr: "Ex. 2020",
    pt: "Ex. 2020",
  },
  addEdu: {
    it: "+ Aggiungi titolo",
    en: "+ Add qualification",
    hu: "+ Végzettség hozzáadása",
    es: "+ Añadir título",
    de: "+ Abschluss hinzufügen",
    fr: "+ Ajouter un diplôme",
    pt: "+ Adicionar título",
  },
  fCertifications: {
    it: "Certificazioni (una per riga)",
    en: "Certifications (one per line)",
    hu: "Tanúsítványok (soronként egy)",
    es: "Certificaciones (una por línea)",
    de: "Zertifizierungen (eine pro Zeile)",
    fr: "Certifications (une par ligne)",
    pt: "Certificações (uma por linha)",
  },
  secProjects: {
    it: "Progetti Personali",
    en: "Personal Projects",
    hu: "Személyes projektek",
    es: "Proyectos personales",
    de: "Persönliche Projekte",
    fr: "Projets personnels",
    pt: "Projetos pessoais",
  },
  removeProj: {
    it: "Rimuovi progetto {x}",
    en: "Remove project {x}",
    hu: "{x} projekt eltávolítása",
    es: "Eliminar proyecto {x}",
    de: "Projekt {x} entfernen",
    fr: "Supprimer le projet {x}",
    pt: "Remover projeto {x}",
  },
  fProjName: {
    it: "Nome progetto",
    en: "Project name",
    hu: "Projekt neve",
    es: "Nombre del proyecto",
    de: "Projektname",
    fr: "Nom du projet",
    pt: "Nome do projeto",
  },
  phProjName: {
    it: "Es. Job Hunter",
    en: "e.g. Job Hunter",
    hu: "Pl. Job Hunter",
    es: "Ej. Job Hunter",
    de: "z. B. Job Hunter",
    fr: "Ex. Job Hunter",
    pt: "Ex. Job Hunter",
  },
  fDescription: {
    it: "Descrizione",
    en: "Description",
    hu: "Leírás",
    es: "Descripción",
    de: "Beschreibung",
    fr: "Description",
    pt: "Descrição",
  },
  phProjDesc: {
    it: "Breve descrizione del progetto",
    en: "Brief description of the project",
    hu: "A projekt rövid leírása",
    es: "Breve descripción del proyecto",
    de: "Kurze Beschreibung des Projekts",
    fr: "Brève description du projet",
    pt: "Breve descrição do projeto",
  },
  fProjUrl: {
    it: "URL (opzionale)",
    en: "URL (optional)",
    hu: "URL (opcionális)",
    es: "URL (opcional)",
    de: "URL (optional)",
    fr: "URL (facultatif)",
    pt: "URL (opcional)",
  },
  addProj: {
    it: "+ Aggiungi progetto",
    en: "+ Add project",
    hu: "+ Projekt hozzáadása",
    es: "+ Añadir proyecto",
    de: "+ Projekt hinzufügen",
    fr: "+ Ajouter un projet",
    pt: "+ Adicionar projeto",
  },
  secLocPref: {
    it: "Location preferite",
    en: "Preferred Locations",
    hu: "Preferált helyszínek",
    es: "Ubicaciones preferidas",
    de: "Bevorzugte Standorte",
    fr: "Lieux préférés",
    pt: "Localizações preferidas",
  },
  fLocPref: {
    it: "Location accettate (separate da virgola)",
    en: "Accepted locations (comma-separated)",
    hu: "Elfogadott helyszínek (vesszővel elválasztva)",
    es: "Ubicaciones aceptadas (separadas por comas)",
    de: "Akzeptierte Standorte (durch Komma getrennt)",
    fr: "Lieux acceptés (séparés par des virgules)",
    pt: "Localizações aceitas (separadas por vírgula)",
  },
  secTargetRoles: {
    it: "Ruoli target (in ordine di priorità)",
    en: "Target roles (in order of priority)",
    hu: "Célpozíciók (fontossági sorrendben)",
    es: "Roles objetivo (por orden de prioridad)",
    de: "Zielrollen (nach Priorität)",
    fr: "Rôles cibles (par ordre de priorité)",
    pt: "Funções-alvo (por ordem de prioridade)",
  },
  fTargetRoles: {
    it: "Un ruolo per riga (dal più al meno prioritario)",
    en: "One role per line (from highest to lowest priority)",
    hu: "Soronként egy pozíció (a legfontosabbtól a legkevésbé fontosig)",
    es: "Un rol por línea (de mayor a menor prioridad)",
    de: "Eine Rolle pro Zeile (von höchster zu niedrigster Priorität)",
    fr: "Un rôle par ligne (du plus au moins prioritaire)",
    pt: "Uma função por linha (da mais à menos prioritária)",
  },
  secSalary: {
    it: "Salary Target",
    en: "Salary Target",
    hu: "Célfizetés",
    es: "Salario objetivo",
    de: "Gehaltsziel",
    fr: "Salaire cible",
    pt: "Salário-alvo",
  },
  fItalyMin: {
    it: "Italia min (€/anno)",
    en: "Italy min (€/year)",
    hu: "Olaszország min. (€/év)",
    es: "Italia mín. (€/año)",
    de: "Italien min. (€/Jahr)",
    fr: "Italie min (€/an)",
    pt: "Itália mín. (€/ano)",
  },
  ph40000: {
    it: "Es. 40000",
    en: "e.g. 40000",
    hu: "Pl. 40000",
    es: "Ej. 40000",
    de: "z. B. 40000",
    fr: "Ex. 40000",
    pt: "Ex. 40000",
  },
  fItalyMax: {
    it: "Italia max (€/anno)",
    en: "Italy max (€/year)",
    hu: "Olaszország max. (€/év)",
    es: "Italia máx. (€/año)",
    de: "Italien max. (€/Jahr)",
    fr: "Italie max (€/an)",
    pt: "Itália máx. (€/ano)",
  },
  ph55000: {
    it: "Es. 55000",
    en: "e.g. 55000",
    hu: "Pl. 55000",
    es: "Ej. 55000",
    de: "z. B. 55000",
    fr: "Ex. 55000",
    pt: "Ex. 55000",
  },
  fRemoteMin: {
    it: "Remote EU min (€/anno)",
    en: "Remote EU min (€/year)",
    hu: "Távmunka EU min. (€/év)",
    es: "Remoto UE mín. (€/año)",
    de: "Remote EU min. (€/Jahr)",
    fr: "Télétravail UE min (€/an)",
    pt: "Remoto UE mín. (€/ano)",
  },
  ph50000: {
    it: "Es. 50000",
    en: "e.g. 50000",
    hu: "Pl. 50000",
    es: "Ej. 50000",
    de: "z. B. 50000",
    fr: "Ex. 50000",
    pt: "Ex. 50000",
  },
  fRemoteMax: {
    it: "Remote EU max (€/anno)",
    en: "Remote EU max (€/year)",
    hu: "Távmunka EU max. (€/év)",
    es: "Remoto UE máx. (€/año)",
    de: "Remote EU max. (€/Jahr)",
    fr: "Télétravail UE max (€/an)",
    pt: "Remoto UE máx. (€/ano)",
  },
  ph70000: {
    it: "Es. 70000",
    en: "e.g. 70000",
    hu: "Pl. 70000",
    es: "Ej. 70000",
    de: "z. B. 70000",
    fr: "Ex. 70000",
    pt: "Ex. 70000",
  },
  secStrengths: {
    it: "Punti di forza",
    en: "Strengths",
    hu: "Erősségek",
    es: "Puntos fuertes",
    de: "Stärken",
    fr: "Points forts",
    pt: "Pontos fortes",
  },
  fStrengths: {
    it: "Un punto di forza per riga",
    en: "One strength per line",
    hu: "Soronként egy erősség",
    es: "Un punto fuerte por línea",
    de: "Eine Stärke pro Zeile",
    fr: "Un point fort par ligne",
    pt: "Um ponto forte por linha",
  },
  phStrengths: {
    it: "Problem solving\nComunicazione tecnica\nAutonomia",
    en: "Problem solving\nTechnical communication\nAutonomy",
    hu: "Problémamegoldás\nMűszaki kommunikáció\nÖnállóság",
    es: "Resolución de problemas\nComunicación técnica\nAutonomía",
    de: "Problemlösung\nTechnische Kommunikation\nEigenständigkeit",
    fr: "Résolution de problèmes\nCommunication technique\nAutonomie",
    pt: "Resolução de problemas\nComunicação técnica\nAutonomia",
  },
  secCareerGoals: {
    it: "Obiettivi di Carriera",
    en: "Career Goals",
    hu: "Karriercélok",
    es: "Objetivos profesionales",
    de: "Karriereziele",
    fr: "Objectifs de carrière",
    pt: "Objetivos de carreira",
  },
  fDirection: {
    it: "Direzione",
    en: "Direction",
    hu: "Irány",
    es: "Dirección",
    de: "Richtung",
    fr: "Direction",
    pt: "Direção",
  },
  phDirection: {
    it: "Es. Staff Engineer",
    en: "e.g. Staff Engineer",
    hu: "Pl. Staff Engineer",
    es: "Ej. Staff Engineer",
    de: "z. B. Staff Engineer",
    fr: "Ex. Staff Engineer",
    pt: "Ex. Staff Engineer",
  },
  fJobTarget: {
    it: "Job target",
    en: "Target job",
    hu: "Célállás",
    es: "Empleo objetivo",
    de: "Zieljob",
    fr: "Poste cible",
    pt: "Emprego-alvo",
  },
  phJobTarget: {
    it: "Es. Lead Backend Developer",
    en: "e.g. Lead Backend Developer",
    hu: "Pl. Vezető backend fejlesztő",
    es: "Ej. Lead Backend Developer",
    de: "z. B. Lead Backend Developer",
    fr: "Ex. Lead Backend Developer",
    pt: "Ex. Lead Backend Developer",
  },
  fSpecializations: {
    it: "Specializzazioni desiderate (una per riga)",
    en: "Desired specializations (one per line)",
    hu: "Kívánt szakterületek (soronként egy)",
    es: "Especializaciones deseadas (una por línea)",
    de: "Gewünschte Spezialisierungen (eine pro Zeile)",
    fr: "Spécialisations souhaitées (une par ligne)",
    pt: "Especializações desejadas (uma por linha)",
  },
  fDesiredCourses: {
    it: "Corsi desiderati (uno per riga)",
    en: "Desired courses (one per line)",
    hu: "Kívánt kurzusok (soronként egy)",
    es: "Cursos deseados (uno por línea)",
    de: "Gewünschte Kurse (einer pro Zeile)",
    fr: "Cours souhaités (un par ligne)",
    pt: "Cursos desejados (um por linha)",
  },
  secAspirations: {
    it: "Desideri & Aspirazioni",
    en: "Wishes & Aspirations",
    hu: "Vágyak és törekvések",
    es: "Deseos y aspiraciones",
    de: "Wünsche & Ambitionen",
    fr: "Souhaits et aspirations",
    pt: "Desejos e aspirações",
  },
  fShortTerm: {
    it: "Breve termine (1–2 anni)",
    en: "Short term (1–2 years)",
    hu: "Rövid táv (1–2 év)",
    es: "Corto plazo (1–2 años)",
    de: "Kurzfristig (1–2 Jahre)",
    fr: "Court terme (1–2 ans)",
    pt: "Curto prazo (1–2 anos)",
  },
  phShortTerm: {
    it: "Cosa vuoi raggiungere nel breve termine?",
    en: "What do you want to achieve in the short term?",
    hu: "Mit szeretnél elérni rövid távon?",
    es: "¿Qué quieres lograr a corto plazo?",
    de: "Was möchtest du kurzfristig erreichen?",
    fr: "Que voulez-vous accomplir à court terme ?",
    pt: "O que deseja alcançar a curto prazo?",
  },
  fLongTerm: {
    it: "Lungo termine (5+ anni)",
    en: "Long term (5+ years)",
    hu: "Hosszú táv (5+ év)",
    es: "Largo plazo (5+ años)",
    de: "Langfristig (5+ Jahre)",
    fr: "Long terme (5+ ans)",
    pt: "Longo prazo (5+ anos)",
  },
  phLongTerm: {
    it: "Dove vuoi essere tra 5 anni?",
    en: "Where do you want to be in 5 years?",
    hu: "Hol szeretnél lenni 5 év múlva?",
    es: "¿Dónde quieres estar en 5 años?",
    de: "Wo möchtest du in 5 Jahren sein?",
    fr: "Où voulez-vous être dans 5 ans ?",
    pt: "Onde deseja estar daqui a 5 anos?",
  },
  fAmbitious: {
    it: "Aspirazioni ambiziose",
    en: "Ambitious aspirations",
    hu: "Nagyra törő célok",
    es: "Aspiraciones ambiciosas",
    de: "Ehrgeizige Ziele",
    fr: "Aspirations ambitieuses",
    pt: "Aspirações ambiciosas",
  },
  phAmbitious: {
    it: "Anche se sembra irraggiungibile, cosa ti piacerebbe davvero fare?",
    en: "Even if it seems unreachable, what would you really love to do?",
    hu: "Még ha elérhetetlennek tűnik is, mit szeretnél igazán csinálni?",
    es: "Aunque parezca inalcanzable, ¿qué te encantaría hacer de verdad?",
    de: "Auch wenn es unerreichbar scheint: Was würdest du wirklich gerne tun?",
    fr: "Même si cela semble inatteignable, que rêveriez-vous vraiment de faire ?",
    pt: "Mesmo que pareça inalcançável, o que você realmente gostaria de fazer?",
  },
  secNotes: {
    it: "Note Libere",
    en: "Free Notes",
    hu: "Szabad megjegyzések",
    es: "Notas libres",
    de: "Freie Notizen",
    fr: "Notes libres",
    pt: "Notas livres",
  },
  fNotes: {
    it: "Tutto ciò che non rientra nelle categorie precedenti",
    en: "Anything that doesn't fit the previous categories",
    hu: "Minden, ami nem fér bele az előző kategóriákba",
    es: "Todo lo que no encaje en las categorías anteriores",
    de: "Alles, was nicht in die vorherigen Kategorien passt",
    fr: "Tout ce qui n'entre pas dans les catégories précédentes",
    pt: "Tudo o que não se encaixa nas categorias anteriores",
  },
  phNotes: {
    it: "Vincoli particolari, preferenze di settore, disponibilità, note per gli agenti...",
    en: "Specific constraints, sector preferences, availability, notes for the agents...",
    hu: "Sajátos megkötések, ágazati preferenciák, elérhetőség, megjegyzések az ügynököknek...",
    es: "Restricciones particulares, preferencias de sector, disponibilidad, notas para los agentes...",
    de: "Besondere Einschränkungen, Branchenpräferenzen, Verfügbarkeit, Notizen für die Agenten...",
    fr: "Contraintes particulières, préférences de secteur, disponibilité, notes pour les agents...",
    pt: "Restrições específicas, preferências de setor, disponibilidade, notas para os agentes...",
  },
  secFiles: {
    it: "File allegati",
    en: "Attached Files",
    hu: "Csatolt fájlok",
    es: "Archivos adjuntos",
    de: "Angehängte Dateien",
    fr: "Fichiers joints",
    pt: "Ficheiros anexados",
  },
  filesHint: {
    it: "Allega CV, cover letter o altri documenti. Formati: PDF, DOC, DOCX, TXT, MD, PNG, JPG (max 10MB ciascuno).",
    en: "Attach CV, cover letter or other documents. Formats: PDF, DOC, DOCX, TXT, MD, PNG, JPG (max 10MB each).",
    hu: "Csatolj önéletrajzot, motivációs levelet vagy más dokumentumokat. Formátumok: PDF, DOC, DOCX, TXT, MD, PNG, JPG (max. 10MB darabonként).",
    es: "Adjunta CV, carta de presentación u otros documentos. Formatos: PDF, DOC, DOCX, TXT, MD, PNG, JPG (máx. 10MB cada uno).",
    de: "Lebenslauf, Anschreiben oder andere Dokumente anhängen. Formate: PDF, DOC, DOCX, TXT, MD, PNG, JPG (max. 10MB pro Datei).",
    fr: "Joignez un CV, une lettre de motivation ou d'autres documents. Formats : PDF, DOC, DOCX, TXT, MD, PNG, JPG (max 10 Mo chacun).",
    pt: "Anexe currículo, carta de apresentação ou outros documentos. Formatos: PDF, DOC, DOCX, TXT, MD, PNG, JPG (máx. 10MB cada).",
  },
  openFile: {
    it: "Apri {x} in nuova finestra",
    en: "Open {x} in new window",
    hu: "{x} megnyitása új ablakban",
    es: "Abrir {x} en una ventana nueva",
    de: "{x} in neuem Fenster öffnen",
    fr: "Ouvrir {x} dans une nouvelle fenêtre",
    pt: "Abrir {x} numa nova janela",
  },
  openLabel: {
    it: "apri",
    en: "open",
    hu: "megnyitás",
    es: "abrir",
    de: "öffnen",
    fr: "ouvrir",
    pt: "abrir",
  },
  deleteFile: {
    it: "Elimina file {x}",
    en: "Delete file {x}",
    hu: "{x} fájl törlése",
    es: "Eliminar archivo {x}",
    de: "Datei {x} löschen",
    fr: "Supprimer le fichier {x}",
    pt: "Eliminar ficheiro {x}",
  },
  deleteLabel: {
    it: "× elimina",
    en: "× delete",
    hu: "× törlés",
    es: "× eliminar",
    de: "× löschen",
    fr: "× supprimer",
    pt: "× eliminar",
  },
  uploading: {
    it: "Upload in corso…",
    en: "Uploading…",
    hu: "Feltöltés folyamatban…",
    es: "Subiendo…",
    de: "Wird hochgeladen…",
    fr: "Téléversement en cours…",
    pt: "A carregar…",
  },
  addFile: {
    it: "+ Aggiungi file",
    en: "+ Add file",
    hu: "+ Fájl hozzáadása",
    es: "+ Añadir archivo",
    de: "+ Datei hinzufügen",
    fr: "+ Ajouter un fichier",
    pt: "+ Adicionar ficheiro",
  },
  errorPrefix: {
    it: "Errore:",
    en: "Error:",
    hu: "Hiba:",
    es: "Error:",
    de: "Fehler:",
    fr: "Erreur :",
    pt: "Erro:",
  },
  savedMsg: {
    it: "Profilo salvato. Reindirizzamento...",
    en: "Profile saved. Redirecting...",
    hu: "Profil elmentve. Átirányítás...",
    es: "Perfil guardado. Redirigiendo...",
    de: "Profil gespeichert. Weiterleitung...",
    fr: "Profil enregistré. Redirection...",
    pt: "Perfil guardado. A redirecionar...",
  },
  saving: {
    it: "Salvataggio...",
    en: "Saving...",
    hu: "Mentés...",
    es: "Guardando...",
    de: "Wird gespeichert...",
    fr: "Enregistrement...",
    pt: "A guardar...",
  },
  saveProfile: {
    it: "Salva profilo",
    en: "Save profile",
    hu: "Profil mentése",
    es: "Guardar perfil",
    de: "Profil speichern",
    fr: "Enregistrer le profil",
    pt: "Guardar perfil",
  },
  cancel: {
    it: "Annulla",
    en: "Cancel",
    hu: "Mégse",
    es: "Cancelar",
    de: "Abbrechen",
    fr: "Annuler",
    pt: "Cancelar",
  },
  errUpload: {
    it: "Errore durante l'upload",
    en: "Error during upload",
    hu: "Hiba a feltöltés során",
    es: "Error durante la subida",
    de: "Fehler beim Hochladen",
    fr: "Erreur lors du téléversement",
    pt: "Erro durante o carregamento",
  },
  errSave: {
    it: "Errore durante il salvataggio",
    en: "Error while saving",
    hu: "Hiba a mentés során",
    es: "Error al guardar",
    de: "Fehler beim Speichern",
    fr: "Erreur lors de l'enregistrement",
    pt: "Erro ao guardar",
  },
  errNetwork: {
    it: "Errore di rete",
    en: "Network error",
    hu: "Hálózati hiba",
    es: "Error de red",
    de: "Netzwerkfehler",
    fr: "Erreur réseau",
    pt: "Erro de rede",
  },
};

type UploadedFile = { name: string; size: number; modified: number };

type Experience = {
  role: string;
  company: string;
  period: string;
  description: string;
};
type Education = { title: string; institution: string; year: string };
type Project = { name: string; description: string; url: string };
type CareerGoals = {
  direction: string;
  target_job: string;
  specializations: string[];
  desired_courses: string[];
};
type Aspirations = { short_term: string; long_term: string; ambitious: string };

type FormData = {
  name: string;
  target_role: string;
  location: string;
  experience_years: string;
  has_degree: boolean;
  email: string;
  phone: string;
  linkedin: string;
  github: string;
  website: string;
  skills_raw: string;
  location_preferences_raw: string;
  job_titles_raw: string;
  certifications_raw: string;
  strengths_raw: string;
  free_notes: string;
  // career goals
  cg_direction: string;
  cg_target_job: string;
  cg_specializations_raw: string;
  cg_desired_courses_raw: string;
  // aspirations
  asp_short_term: string;
  asp_long_term: string;
  asp_ambitious: string;
  // salary
  salary_italy_min: string;
  salary_italy_max: string;
  salary_remote_eu_min: string;
  salary_remote_eu_max: string;
  // lang temp
  lang_language: string;
  lang_level: string;
  // experience temp
  exp_role: string;
  exp_company: string;
  exp_period: string;
  exp_description: string;
  // education temp
  edu_title: string;
  edu_institution: string;
  edu_year: string;
  // project temp
  proj_name: string;
  proj_description: string;
  proj_url: string;
};

const INITIAL: FormData = {
  name: "",
  target_role: "",
  location: "",
  experience_years: "",
  has_degree: false,
  email: "",
  phone: "",
  linkedin: "",
  github: "",
  website: "",
  skills_raw: "",
  location_preferences_raw: "",
  job_titles_raw: "",
  certifications_raw: "",
  strengths_raw: "",
  free_notes: "",
  cg_direction: "",
  cg_target_job: "",
  cg_specializations_raw: "",
  cg_desired_courses_raw: "",
  asp_short_term: "",
  asp_long_term: "",
  asp_ambitious: "",
  salary_italy_min: "",
  salary_italy_max: "",
  salary_remote_eu_min: "",
  salary_remote_eu_max: "",
  lang_language: "",
  lang_level: "",
  exp_role: "",
  exp_company: "",
  exp_period: "",
  exp_description: "",
  edu_title: "",
  edu_institution: "",
  edu_year: "",
  proj_name: "",
  proj_description: "",
  proj_url: "",
};

export default function ProfileEditPage() {
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState<FormData>(INITIAL);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [experience, setExperience] = useState<Experience[]>([]);
  const [education, setEducation] = useState<Education[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/profile");
        const data = await res.json();
        const profile: CandidateProfile | null = data.profile;
        if (profile) {
          const pos = profile.positioning ?? {};
          const contacts = (pos.contacts ?? {}) as Record<string, string>;
          const careerGoals = (pos.career_goals ?? {}) as CareerGoals;
          const aspirations = (pos.aspirations ?? {}) as Aspirations;
          const salary = profile.salary_target;

          setForm({
            name: profile.name ?? "",
            target_role: profile.target_role ?? "",
            location: profile.location ?? "",
            experience_years:
              profile.experience_years != null
                ? String(profile.experience_years)
                : "",
            has_degree: profile.has_degree,
            email: profile.email ?? "",
            phone: contacts.phone ?? "",
            linkedin: contacts.linkedin ?? "",
            github: contacts.github ?? "",
            website: contacts.website ?? "",
            skills_raw: profile.skills
              ? Object.values(profile.skills).flat().join(", ")
              : "",
            location_preferences_raw: profile.location_preferences
              ? profile.location_preferences
                  .map((lp) => {
                    const parts = [(lp.type ?? "").replace(/_/g, " ")];
                    if (lp.region) parts.push(lp.region);
                    if (lp.cities) parts.push(lp.cities.join("/"));
                    return parts.filter(Boolean).join(" ");
                  })
                  .join(", ")
              : "",
            job_titles_raw: (profile.job_titles ?? []).join("\n"),
            certifications_raw: ((pos.certifications ?? []) as string[]).join(
              "\n",
            ),
            strengths_raw: ((pos.strengths ?? []) as string[]).join("\n"),
            free_notes: (pos.free_notes ?? "") as string,
            cg_direction: careerGoals.direction ?? "",
            cg_target_job: careerGoals.target_job ?? "",
            cg_specializations_raw: (careerGoals.specializations ?? []).join(
              "\n",
            ),
            cg_desired_courses_raw: (careerGoals.desired_courses ?? []).join(
              "\n",
            ),
            asp_short_term: aspirations.short_term ?? "",
            asp_long_term: aspirations.long_term ?? "",
            asp_ambitious: aspirations.ambitious ?? "",
            salary_italy_min:
              salary?.italy_min != null ? String(salary.italy_min) : "",
            salary_italy_max:
              salary?.italy_max != null ? String(salary.italy_max) : "",
            salary_remote_eu_min:
              salary?.remote_eu_min != null ? String(salary.remote_eu_min) : "",
            salary_remote_eu_max:
              salary?.remote_eu_max != null ? String(salary.remote_eu_max) : "",
            lang_language: "",
            lang_level: "",
            exp_role: "",
            exp_company: "",
            exp_period: "",
            exp_description: "",
            edu_title: "",
            edu_institution: "",
            edu_year: "",
            proj_name: "",
            proj_description: "",
            proj_url: "",
          });
          setLanguages(profile.languages ?? []);
          setExperience(
            ((pos.experience ?? []) as Experience[]).map((e) => ({
              role: e.role ?? "",
              company: e.company ?? "",
              period: e.period ?? "",
              description: e.description ?? "",
            })),
          );
          setEducation(
            ((pos.education ?? []) as Education[]).map((e) => ({
              title: e.title ?? "",
              institution: e.institution ?? "",
              year: e.year != null ? String(e.year) : "",
            })),
          );
          setProjects(
            ((pos.projects ?? []) as Project[]).map((p) => ({
              name: p.name ?? "",
              description: p.description ?? "",
              url: p.url ?? "",
            })),
          );
        }
      } catch {
        /* ignore */
      }
      setLoading(false);
    };
    load();
    loadFiles();
  }, []);

  // Deep-link da /profile (chip "campi mancanti"): dopo che il form e` stato
  // popolato e le FormSection sono nel DOM, scrolla manualmente all'ancora
  // — il browser non lo fa di default perche` la pagina e` un client
  // component che renderizza dopo il primo paint.
  useEffect(() => {
    if (loading) return;
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    requestAnimationFrame(() => {
      document
        .getElementById(hash)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [loading]);

  const loadFiles = async () => {
    try {
      const res = await fetch("/api/profile/files");
      const data = await res.json();
      setUploadedFiles(data.files ?? []);
    } catch {
      /* ignore */
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setUploading(true);
    setUploadError(null);
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("files", f));
    try {
      const res = await fetch("/api/profile/upload", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (data.errors?.length) setUploadError(data.errors.join(", "));
      await loadFiles();
    } catch {
      setUploadError(tr("errUpload"));
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDeleteFile = async (name: string) => {
    try {
      await fetch("/api/profile/files", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      await loadFiles();
    } catch {
      /* ignore */
    }
  };

  const set = (key: keyof FormData, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const addLanguage = () => {
    if (!form.lang_language.trim()) return;
    setLanguages((prev) => [
      ...prev,
      { language: form.lang_language.trim(), level: form.lang_level || "n/a" },
    ]);
    setForm((prev) => ({ ...prev, lang_language: "", lang_level: "" }));
  };

  const addExperience = () => {
    if (!form.exp_role.trim()) return;
    setExperience((prev) => [
      ...prev,
      {
        role: form.exp_role.trim(),
        company: form.exp_company.trim(),
        period: form.exp_period.trim(),
        description: form.exp_description.trim(),
      },
    ]);
    setForm((prev) => ({
      ...prev,
      exp_role: "",
      exp_company: "",
      exp_period: "",
      exp_description: "",
    }));
  };

  const addEducation = () => {
    if (!form.edu_title.trim()) return;
    setEducation((prev) => [
      ...prev,
      {
        title: form.edu_title.trim(),
        institution: form.edu_institution.trim(),
        year: form.edu_year.trim(),
      },
    ]);
    setForm((prev) => ({
      ...prev,
      edu_title: "",
      edu_institution: "",
      edu_year: "",
    }));
  };

  const addProject = () => {
    if (!form.proj_name.trim()) return;
    setProjects((prev) => [
      ...prev,
      {
        name: form.proj_name.trim(),
        description: form.proj_description.trim(),
        url: form.proj_url.trim(),
      },
    ]);
    setForm((prev) => ({
      ...prev,
      proj_name: "",
      proj_description: "",
      proj_url: "",
    }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const skillsList = form.skills_raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const certifications = form.certifications_raw
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const strengths = form.strengths_raw
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const careerGoals: CareerGoals = {
        direction: form.cg_direction.trim(),
        target_job: form.cg_target_job.trim(),
        specializations: form.cg_specializations_raw
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        desired_courses: form.cg_desired_courses_raw
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      };
      const aspirations: Aspirations = {
        short_term: form.asp_short_term.trim(),
        long_term: form.asp_long_term.trim(),
        ambitious: form.asp_ambitious.trim(),
      };

      const salaryPayload =
        form.salary_italy_min || form.salary_remote_eu_min
          ? {
              currency: "EUR",
              italy_min: form.salary_italy_min
                ? parseInt(form.salary_italy_min)
                : 0,
              italy_max: form.salary_italy_max
                ? parseInt(form.salary_italy_max)
                : 0,
              remote_eu_min: form.salary_remote_eu_min
                ? parseInt(form.salary_remote_eu_min)
                : 0,
              remote_eu_max: form.salary_remote_eu_max
                ? parseInt(form.salary_remote_eu_max)
                : 0,
            }
          : null;

      const payload = {
        name: form.name || null,
        email: form.email || null,
        target_role: form.target_role || null,
        location: form.location || null,
        experience_years: form.experience_years
          ? parseInt(form.experience_years)
          : null,
        has_degree: form.has_degree,
        skills: skillsList.length > 0 ? { general: skillsList } : {},
        languages,
        location_preferences: form.location_preferences_raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => ({ type: s })),
        job_titles: form.job_titles_raw
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        salary_target: salaryPayload,
        positioning: {
          contacts: {
            email: form.email || "",
            phone: form.phone || "",
            linkedin: form.linkedin || "",
            github: form.github || "",
            website: form.website || "",
          },
          experience,
          education,
          certifications,
          projects,
          strengths,
          career_goals: careerGoals,
          aspirations,
          free_notes: form.free_notes.trim(),
        },
        updated_at: new Date().toISOString(),
      };

      try {
        const res = await fetch("/api/profile-assistant/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile: payload, confirmed: true }),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          setError(data.error ?? tr("errSave"));
        } else {
          setSuccess(true);
          setTimeout(() => router.push("/profile"), 800);
        }
      } catch {
        setError(tr("errNetwork"));
      }
    });
  };

  if (loading) {
    return (
      <div
        className="flex items-center justify-center min-h-[60vh]"
        role="status"
        aria-live="polite"
      >
        <span className="text-[var(--color-dim)] text-[11px] tracking-widest uppercase animate-pulse">
          {tr("loading")}
        </span>
      </div>
    );
  }

  return (
    <>
      <div style={{ animation: "fade-in 0.35s ease both" }}>
        <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-3">
            <Link
              href="/dashboard"
              className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
            >
              {tr("bcDashboard")}
            </Link>
            <span className="text-[var(--color-border)]" aria-hidden="true">
              /
            </span>
            <Link
              href="/profile"
              className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
            >
              {tr("bcProfile")}
            </Link>
            <span className="text-[var(--color-border)]" aria-hidden="true">
              /
            </span>
            <span
              className="text-[10px] text-[var(--color-muted)]"
              aria-current="page"
            >
              {tr("bcEdit")}
            </span>
          </nav>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
            {tr("pageTitle")}
          </h1>
          <p className="text-[var(--color-muted)] text-[11px] mt-1">
            {tr("pageSubtitle")}
          </p>
        </div>

        <form
          aria-label={tr("formAria")}
          onSubmit={handleSubmit}
          aria-busy={isPending}
          className="max-w-2xl space-y-8"
        >
          {/* ── Info Base ── */}
          <FormSection id="info-base" title={tr("secInfoBase")}>
            <FormRow>
              <FormField label={tr("fName")}>
                <input
                  type="text"
                  value={form.name}
                  placeholder={tr("phName")}
                  onChange={(e) => set("name", e.target.value)}
                />
              </FormField>
              <FormField label={tr("fTargetRole")}>
                <input
                  type="text"
                  value={form.target_role}
                  placeholder={tr("phBackendDev")}
                  onChange={(e) => set("target_role", e.target.value)}
                />
              </FormField>
            </FormRow>
            <FormRow>
              <FormField label={tr("fLocation")}>
                <input
                  type="text"
                  value={form.location}
                  placeholder={tr("phRemoteEu")}
                  onChange={(e) => set("location", e.target.value)}
                />
              </FormField>
              <FormField label={tr("fExpYears")}>
                <input
                  type="number"
                  min="0"
                  max="40"
                  value={form.experience_years}
                  placeholder={tr("phYears")}
                  onChange={(e) => set("experience_years", e.target.value)}
                />
              </FormField>
            </FormRow>
            <div className="flex items-center gap-3 mt-2">
              <input
                type="checkbox"
                id="degree"
                checked={form.has_degree}
                onChange={(e) => set("has_degree", e.target.checked)}
                className="w-4 h-4 cursor-pointer accent-[var(--color-green)]"
                style={{ width: "16px", padding: 0 }}
              />
              <label
                htmlFor="degree"
                className="text-[11px] text-[var(--color-base)] cursor-pointer mb-0 normal-case tracking-normal font-normal"
              >
                {tr("fDegree")}
              </label>
            </div>
          </FormSection>

          {/* ── Contatti ── */}
          <FormSection id="contatti" title={tr("secContacts")}>
            <FormRow>
              <FormField label={tr("fEmail")}>
                <input
                  type="email"
                  value={form.email}
                  placeholder={tr("phEmail")}
                  onChange={(e) => set("email", e.target.value)}
                />
              </FormField>
              <FormField label={tr("fPhone")}>
                <input
                  type="tel"
                  value={form.phone}
                  placeholder="+39 333 1234567"
                  onChange={(e) => set("phone", e.target.value)}
                />
              </FormField>
            </FormRow>
            <FormRow>
              <FormField label={tr("fLinkedin")}>
                <input
                  type="text"
                  value={form.linkedin}
                  placeholder="linkedin.com/in/..."
                  onChange={(e) => set("linkedin", e.target.value)}
                />
              </FormField>
              <FormField label={tr("fGithub")}>
                <input
                  type="text"
                  value={form.github}
                  placeholder="github.com/..."
                  onChange={(e) => set("github", e.target.value)}
                />
              </FormField>
            </FormRow>
            <FormField label={tr("fWebsite")}>
              <input
                type="url"
                value={form.website}
                placeholder="https://..."
                onChange={(e) => set("website", e.target.value)}
              />
            </FormField>
          </FormSection>

          {/* ── Skills ── */}
          <FormSection id="skills" title={tr("secSkills")}>
            <FormField label={tr("fSkills")}>
              <textarea
                rows={3}
                value={form.skills_raw}
                placeholder="Python, JavaScript, FastAPI, PostgreSQL, Docker, Git"
                onChange={(e) => set("skills_raw", e.target.value)}
              />
            </FormField>
          </FormSection>

          {/* ── Lingue ── */}
          <FormSection id="lingue" title={tr("secLanguages")}>
            {languages.length > 0 && (
              <div className="flex flex-col gap-1.5 mb-4">
                {languages.map((l, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-3 py-2 bg-[var(--color-deep)] border border-[var(--color-border)] rounded transition-colors hover:border-[var(--color-border-glow)]"
                  >
                    <span className="text-[12px] text-[var(--color-bright)]">
                      {l.language}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-[var(--color-muted)]">
                        {l.level}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setLanguages((prev) => prev.filter((_, j) => j !== i))
                        }
                        aria-label={tr("removeLang").replace("{x}", l.language)}
                        className="text-[10px] text-[var(--color-red)] hover:opacity-70 cursor-pointer bg-transparent border-0 p-0"
                      >
                        {tr("remove")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <FormRow>
              <FormField label={tr("fLanguage")}>
                <input
                  type="text"
                  value={form.lang_language}
                  placeholder={tr("phLanguage")}
                  onChange={(e) => set("lang_language", e.target.value)}
                />
              </FormField>
              <FormField label={tr("fLevel")}>
                <select
                  value={form.lang_level}
                  onChange={(e) => set("lang_level", e.target.value)}
                >
                  <option value="">{tr("selectPlaceholder")}</option>
                  {["madrelingua", "C2", "C1", "B2", "B1", "A2", "A1"].map(
                    (l) => (
                      <option key={l} value={l}>
                        {l === "madrelingua" ? tr("optNative") : l}
                      </option>
                    ),
                  )}
                </select>
              </FormField>
            </FormRow>
            <button
              type="button"
              onClick={addLanguage}
              disabled={!form.lang_language.trim()}
              className="mt-2 text-[10px] font-semibold tracking-widest uppercase text-[var(--color-green)] hover:opacity-70 transition-opacity cursor-pointer bg-transparent border-0 p-0 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {tr("addLang")}
            </button>
          </FormSection>

          {/* ── Esperienza ── */}
          <FormSection
            id="esperienza-lavorativa"
            title={tr("secExperience")}
          >
            {experience.length > 0 && (
              <div className="flex flex-col gap-2 mb-4">
                {experience.map((e, i) => (
                  <div
                    key={i}
                    className="px-3 py-2.5 bg-[var(--color-deep)] border border-[var(--color-border)] rounded transition-colors hover:border-[var(--color-border-glow)]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[12px] font-semibold text-[var(--color-bright)]">
                          {e.role}
                        </span>
                        {e.company && (
                          <span className="text-[10px] text-[var(--color-muted)] ml-2">
                            {e.company}
                          </span>
                        )}
                        {e.period && (
                          <span className="text-[10px] text-[var(--color-dim)] ml-2 font-mono">
                            {e.period}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setExperience((prev) =>
                            prev.filter((_, j) => j !== i),
                          )
                        }
                        aria-label={tr("removeExp").replace("{x}", e.role)}
                        className="text-[10px] text-[var(--color-red)] hover:opacity-70 cursor-pointer bg-transparent border-0 p-0 flex-shrink-0"
                      >
                        {tr("remove")}
                      </button>
                    </div>
                    {e.description && (
                      <p className="text-[10px] text-[var(--color-dim)] mt-1">
                        {e.description}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
            <FormRow>
              <FormField label={tr("fRole")}>
                <input
                  type="text"
                  value={form.exp_role}
                  placeholder={tr("phBackendDev")}
                  onChange={(e) => set("exp_role", e.target.value)}
                />
              </FormField>
              <FormField label={tr("fCompany")}>
                <input
                  type="text"
                  value={form.exp_company}
                  placeholder={tr("phCompany")}
                  onChange={(e) => set("exp_company", e.target.value)}
                />
              </FormField>
            </FormRow>
            <FormField label={tr("fPeriod")}>
              <input
                type="text"
                value={form.exp_period}
                placeholder={tr("phPeriod")}
                onChange={(e) => set("exp_period", e.target.value)}
              />
            </FormField>
            <FormField label={tr("fExpDesc")}>
              <textarea
                rows={2}
                value={form.exp_description}
                placeholder={tr("phExpDesc")}
                onChange={(e) => set("exp_description", e.target.value)}
              />
            </FormField>
            <button
              type="button"
              onClick={addExperience}
              disabled={!form.exp_role.trim()}
              className="mt-2 text-[10px] font-semibold tracking-widest uppercase text-[var(--color-green)] hover:opacity-70 transition-opacity cursor-pointer bg-transparent border-0 p-0 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {tr("addExp")}
            </button>
          </FormSection>

          {/* ── Formazione ── */}
          <FormSection id="formazione" title={tr("secEducation")}>
            {education.length > 0 && (
              <div className="flex flex-col gap-2 mb-4">
                {education.map((e, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-3 py-2 bg-[var(--color-deep)] border border-[var(--color-border)] rounded transition-colors hover:border-[var(--color-border-glow)]"
                  >
                    <div>
                      <span className="text-[12px] text-[var(--color-bright)]">
                        {e.title}
                      </span>
                      {e.institution && (
                        <span className="text-[10px] text-[var(--color-muted)] ml-2">
                          {e.institution}
                        </span>
                      )}
                      {e.year && (
                        <span className="text-[10px] text-[var(--color-dim)] ml-2 font-mono">
                          {e.year}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setEducation((prev) => prev.filter((_, j) => j !== i))
                      }
                      aria-label={tr("removeEdu").replace("{x}", e.title)}
                      className="text-[10px] text-[var(--color-red)] hover:opacity-70 cursor-pointer bg-transparent border-0 p-0"
                    >
                      {tr("remove")}
                    </button>
                  </div>
                ))}
              </div>
            )}
            <FormRow>
              <FormField label={tr("fTitle")}>
                <input
                  type="text"
                  value={form.edu_title}
                  placeholder={tr("phEduTitle")}
                  onChange={(e) => set("edu_title", e.target.value)}
                />
              </FormField>
              <FormField label={tr("fInstitution")}>
                <input
                  type="text"
                  value={form.edu_institution}
                  placeholder={tr("phInstitution")}
                  onChange={(e) => set("edu_institution", e.target.value)}
                />
              </FormField>
            </FormRow>
            <FormField label={tr("fYear")}>
              <input
                type="text"
                value={form.edu_year}
                placeholder={tr("phYear")}
                onChange={(e) => set("edu_year", e.target.value)}
              />
            </FormField>
            <button
              type="button"
              onClick={addEducation}
              disabled={!form.edu_title.trim()}
              className="mt-2 text-[10px] font-semibold tracking-widest uppercase text-[var(--color-green)] hover:opacity-70 transition-opacity cursor-pointer bg-transparent border-0 p-0 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {tr("addEdu")}
            </button>
            <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
              <FormField label={tr("fCertifications")}>
                <textarea
                  rows={3}
                  value={form.certifications_raw}
                  placeholder={
                    "AWS Solutions Architect\nGoogle Cloud Professional\nKubernetes Administrator"
                  }
                  onChange={(e) => set("certifications_raw", e.target.value)}
                />
              </FormField>
            </div>
          </FormSection>

          {/* ── Progetti ── */}
          <FormSection title={tr("secProjects")}>
            {projects.length > 0 && (
              <div className="flex flex-col gap-2 mb-4">
                {projects.map((p, i) => (
                  <div
                    key={i}
                    className="px-3 py-2.5 bg-[var(--color-deep)] border border-[var(--color-border)] rounded transition-colors hover:border-[var(--color-border-glow)]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[12px] font-semibold text-[var(--color-bright)]">
                        {p.name}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setProjects((prev) => prev.filter((_, j) => j !== i))
                        }
                        aria-label={tr("removeProj").replace("{x}", p.name)}
                        className="text-[10px] text-[var(--color-red)] hover:opacity-70 cursor-pointer bg-transparent border-0 p-0 flex-shrink-0"
                      >
                        {tr("remove")}
                      </button>
                    </div>
                    {p.description && (
                      <p className="text-[10px] text-[var(--color-dim)] mt-1">
                        {p.description}
                      </p>
                    )}
                    {p.url && (
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[9px] text-[var(--color-blue)] font-mono"
                      >
                        {p.url}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
            <FormField label={tr("fProjName")}>
              <input
                type="text"
                value={form.proj_name}
                placeholder={tr("phProjName")}
                onChange={(e) => set("proj_name", e.target.value)}
              />
            </FormField>
            <FormField label={tr("fDescription")}>
              <textarea
                rows={2}
                value={form.proj_description}
                placeholder={tr("phProjDesc")}
                onChange={(e) => set("proj_description", e.target.value)}
              />
            </FormField>
            <FormField label={tr("fProjUrl")}>
              <input
                type="url"
                value={form.proj_url}
                placeholder="https://github.com/..."
                onChange={(e) => set("proj_url", e.target.value)}
              />
            </FormField>
            <button
              type="button"
              onClick={addProject}
              disabled={!form.proj_name.trim()}
              className="mt-2 text-[10px] font-semibold tracking-widest uppercase text-[var(--color-green)] hover:opacity-70 transition-opacity cursor-pointer bg-transparent border-0 p-0 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {tr("addProj")}
            </button>
          </FormSection>

          {/* ── Location preferences ── */}
          <FormSection id="location-preferite" title={tr("secLocPref")}>
            <FormField label={tr("fLocPref")}>
              <input
                type="text"
                value={form.location_preferences_raw}
                placeholder="Remote EU, Remote Worldwide, Hybrid Milano"
                onChange={(e) =>
                  set("location_preferences_raw", e.target.value)
                }
              />
            </FormField>
          </FormSection>

          {/* ── Ruoli target ── */}
          <FormSection id="ruoli-target" title={tr("secTargetRoles")}>
            <FormField label={tr("fTargetRoles")}>
              <textarea
                rows={4}
                value={form.job_titles_raw}
                placeholder={
                  "Backend Developer\nPython Developer\nFull Stack Developer"
                }
                onChange={(e) => set("job_titles_raw", e.target.value)}
              />
            </FormField>
          </FormSection>

          {/* ── Salary ── */}
          <FormSection id="salary-target" title={tr("secSalary")}>
            <FormRow>
              <FormField label={tr("fItalyMin")}>
                <input
                  type="number"
                  value={form.salary_italy_min}
                  placeholder={tr("ph40000")}
                  onChange={(e) => set("salary_italy_min", e.target.value)}
                />
              </FormField>
              <FormField label={tr("fItalyMax")}>
                <input
                  type="number"
                  value={form.salary_italy_max}
                  placeholder={tr("ph55000")}
                  onChange={(e) => set("salary_italy_max", e.target.value)}
                />
              </FormField>
            </FormRow>
            <FormRow>
              <FormField label={tr("fRemoteMin")}>
                <input
                  type="number"
                  value={form.salary_remote_eu_min}
                  placeholder={tr("ph50000")}
                  onChange={(e) => set("salary_remote_eu_min", e.target.value)}
                />
              </FormField>
              <FormField label={tr("fRemoteMax")}>
                <input
                  type="number"
                  value={form.salary_remote_eu_max}
                  placeholder={tr("ph70000")}
                  onChange={(e) => set("salary_remote_eu_max", e.target.value)}
                />
              </FormField>
            </FormRow>
          </FormSection>

          {/* ── Punti di forza ── */}
          <FormSection id="punti-di-forza" title={tr("secStrengths")}>
            <FormField label={tr("fStrengths")}>
              <textarea
                rows={3}
                value={form.strengths_raw}
                placeholder={tr("phStrengths")}
                onChange={(e) => set("strengths_raw", e.target.value)}
              />
            </FormField>
          </FormSection>

          {/* ── Obiettivi di carriera ── */}
          <FormSection id="obiettivi-carriera" title={tr("secCareerGoals")}>
            <FormRow>
              <FormField label={tr("fDirection")}>
                <input
                  type="text"
                  value={form.cg_direction}
                  placeholder={tr("phDirection")}
                  onChange={(e) => set("cg_direction", e.target.value)}
                />
              </FormField>
              <FormField label={tr("fJobTarget")}>
                <input
                  type="text"
                  value={form.cg_target_job}
                  placeholder={tr("phJobTarget")}
                  onChange={(e) => set("cg_target_job", e.target.value)}
                />
              </FormField>
            </FormRow>
            <FormField label={tr("fSpecializations")}>
              <textarea
                rows={3}
                value={form.cg_specializations_raw}
                placeholder={
                  "Distributed Systems\nMachine Learning\nCloud Architecture"
                }
                onChange={(e) => set("cg_specializations_raw", e.target.value)}
              />
            </FormField>
            <FormField label={tr("fDesiredCourses")}>
              <textarea
                rows={3}
                value={form.cg_desired_courses_raw}
                placeholder={
                  "Kubernetes Advanced\nSystem Design\nData Engineering"
                }
                onChange={(e) => set("cg_desired_courses_raw", e.target.value)}
              />
            </FormField>
          </FormSection>

          {/* ── Desideri & Aspirazioni ── */}
          <FormSection title={tr("secAspirations")}>
            <FormField label={tr("fShortTerm")}>
              <textarea
                rows={2}
                value={form.asp_short_term}
                placeholder={tr("phShortTerm")}
                onChange={(e) => set("asp_short_term", e.target.value)}
              />
            </FormField>
            <FormField label={tr("fLongTerm")}>
              <textarea
                rows={2}
                value={form.asp_long_term}
                placeholder={tr("phLongTerm")}
                onChange={(e) => set("asp_long_term", e.target.value)}
              />
            </FormField>
            <FormField label={tr("fAmbitious")}>
              <textarea
                rows={2}
                value={form.asp_ambitious}
                placeholder={tr("phAmbitious")}
                onChange={(e) => set("asp_ambitious", e.target.value)}
              />
            </FormField>
          </FormSection>

          {/* ── Note libere ── */}
          <FormSection title={tr("secNotes")}>
            <FormField label={tr("fNotes")}>
              <textarea
                rows={4}
                value={form.free_notes}
                placeholder={tr("phNotes")}
                onChange={(e) => set("free_notes", e.target.value)}
              />
            </FormField>
          </FormSection>

          {/* ── Upload file ── */}
          <FormSection title={tr("secFiles")}>
            <p className="text-[10px] text-[var(--color-dim)] -mt-2 mb-2">
              {tr("filesHint")}
            </p>
            {uploadedFiles.length > 0 && (
              <div className="flex flex-col gap-1.5 mb-4">
                {uploadedFiles.map((f) => (
                  <div
                    key={f.name}
                    className="flex items-center justify-between px-3 py-2 bg-[var(--color-deep)] border border-[var(--color-border)] rounded transition-colors hover:border-[var(--color-border-glow)]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="text-[12px] text-[var(--color-bright)] truncate"
                        title={f.name}
                      >
                        {f.name}
                      </span>
                      <span className="text-[9px] text-[var(--color-dim)] flex-shrink-0">
                        {(f.size / 1024).toFixed(0)} KB
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                      <a
                        href={`/api/profile/files/${encodeURIComponent(f.name)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={tr("openFile").replace("{x}", f.name)}
                        className="text-[10px] text-[var(--color-blue)] hover:underline no-underline"
                      >
                        {tr("openLabel")} <span aria-hidden="true">↗</span>
                      </a>
                      <button
                        type="button"
                        onClick={() => handleDeleteFile(f.name)}
                        aria-label={tr("deleteFile").replace("{x}", f.name)}
                        className="text-[10px] text-[var(--color-red)] hover:opacity-70 cursor-pointer bg-transparent border-0 p-0"
                      >
                        {tr("deleteLabel")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg"
                onChange={handleUpload}
                className="hidden"
                id="file-upload"
              />
              <label
                htmlFor="file-upload"
                className="inline-flex items-center gap-2 px-4 py-2 border border-[var(--color-border)] rounded text-[10px] font-semibold tracking-widest uppercase text-[var(--color-muted)] hover:border-[var(--color-green)] hover:text-[var(--color-green)] transition-colors cursor-pointer"
              >
                {uploading ? tr("uploading") : tr("addFile")}
              </label>
            </div>
            {uploadError && (
              <p className="text-[10px] text-[var(--color-red)] mt-2">
                {uploadError}
              </p>
            )}
          </FormSection>

          {/* ── Submit ── */}
          {error && (
            <div
              className="px-4 py-3 bg-[var(--color-red)]/10 border border-[var(--color-red)]/30 rounded text-[11px] text-[var(--color-red)]"
              role="alert"
            >
              {tr("errorPrefix")} {error}
            </div>
          )}

          {success && (
            <div className="px-4 py-3 bg-[var(--color-green)]/10 border border-[var(--color-green)]/30 rounded text-[11px] text-[var(--color-green)]">
              {tr("savedMsg")}
            </div>
          )}

          <div className="flex gap-3 pb-8">
            <button
              type="submit"
              disabled={isPending || success}
              className="px-6 py-2.5 bg-[var(--color-green)] text-[var(--color-void)] text-[11px] font-bold tracking-widest uppercase rounded hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
            >
              {isPending ? tr("saving") : tr("saveProfile")}
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              className="px-5 py-2.5 border border-[var(--color-border)] text-[11px] font-semibold tracking-widest uppercase text-[var(--color-muted)] rounded hover:border-[var(--color-border-glow)] transition-colors cursor-pointer bg-transparent"
            >
              {tr("cancel")}
            </button>
          </div>
        </form>
      </div>
      <ProfileAssistantFab />
    </>
  );
}

function FormSection({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: React.ReactNode;
}) {
  // scroll-mt-20 evita che il deep-link da /profile (#anchor) finisca dietro
  // la navbar fissa quando si arriva alla sezione.
  return (
    <div
      id={id}
      className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-6 scroll-mt-20"
    >
      <div className="section-label mb-5">{title}</div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function FormRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactElement<{ id?: string }>;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {React.cloneElement(children, { id })}
    </div>
  );
}
