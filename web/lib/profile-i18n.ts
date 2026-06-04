/**
 * Dizionario i18n condiviso per l'area Profilo (pagina /profile + ProfileStats).
 * Modulo "neutro" (no "use client"): importabile sia dal server component
 * `app/(protected)/profile/page.tsx` sia dal client component `ProfileStats`.
 *
 * Copre tutte e 7 le lingue supportate (vedi i18n/config). Fallback in t():
 * lingua scelta → italiano → chiave grezza.
 */
import type { Locale } from "@/i18n/config";

type Entry = Partial<Record<Locale, string>> & { it: string };

const T: Record<string, Entry> = {
  // ── Header pagina ────────────────────────────────────────────────
  bc_dashboard: { it: "Dashboard", en: "Dashboard", hu: "Irányítópult", es: "Panel", de: "Dashboard", fr: "Tableau de bord", pt: "Painel" },
  bc_profile: { it: "Profilo", en: "Profile", hu: "Profil", es: "Perfil", de: "Profil", fr: "Profil", pt: "Perfil" },
  page_title: { it: "Profilo candidato", en: "Candidate Profile", hu: "Jelölt profil", es: "Perfil del candidato", de: "Kandidatenprofil", fr: "Profil du candidat", pt: "Perfil do candidato" },
  updated_on: { it: "Aggiornato il", en: "Updated on", hu: "Frissítve", es: "Actualizado el", de: "Aktualisiert am", fr: "Mis à jour le", pt: "Atualizado em" },
  edit: { it: "Modifica", en: "Edit", hu: "Szerkesztés", es: "Editar", de: "Bearbeiten", fr: "Modifier", pt: "Editar" },
  export_json: { it: "Esporta JSON", en: "Export JSON", hu: "JSON exportálása", es: "Exportar JSON", de: "JSON exportieren", fr: "Exporter JSON", pt: "Exportar JSON" },
  no_profile_title: { it: "Nessun profilo configurato", en: "No profile configured", hu: "Nincs profil beállítva", es: "Ningún perfil configurado", de: "Kein Profil konfiguriert", fr: "Aucun profil configuré", pt: "Nenhum perfil configurado" },
  no_profile_desc: {
    it: "Compila il modulo qui sotto o carica un CV per estrarre i dati automaticamente.",
    en: "Fill out the form below or upload a CV to extract data automatically.",
    hu: "Töltsd ki az alábbi űrlapot, vagy tölts fel egy önéletrajzot az adatok automatikus kinyeréséhez.",
    es: "Rellena el formulario de abajo o sube un CV para extraer los datos automáticamente.",
    de: "Füllen Sie das untenstehende Formular aus oder laden Sie einen Lebenslauf hoch, um die Daten automatisch zu extrahieren.",
    fr: "Remplissez le formulaire ci-dessous ou importez un CV pour extraire les données automatiquement.",
    pt: "Preencha o formulário abaixo ou envie um CV para extrair os dados automaticamente.",
  },

  // ── Titoli sezione ───────────────────────────────────────────────
  sec_info_base: { it: "Info base", en: "Basic Info", hu: "Alapadatok", es: "Información básica", de: "Basisdaten", fr: "Informations de base", pt: "Informações básicas" },
  sec_contacts: { it: "Contatti", en: "Contacts", hu: "Kapcsolatok", es: "Contactos", de: "Kontakte", fr: "Contacts", pt: "Contatos" },
  sec_languages: { it: "Lingue", en: "Languages", hu: "Nyelvek", es: "Idiomas", de: "Sprachen", fr: "Langues", pt: "Idiomas" },
  sec_skills: { it: "Competenze", en: "Skills", hu: "Készségek", es: "Habilidades", de: "Fähigkeiten", fr: "Compétences", pt: "Competências" },
  sec_experience: { it: "Esperienza lavorativa", en: "Work Experience", hu: "Munkatapasztalat", es: "Experiencia laboral", de: "Berufserfahrung", fr: "Expérience professionnelle", pt: "Experiência profissional" },
  sec_education: { it: "Formazione e certificazioni", en: "Education & Certifications", hu: "Tanulmányok és tanúsítványok", es: "Formación y certificaciones", de: "Ausbildung & Zertifikate", fr: "Formation et certifications", pt: "Formação e certificações" },
  sec_projects: { it: "Progetti personali", en: "Personal Projects", hu: "Személyes projektek", es: "Proyectos personales", de: "Persönliche Projekte", fr: "Projets personnels", pt: "Projetos pessoais" },
  sec_target_roles: { it: "Ruoli target", en: "Target Roles", hu: "Célpozíciók", es: "Roles objetivo", de: "Zielrollen", fr: "Postes visés", pt: "Cargos-alvo" },
  sec_job_prefs: { it: "Preferenze lavoro", en: "Job Preferences", hu: "Munkahelyi preferenciák", es: "Preferencias laborales", de: "Job-Präferenzen", fr: "Préférences d'emploi", pt: "Preferências de trabalho" },
  sec_career_goals: { it: "Obiettivi di carriera", en: "Career Goals", hu: "Karriercélok", es: "Objetivos profesionales", de: "Karriereziele", fr: "Objectifs de carrière", pt: "Objetivos de carreira" },
  sec_aspirations: { it: "Desideri e aspirazioni", en: "Wishes & Aspirations", hu: "Vágyak és törekvések", es: "Deseos y aspiraciones", de: "Wünsche & Ambitionen", fr: "Souhaits et aspirations", pt: "Desejos e aspirações" },
  sec_strengths: { it: "Punti di forza", en: "Strengths", hu: "Erősségek", es: "Fortalezas", de: "Stärken", fr: "Points forts", pt: "Pontos fortes" },
  sec_free_notes: { it: "Note libere", en: "Free Notes", hu: "Szabad jegyzetek", es: "Notas libres", de: "Freie Notizen", fr: "Notes libres", pt: "Notas livres" },
  cert_label: { it: "Certificazioni", en: "Certifications", hu: "Tanúsítványok", es: "Certificaciones", de: "Zertifikate", fr: "Certifications", pt: "Certificações" },

  // ── Campi info base ──────────────────────────────────────────────
  f_name: { it: "Nome", en: "Name", hu: "Név", es: "Nombre", de: "Name", fr: "Nom", pt: "Nome" },
  f_target_role: { it: "Ruolo target", en: "Target role", hu: "Célpozíció", es: "Rol objetivo", de: "Zielrolle", fr: "Poste visé", pt: "Cargo-alvo" },
  f_location: { it: "Località", en: "Location", hu: "Helyszín", es: "Ubicación", de: "Standort", fr: "Localisation", pt: "Localização" },
  f_experience: { it: "Esperienza", en: "Experience", hu: "Tapasztalat", es: "Experiencia", de: "Erfahrung", fr: "Expérience", pt: "Experiência" },
  f_degree: { it: "Laurea", en: "Degree", hu: "Diploma", es: "Título", de: "Abschluss", fr: "Diplôme", pt: "Diploma" },
  f_email: { it: "Email", en: "Email", hu: "Email", es: "Email", de: "Email", fr: "Email", pt: "Email" },
  f_yes: { it: "Sì", en: "Yes", hu: "Igen", es: "Sí", de: "Ja", fr: "Oui", pt: "Sim" },
  f_no: { it: "No", en: "No", hu: "Nem", es: "No", de: "Nein", fr: "Non", pt: "Não" },
  years: { it: "anni", en: "years", hu: "év", es: "años", de: "Jahre", fr: "ans", pt: "anos" },

  // ── Contatti ─────────────────────────────────────────────────────
  c_phone: { it: "Telefono", en: "Phone", hu: "Telefon", es: "Teléfono", de: "Telefon", fr: "Téléphone", pt: "Telefone" },
  c_website: { it: "Sito web", en: "Website", hu: "Weboldal", es: "Sitio web", de: "Website", fr: "Site web", pt: "Site" },

  // ── Stati vuoti ──────────────────────────────────────────────────
  empty_languages: { it: "Nessuna lingua inserita", en: "No languages entered", hu: "Nincs nyelv megadva", es: "No hay idiomas", de: "Keine Sprachen angegeben", fr: "Aucune langue saisie", pt: "Nenhum idioma inserido" },
  empty_skills: { it: "Nessuna competenza inserita", en: "No skills entered", hu: "Nincs készség megadva", es: "No hay habilidades", de: "Keine Fähigkeiten angegeben", fr: "Aucune compétence saisie", pt: "Nenhuma competência inserida" },
  empty_experience: { it: "Nessuna esperienza inserita", en: "No experience entered", hu: "Nincs tapasztalat megadva", es: "No hay experiencia", de: "Keine Erfahrung angegeben", fr: "Aucune expérience saisie", pt: "Nenhuma experiência inserida" },
  empty_education: { it: "Nessuna formazione inserita", en: "No education entered", hu: "Nincs tanulmány megadva", es: "No hay formación", de: "Keine Ausbildung angegeben", fr: "Aucune formation saisie", pt: "Nenhuma formação inserida" },
  empty_projects: { it: "Nessun progetto inserito", en: "No projects entered", hu: "Nincs projekt megadva", es: "No hay proyectos", de: "Keine Projekte angegeben", fr: "Aucun projet saisi", pt: "Nenhum projeto inserido" },
  empty_roles: { it: "Nessun ruolo inserito", en: "No roles entered", hu: "Nincs pozíció megadva", es: "No hay roles", de: "Keine Rollen angegeben", fr: "Aucun poste saisi", pt: "Nenhum cargo inserido" },
  empty_prefs: { it: "Nessuna preferenza", en: "No preferences", hu: "Nincs preferencia", es: "Sin preferencias", de: "Keine Präferenzen", fr: "Aucune préférence", pt: "Sem preferências" },
  empty_goals: { it: "Nessun obiettivo inserito", en: "No goals entered", hu: "Nincs cél megadva", es: "No hay objetivos", de: "Keine Ziele angegeben", fr: "Aucun objectif saisi", pt: "Nenhum objetivo inserido" },
  empty_aspirations: { it: "Nessuna aspirazione inserita", en: "No aspirations entered", hu: "Nincs törekvés megadva", es: "No hay aspiraciones", de: "Keine Ambitionen angegeben", fr: "Aucune aspiration saisie", pt: "Nenhuma aspiração inserida" },
  empty_strengths: { it: "Nessun punto di forza inserito", en: "No strengths entered", hu: "Nincs erősség megadva", es: "No hay fortalezas", de: "Keine Stärken angegeben", fr: "Aucun point fort saisi", pt: "Nenhum ponto forte inserido" },

  // ── Progetti / ruoli ─────────────────────────────────────────────
  link: { it: "link", en: "link", hu: "link", es: "enlace", de: "Link", fr: "lien", pt: "link" },

  // ── Preferenze lavoro / salary ───────────────────────────────────
  salary_target: { it: "Obiettivo retributivo", en: "Salary target", hu: "Fizetési cél", es: "Objetivo salarial", de: "Gehaltsziel", fr: "Objectif salarial", pt: "Meta salarial" },
  salary_italy: { it: "Italia", en: "Italy", hu: "Olaszország", es: "Italia", de: "Italien", fr: "Italie", pt: "Itália" },
  salary_remote_eu: { it: "Remote EU", en: "Remote EU", hu: "Remote EU", es: "Remote EU", de: "Remote EU", fr: "Remote EU", pt: "Remote EU" },
  days_per_week: { it: "gg/sett", en: "days/week", hu: "nap/hét", es: "días/sem", de: "Tage/Woche", fr: "jours/sem", pt: "dias/sem" },

  // ── Obiettivi di carriera ────────────────────────────────────────
  cg_direction: { it: "Direzione", en: "Direction", hu: "Irány", es: "Dirección", de: "Richtung", fr: "Direction", pt: "Direção" },
  cg_target_job: { it: "Lavoro target", en: "Target job", hu: "Célmunka", es: "Empleo objetivo", de: "Zieljob", fr: "Emploi visé", pt: "Emprego-alvo" },
  cg_specializations: { it: "Specializzazioni", en: "Specializations", hu: "Szakterületek", es: "Especializaciones", de: "Spezialisierungen", fr: "Spécialisations", pt: "Especializações" },
  cg_desired_courses: { it: "Corsi desiderati", en: "Desired courses", hu: "Kívánt képzések", es: "Cursos deseados", de: "Gewünschte Kurse", fr: "Cours souhaités", pt: "Cursos desejados" },

  // ── Aspirazioni ──────────────────────────────────────────────────
  asp_short: { it: "Breve termine", en: "Short term", hu: "Rövid táv", es: "Corto plazo", de: "Kurzfristig", fr: "Court terme", pt: "Curto prazo" },
  asp_long: { it: "Lungo termine", en: "Long term", hu: "Hosszú táv", es: "Largo plazo", de: "Langfristig", fr: "Long terme", pt: "Longo prazo" },
  asp_ambitious: { it: "Aspirazioni ambiziose", en: "Ambitious aspirations", hu: "Ambiciózus törekvések", es: "Aspiraciones ambiciosas", de: "Ambitionierte Ziele", fr: "Aspirations ambitieuses", pt: "Aspirações ambiciosas" },

  // ── ProfileStats ─────────────────────────────────────────────────
  ps_completion: { it: "Completamento profilo", en: "Profile completion", hu: "Profil kitöltöttsége", es: "Completitud del perfil", de: "Profil-Vollständigkeit", fr: "Complétude du profil", pt: "Conclusão do perfil" },
  ps_recent: { it: "Ultime candidature", en: "Recent applications", hu: "Legutóbbi jelentkezések", es: "Candidaturas recientes", de: "Letzte Bewerbungen", fr: "Candidatures récentes", pt: "Candidaturas recentes" },
  ps_no_apps: { it: "Nessuna candidatura ancora", en: "No applications yet", hu: "Még nincs jelentkezés", es: "Aún no hay candidaturas", de: "Noch keine Bewerbungen", fr: "Aucune candidature pour l'instant", pt: "Ainda não há candidaturas" },
  ps_cv_preview: { it: "Anteprima CV", en: "CV Preview", hu: "Önéletrajz előnézet", es: "Vista previa del CV", de: "Lebenslauf-Vorschau", fr: "Aperçu du CV", pt: "Pré-visualização do CV" },
  ps_cv_open: { it: "Apri documento", en: "Open document", hu: "Dokumentum megnyitása", es: "Abrir documento", de: "Dokument öffnen", fr: "Ouvrir le document", pt: "Abrir documento" },
  ps_avatar_error: { it: "Errore nel caricamento", en: "Upload error", hu: "Feltöltési hiba", es: "Error de carga", de: "Upload-Fehler", fr: "Erreur de téléchargement", pt: "Erro de upload" },

  // Stati candidatura (badge)
  status_draft: { it: "Bozza", en: "Draft", hu: "Vázlat", es: "Borrador", de: "Entwurf", fr: "Brouillon", pt: "Rascunho" },
  status_sent: { it: "Inviata", en: "Sent", hu: "Elküldve", es: "Enviada", de: "Gesendet", fr: "Envoyée", pt: "Enviada" },
  status_viewed: { it: "Vista", en: "Viewed", hu: "Megtekintve", es: "Vista", de: "Angesehen", fr: "Vue", pt: "Visualizada" },
  status_interview: { it: "Colloquio", en: "Interview", hu: "Interjú", es: "Entrevista", de: "Vorstellungsgespräch", fr: "Entretien", pt: "Entrevista" },
  status_offer: { it: "Offerta", en: "Offer", hu: "Ajánlat", es: "Oferta", de: "Angebot", fr: "Offre", pt: "Oferta" },
  status_rejected: { it: "Rifiutata", en: "Rejected", hu: "Elutasítva", es: "Rechazada", de: "Abgelehnt", fr: "Refusée", pt: "Rejeitada" },

  // Campi mancanti
  mf_label: { it: "campi mancanti", en: "missing fields", hu: "hiányzó mező", es: "campos faltantes", de: "fehlende Felder", fr: "champs manquants", pt: "campos em falta" },
  go_to: { it: "Vai a", en: "Go to", hu: "Ugrás ide", es: "Ir a", de: "Gehe zu", fr: "Aller à", pt: "Ir para" },
  mf_exp_years: { it: "Anni esperienza", en: "Experience years", hu: "Tapasztalati évek", es: "Años de experiencia", de: "Erfahrungsjahre", fr: "Années d'expérience", pt: "Anos de experiência" },
  mf_desired_roles: { it: "Ruoli desiderati", en: "Desired roles", hu: "Kívánt pozíciók", es: "Roles deseados", de: "Gewünschte Rollen", fr: "Postes souhaités", pt: "Cargos desejados" },
  mf_location_prefs: { it: "Preferenze sede", en: "Location prefs", hu: "Helyszín-preferenciák", es: "Preferencias de ubicación", de: "Standort-Präferenzen", fr: "Préférences de lieu", pt: "Preferências de local" },
  mf_education: { it: "Formazione", en: "Education", hu: "Tanulmányok", es: "Formación", de: "Ausbildung", fr: "Formation", pt: "Formação" },
};

export type ProfileT = (key: keyof typeof T | string) => string;

export function getProfileT(locale: Locale): ProfileT {
  return (key) => {
    const entry = T[key as string];
    if (!entry) return key as string;
    return entry[locale] ?? entry.it;
  };
}
