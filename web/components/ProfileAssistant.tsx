'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useLocale } from '@/lib/use-locale'
import type { CandidateProfile } from '@/lib/types'

interface Message {
  role: 'user' | 'assistant'
  text: string
}

interface Props {
  profile: CandidateProfile | null
}

const T: Record<string, Record<string, string>> = {
  greeting: {
    it: 'Ciao! Sono il tuo assistente per il profilo. Posso aiutarti a compilare i campi mancanti o puoi caricare il tuo CV in PDF e lo analizzerò automaticamente.',
    en: 'Hi! I am your profile assistant. I can help you fill in the missing fields, or you can upload your CV as a PDF and I will analyze it automatically.',
    hu: 'Szia! Én vagyok a profil asszisztensed. Segíthetek kitölteni a hiányzó mezőket, vagy feltöltheted az önéletrajzodat PDF-ben, és automatikusan elemzem.',
    es: '¡Hola! Soy tu asistente de perfil. Puedo ayudarte a rellenar los campos que faltan, o puedes subir tu CV en PDF y lo analizaré automáticamente.',
    de: 'Hallo! Ich bin dein Profil-Assistent. Ich kann dir helfen, die fehlenden Felder auszufüllen, oder du lädst deinen Lebenslauf als PDF hoch und ich analysiere ihn automatisch.',
    fr: 'Bonjour ! Je suis votre assistant de profil. Je peux vous aider à remplir les champs manquants, ou vous pouvez téléverser votre CV en PDF et je l’analyserai automatiquement.',
    pt: 'Olá! Sou o teu assistente de perfil. Posso ajudar-te a preencher os campos em falta, ou podes carregar o teu CV em PDF e analiso-o automaticamente.',
  },
  error_prefix: {
    it: 'Errore: {x}',
    en: 'Error: {x}',
    hu: 'Hiba: {x}',
    es: 'Error: {x}',
    de: 'Fehler: {x}',
    fr: 'Erreur : {x}',
    pt: 'Erro: {x}',
  },
  server_unreachable: {
    it: 'Impossibile raggiungere il server. Verifica la connessione.',
    en: 'Could not reach the server. Check your connection.',
    hu: 'Nem sikerült elérni a kiszolgálót. Ellenőrizd a kapcsolatot.',
    es: 'No se pudo conectar con el servidor. Comprueba tu conexión.',
    de: 'Server nicht erreichbar. Überprüfe deine Verbindung.',
    fr: 'Impossible de joindre le serveur. Vérifiez votre connexion.',
    pt: 'Não foi possível contactar o servidor. Verifica a tua ligação.',
  },
  invalid_pdf: {
    it: 'Per favore carica un file PDF valido.',
    en: 'Please upload a valid PDF file.',
    hu: 'Kérlek, tölts fel egy érvényes PDF fájlt.',
    es: 'Por favor, sube un archivo PDF válido.',
    de: 'Bitte lade eine gültige PDF-Datei hoch.',
    fr: 'Veuillez téléverser un fichier PDF valide.',
    pt: 'Por favor, carrega um ficheiro PDF válido.',
  },
  file_too_large: {
    it: 'File troppo grande. Massimo 10MB.',
    en: 'File too large. Maximum 10MB.',
    hu: 'A fájl túl nagy. Legfeljebb 10 MB.',
    es: 'Archivo demasiado grande. Máximo 10 MB.',
    de: 'Datei zu groß. Maximal 10 MB.',
    fr: 'Fichier trop volumineux. Maximum 10 Mo.',
    pt: 'Ficheiro demasiado grande. Máximo 10 MB.',
  },
  analyzing: {
    it: 'Sto analizzando "{x}"...',
    en: 'Analyzing "{x}"...',
    hu: '"{x}" elemzése...',
    es: 'Analizando "{x}"...',
    de: '"{x}" wird analysiert...',
    fr: 'Analyse de « {x} »...',
    pt: 'A analisar "{x}"...',
  },
  cv_error: {
    it: "Errore nell'analisi del CV: {x}",
    en: 'Error analyzing the CV: {x}',
    hu: 'Hiba az önéletrajz elemzése közben: {x}',
    es: 'Error al analizar el CV: {x}',
    de: 'Fehler bei der Analyse des Lebenslaufs: {x}',
    fr: 'Erreur lors de l’analyse du CV : {x}',
    pt: 'Erro ao analisar o CV: {x}',
  },
  cv_extracted: {
    it: 'Ho estratto le informazioni dal CV. Controlla le modifiche proposte qui sotto e salva se sono corrette.',
    en: 'I extracted the information from the CV. Review the proposed changes below and save if they are correct.',
    hu: 'Kinyertem az adatokat az önéletrajzból. Nézd át a lenti javasolt módosításokat, és mentsd el, ha helyesek.',
    es: 'He extraído la información del CV. Revisa los cambios propuestos a continuación y guárdalos si son correctos.',
    de: 'Ich habe die Informationen aus dem Lebenslauf extrahiert. Überprüfe die unten vorgeschlagenen Änderungen und speichere sie, wenn sie korrekt sind.',
    fr: 'J’ai extrait les informations du CV. Vérifiez les modifications proposées ci-dessous et enregistrez si elles sont correctes.',
    pt: 'Extraí as informações do CV. Verifica as alterações propostas abaixo e guarda se estiverem corretas.',
  },
  cv_nothing_new: {
    it: 'Ho analizzato il CV ma non ho trovato nuove informazioni da aggiungere.',
    en: 'I analyzed the CV but found no new information to add.',
    hu: 'Elemeztem az önéletrajzot, de nem találtam új hozzáadható információt.',
    es: 'He analizado el CV pero no encontré información nueva que añadir.',
    de: 'Ich habe den Lebenslauf analysiert, aber keine neuen Informationen zum Hinzufügen gefunden.',
    fr: 'J’ai analysé le CV mais je n’ai trouvé aucune nouvelle information à ajouter.',
    pt: 'Analisei o CV mas não encontrei novas informações para adicionar.',
  },
  session_expired: {
    it: 'Sessione scaduta. Ricarica la pagina.',
    en: 'Session expired. Reload the page.',
    hu: 'A munkamenet lejárt. Töltsd újra az oldalt.',
    es: 'Sesión caducada. Recarga la página.',
    de: 'Sitzung abgelaufen. Lade die Seite neu.',
    fr: 'Session expirée. Rechargez la page.',
    pt: 'Sessão expirada. Recarrega a página.',
  },
  save_error: {
    it: 'Errore nel salvataggio: {x}',
    en: 'Error saving: {x}',
    hu: 'Hiba a mentés közben: {x}',
    es: 'Error al guardar: {x}',
    de: 'Fehler beim Speichern: {x}',
    fr: 'Erreur lors de l’enregistrement : {x}',
    pt: 'Erro ao guardar: {x}',
  },
  changes_saved: {
    it: 'Modifiche salvate. Il profilo è stato aggiornato.',
    en: 'Changes saved. Your profile has been updated.',
    hu: 'A módosítások mentve. A profil frissítve lett.',
    es: 'Cambios guardados. Tu perfil se ha actualizado.',
    de: 'Änderungen gespeichert. Dein Profil wurde aktualisiert.',
    fr: 'Modifications enregistrées. Votre profil a été mis à jour.',
    pt: 'Alterações guardadas. O teu perfil foi atualizado.',
  },
  fab_close: {
    it: 'Chiudi assistente',
    en: 'Close assistant',
    hu: 'Asszisztens bezárása',
    es: 'Cerrar asistente',
    de: 'Assistent schließen',
    fr: 'Fermer l’assistant',
    pt: 'Fechar assistente',
  },
  fab_open: {
    it: 'Apri assistente profilo',
    en: 'Open profile assistant',
    hu: 'Profil asszisztens megnyitása',
    es: 'Abrir asistente de perfil',
    de: 'Profil-Assistent öffnen',
    fr: 'Ouvrir l’assistant de profil',
    pt: 'Abrir assistente de perfil',
  },
  fab_title: {
    it: 'Assistente profilo',
    en: 'Profile assistant',
    hu: 'Profil asszisztens',
    es: 'Asistente de perfil',
    de: 'Profil-Assistent',
    fr: 'Assistant de profil',
    pt: 'Assistente de perfil',
  },
  header_title: {
    it: 'Assistente Profilo',
    en: 'Profile Assistant',
    hu: 'Profil asszisztens',
    es: 'Asistente de perfil',
    de: 'Profil-Assistent',
    fr: 'Assistant de profil',
    pt: 'Assistente de perfil',
  },
  close: {
    it: 'Chiudi',
    en: 'Close',
    hu: 'Bezárás',
    es: 'Cerrar',
    de: 'Schließen',
    fr: 'Fermer',
    pt: 'Fechar',
  },
  proposed_changes: {
    it: 'Modifiche proposte',
    en: 'Proposed changes',
    hu: 'Javasolt módosítások',
    es: 'Cambios propuestos',
    de: 'Vorgeschlagene Änderungen',
    fr: 'Modifications proposées',
    pt: 'Alterações propostas',
  },
  saving: {
    it: 'Salvataggio...',
    en: 'Saving...',
    hu: 'Mentés...',
    es: 'Guardando...',
    de: 'Wird gespeichert...',
    fr: 'Enregistrement...',
    pt: 'A guardar...',
  },
  saved: {
    it: 'Salvato!',
    en: 'Saved!',
    hu: 'Mentve!',
    es: '¡Guardado!',
    de: 'Gespeichert!',
    fr: 'Enregistré !',
    pt: 'Guardado!',
  },
  save_changes: {
    it: 'Salva modifiche',
    en: 'Save changes',
    hu: 'Módosítások mentése',
    es: 'Guardar cambios',
    de: 'Änderungen speichern',
    fr: 'Enregistrer les modifications',
    pt: 'Guardar alterações',
  },
  discard: {
    it: 'Scarta',
    en: 'Discard',
    hu: 'Elvetés',
    es: 'Descartar',
    de: 'Verwerfen',
    fr: 'Annuler',
    pt: 'Descartar',
  },
  upload_cv: {
    it: '+ Carica CV (PDF)',
    en: '+ Upload CV (PDF)',
    hu: '+ Önéletrajz feltöltése (PDF)',
    es: '+ Subir CV (PDF)',
    de: '+ Lebenslauf hochladen (PDF)',
    fr: '+ Téléverser le CV (PDF)',
    pt: '+ Carregar CV (PDF)',
  },
  placeholder_write: {
    it: 'Scrivi un messaggio...',
    en: 'Write a message...',
    hu: 'Írj egy üzenetet...',
    es: 'Escribe un mensaje...',
    de: 'Schreibe eine Nachricht...',
    fr: 'Écrivez un message...',
    pt: 'Escreve uma mensagem...',
  },
  send: {
    it: 'Invia',
    en: 'Send',
    hu: 'Küldés',
    es: 'Enviar',
    de: 'Senden',
    fr: 'Envoyer',
    pt: 'Enviar',
  },
  yes: {
    it: 'Sì',
    en: 'Yes',
    hu: 'Igen',
    es: 'Sí',
    de: 'Ja',
    fr: 'Oui',
    pt: 'Sim',
  },
  no: {
    it: 'No',
    en: 'No',
    hu: 'Nem',
    es: 'No',
    de: 'Nein',
    fr: 'Non',
    pt: 'Não',
  },
  field_name: {
    it: 'Nome',
    en: 'Name',
    hu: 'Név',
    es: 'Nombre',
    de: 'Name',
    fr: 'Nom',
    pt: 'Nome',
  },
  field_email: {
    it: 'Email',
    en: 'Email',
    hu: 'E-mail',
    es: 'Correo electrónico',
    de: 'E-Mail',
    fr: 'E-mail',
    pt: 'E-mail',
  },
  field_target_role: {
    it: 'Ruolo target',
    en: 'Target role',
    hu: 'Cél pozíció',
    es: 'Puesto objetivo',
    de: 'Zielrolle',
    fr: 'Poste cible',
    pt: 'Cargo-alvo',
  },
  field_location: {
    it: 'Location',
    en: 'Location',
    hu: 'Helyszín',
    es: 'Ubicación',
    de: 'Standort',
    fr: 'Localisation',
    pt: 'Localização',
  },
  field_experience_years: {
    it: 'Anni esperienza',
    en: 'Years of experience',
    hu: 'Tapasztalat (év)',
    es: 'Años de experiencia',
    de: 'Jahre Erfahrung',
    fr: 'Années d’expérience',
    pt: 'Anos de experiência',
  },
  field_experience_months: {
    it: 'Mesi esperienza',
    en: 'Months of experience',
    hu: 'Tapasztalat (hónap)',
    es: 'Meses de experiencia',
    de: 'Monate Erfahrung',
    fr: 'Mois d’expérience',
    pt: 'Meses de experiência',
  },
  field_has_degree: {
    it: 'Laurea',
    en: 'Degree',
    hu: 'Diploma',
    es: 'Titulación',
    de: 'Abschluss',
    fr: 'Diplôme',
    pt: 'Licenciatura',
  },
  field_skills: {
    it: 'Skills',
    en: 'Skills',
    hu: 'Készségek',
    es: 'Habilidades',
    de: 'Fähigkeiten',
    fr: 'Compétences',
    pt: 'Competências',
  },
  field_languages: {
    it: 'Lingue',
    en: 'Languages',
    hu: 'Nyelvek',
    es: 'Idiomas',
    de: 'Sprachen',
    fr: 'Langues',
    pt: 'Idiomas',
  },
  field_job_titles: {
    it: 'Ruoli target',
    en: 'Target roles',
    hu: 'Cél pozíciók',
    es: 'Puestos objetivo',
    de: 'Zielrollen',
    fr: 'Postes cibles',
    pt: 'Cargos-alvo',
  },
  field_location_preferences: {
    it: 'Location preferite',
    en: 'Preferred locations',
    hu: 'Kedvelt helyszínek',
    es: 'Ubicaciones preferidas',
    de: 'Bevorzugte Standorte',
    fr: 'Localisations préférées',
    pt: 'Localizações preferidas',
  },
  field_salary_target: {
    it: 'Salary target',
    en: 'Salary target',
    hu: 'Célfizetés',
    es: 'Salario objetivo',
    de: 'Zielgehalt',
    fr: 'Salaire cible',
    pt: 'Salário-alvo',
  },
}

const FIELD_LABEL_KEYS: Record<string, string> = {
  name: 'field_name',
  email: 'field_email',
  target_role: 'field_target_role',
  location: 'field_location',
  experience_years: 'field_experience_years',
  experience_months: 'field_experience_months',
  has_degree: 'field_has_degree',
  skills: 'field_skills',
  languages: 'field_languages',
  job_titles: 'field_job_titles',
  location_preferences: 'field_location_preferences',
  salary_target: 'field_salary_target',
}

export default function ProfileAssistant({ profile }: Props) {
  const locale = useLocale()
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return '—'
    if (typeof value === 'boolean') return value ? tr('yes') : tr('no')
    if (Array.isArray(value)) {
      if (value.length === 0) return '—'
      if (typeof value[0] === 'string') return value.join(', ')
      return JSON.stringify(value)
    }
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      text: tr('greeting'),
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [proposedChanges, setProposedChanges] = useState<Partial<CandidateProfile> | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, open])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    }
  }, [])

  const appendAssistantMessage = useCallback((text: string) =>
    setMessages(prev => [...prev, { role: 'assistant', text }]), [])

  const sendMessage = async () => {
    if (!input.trim() || loading) return
    const text = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text }])
    setLoading(true)

    try {
      const res = await fetch('/api/profile-assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, profile }),
      })
      // Leggi il JSON prima di controllare lo status: così data.error è sempre disponibile
      const data = await res.json()
      if (!res.ok || data.error) {
        appendAssistantMessage(tr('error_prefix').replace('{x}', data.error ?? `HTTP ${res.status}`))
      } else {
        if (data.reply) appendAssistantMessage(data.reply)
        if (data.proposed_changes && Object.keys(data.proposed_changes).length > 0) {
          setProposedChanges(prev => ({ ...prev, ...data.proposed_changes }))
        }
      }
    } catch {
      appendAssistantMessage(tr('server_unreachable'))
    } finally {
      setLoading(false)
    }
  }

  const uploadCV = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf') || file.type !== 'application/pdf') {
      appendAssistantMessage(tr('invalid_pdf'))
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      appendAssistantMessage(tr('file_too_large'))
      return
    }
    setLoading(true)
    appendAssistantMessage(tr('analyzing').replace('{x}', file.name))

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/profile-assistant/upload-cv', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        appendAssistantMessage(tr('cv_error').replace('{x}', data.error ?? `HTTP ${res.status}`))
      } else if (data.proposed_changes && Object.keys(data.proposed_changes).length > 0) {
        setProposedChanges(prev => ({ ...prev, ...data.proposed_changes }))
        appendAssistantMessage(tr('cv_extracted'))
      } else {
        appendAssistantMessage(tr('cv_nothing_new'))
      }
    } catch {
      appendAssistantMessage(tr('server_unreachable'))
    } finally {
      setLoading(false)
    }
  }

  const saveChanges = async () => {
    if (!proposedChanges) return
    setSaving(true)
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setSaving(false)
      appendAssistantMessage(tr('session_expired'))
      return
    }

    const { error } = await supabase
      .from('candidate_profiles')
      .upsert(
        { user_id: user.id, ...proposedChanges, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      )

    setSaving(false)
    if (error) {
      appendAssistantMessage(tr('save_error').replace('{x}', error.message))
    } else {
      setSaveSuccess(true)
      setProposedChanges(null)
      appendAssistantMessage(tr('changes_saved'))
      saveTimeoutRef.current = setTimeout(() => {
        setSaveSuccess(false)
        window.location.reload()
      }, 1500)
    }
  }

  const filteredChanges = proposedChanges
    ? Object.entries(proposedChanges).filter(
        ([k]) => !['user_id', 'id', 'created_at', 'updated_at'].includes(k)
      )
    : []

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(v => !v)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-[var(--color-green)] text-[var(--color-void)] flex items-center justify-center shadow-lg hover:opacity-90 transition-all z-50 cursor-pointer border-0"
        aria-label={open ? tr('fab_close') : tr('fab_open')}
        title={tr('fab_title')}
      >
        {open ? (
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-24 right-6 w-96 max-h-[600px] bg-[var(--color-deep)] border border-[var(--color-border)] rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden"
          style={{ animation: 'fade-in 0.2s ease both' }}
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[var(--color-green)]" />
              <span className="text-[11px] font-bold tracking-widest uppercase text-[var(--color-white)]">
                {tr('header_title')}
              </span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-[var(--color-dim)] hover:text-[var(--color-muted)] transition-colors cursor-pointer bg-transparent border-0 p-0 flex items-center"
              aria-label={tr('close')}
            >
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] px-3 py-2 rounded-lg text-[12px] leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-[var(--color-green)]/15 text-[var(--color-bright)] border border-[var(--color-green)]/20'
                      : 'bg-[var(--color-card)] text-[var(--color-base)] border border-[var(--color-border)]'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="px-3 py-2 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg">
                  <span className="text-[11px] text-[var(--color-dim)] animate-pulse">···</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Proposed changes preview */}
          {filteredChanges.length > 0 && (
            <div className="border-t border-[var(--color-border)] flex-shrink-0">
              <div className="px-4 py-3 bg-[var(--color-green)]/5">
                <div className="text-[9px] font-bold tracking-widest uppercase text-[var(--color-green)] mb-2">
                  {tr('proposed_changes')}
                </div>
                <div className="max-h-36 overflow-y-auto space-y-0">
                  {filteredChanges.map(([key, value]) => (
                    <div
                      key={key}
                      className="flex items-start gap-2 py-1.5 border-b border-[var(--color-border)] last:border-0"
                    >
                      <span className="text-[9px] font-bold tracking-widest uppercase text-[var(--color-dim)] pt-0.5 w-24 flex-shrink-0">
                        {FIELD_LABEL_KEYS[key] ? tr(FIELD_LABEL_KEYS[key]) : key}
                      </span>
                      <span className="text-[11px] text-[var(--color-bright)] break-words">
                        {formatValue(value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="px-4 py-3 border-t border-[var(--color-border)] flex gap-2">
                <button
                  onClick={saveChanges}
                  disabled={saving || saveSuccess}
                  className="flex-1 py-2 bg-[var(--color-green)] text-[var(--color-void)] text-[10px] font-bold tracking-widest uppercase rounded hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer border-0"
                >
                  {saving ? tr('saving') : saveSuccess ? tr('saved') : tr('save_changes')}
                </button>
                <button
                  onClick={() => {
                    setProposedChanges(null)
                    setSaveSuccess(false)
                  }}
                  className="px-3 py-2 border border-[var(--color-border)] text-[10px] text-[var(--color-muted)] rounded hover:border-[var(--color-red)] hover:text-[var(--color-red)] transition-colors cursor-pointer bg-transparent"
                >
                  {tr('discard')}
                </button>
              </div>
            </div>
          )}

          {/* Upload CV */}
          <div className="border-t border-[var(--color-border)] px-4 py-2 flex-shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) uploadCV(file)
                e.target.value = ''
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className="w-full py-1.5 border border-dashed border-[var(--color-border)] text-[10px] text-[var(--color-dim)] rounded hover:border-[var(--color-muted)] hover:text-[var(--color-muted)] transition-colors disabled:opacity-40 cursor-pointer bg-transparent"
            >
              {tr('upload_cv')}
            </button>
          </div>

          {/* Input */}
          <div className="border-t border-[var(--color-border)] px-4 py-3 flex gap-2 flex-shrink-0">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage()
                }
              }}
              placeholder={tr('placeholder_write')}
              disabled={loading}
              className="flex-1 bg-[var(--color-panel)] border border-[var(--color-border)] rounded px-3 py-1.5 text-[12px] text-[var(--color-bright)] placeholder:text-[var(--color-dim)] focus:outline-none focus:border-[var(--color-green)] transition-colors disabled:opacity-50"
            />
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              className="px-3 py-1.5 bg-[var(--color-green)] text-[var(--color-void)] rounded hover:opacity-90 transition-opacity disabled:opacity-40 cursor-pointer border-0 flex items-center"
              aria-label={tr('send')}
            >
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  )
}
