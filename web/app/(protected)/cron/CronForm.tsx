"use client";

import { useState } from "react";
import { useLocale } from "@/lib/use-locale";
import type { CronJobCreateInput, ScheduleKind } from "./types";

interface Props {
  onCreated: () => void;
  onCancel: () => void;
}

const inputCls =
  "w-full px-3 py-2 rounded text-[12px] font-mono bg-[var(--color-card)] border border-[var(--color-border)] outline-none focus:border-[var(--color-green)] transition-colors";

/* ── i18n inline ─────────────────────────────────────────────────── */
const T: Record<string, Record<string, string>> = {
  kind_cron: {
    it: "Cron",
    en: "Cron",
    hu: "Cron",
    es: "Cron",
    de: "Cron",
    fr: "Cron",
    pt: "Cron",
  },
  kind_every: {
    it: "Intervallo",
    en: "Interval",
    hu: "Időköz",
    es: "Intervalo",
    de: "Intervall",
    fr: "Intervalle",
    pt: "Intervalo",
  },
  kind_at: {
    it: "Una volta",
    en: "Once",
    hu: "Egyszer",
    es: "Una vez",
    de: "Einmalig",
    fr: "Une fois",
    pt: "Uma vez",
  },
  err_name_required: {
    it: "Nome obbligatorio",
    en: "Name required",
    hu: "A név kötelező",
    es: "Nombre obligatorio",
    de: "Name erforderlich",
    fr: "Nom obligatoire",
    pt: "Nome obrigatório",
  },
  err_command_required: {
    it: "Comando obbligatorio",
    en: "Command required",
    hu: "A parancs kötelező",
    es: "Comando obligatorio",
    de: "Befehl erforderlich",
    fr: "Commande obligatoire",
    pt: "Comando obrigatório",
  },
  err_command_invalid: {
    it: "Comando contiene caratteri non validi",
    en: "Command contains invalid characters",
    hu: "A parancs érvénytelen karaktereket tartalmaz",
    es: "El comando contiene caracteres no válidos",
    de: "Befehl enthält ungültige Zeichen",
    fr: "La commande contient des caractères non valides",
    pt: "O comando contém caracteres inválidos",
  },
  err_cron_required: {
    it: "Espressione cron obbligatoria",
    en: "Cron expression required",
    hu: "A cron kifejezés kötelező",
    es: "Expresión cron obligatoria",
    de: "Cron-Ausdruck erforderlich",
    fr: "Expression cron obligatoire",
    pt: "Expressão cron obrigatória",
  },
  err_interval_invalid: {
    it: "Intervallo non valido",
    en: "Invalid interval",
    hu: "Érvénytelen időköz",
    es: "Intervalo no válido",
    de: "Ungültiges Intervall",
    fr: "Intervalle non valide",
    pt: "Intervalo inválido",
  },
  err_datetime_required: {
    it: "Data/ora obbligatoria",
    en: "Date/time required",
    hu: "A dátum/idő kötelező",
    es: "Fecha/hora obligatoria",
    de: "Datum/Uhrzeit erforderlich",
    fr: "Date/heure obligatoire",
    pt: "Data/hora obrigatória",
  },
  err_create: {
    it: "Errore creazione",
    en: "Creation error",
    hu: "Létrehozási hiba",
    es: "Error al crear",
    de: "Fehler beim Erstellen",
    fr: "Erreur de création",
    pt: "Erro ao criar",
  },
  err_network: {
    it: "Errore di rete",
    en: "Network error",
    hu: "Hálózati hiba",
    es: "Error de red",
    de: "Netzwerkfehler",
    fr: "Erreur réseau",
    pt: "Erro de rede",
  },
  label_name: {
    it: "Nome",
    en: "Name",
    hu: "Név",
    es: "Nombre",
    de: "Name",
    fr: "Nom",
    pt: "Nome",
  },
  label_desc: {
    it: "Descrizione (opzionale)",
    en: "Description (optional)",
    hu: "Leírás (opcionális)",
    es: "Descripción (opcional)",
    de: "Beschreibung (optional)",
    fr: "Description (facultatif)",
    pt: "Descrição (opcional)",
  },
  ph_desc: {
    it: "Cerca nuove offerte ogni mattina",
    en: "Search for new offers every morning",
    hu: "Új ajánlatok keresése minden reggel",
    es: "Buscar nuevas ofertas cada mañana",
    de: "Jeden Morgen nach neuen Angeboten suchen",
    fr: "Rechercher de nouvelles offres chaque matin",
    pt: "Procurar novas ofertas todas as manhãs",
  },
  label_command: {
    it: "Comando",
    en: "Command",
    hu: "Parancs",
    es: "Comando",
    de: "Befehl",
    fr: "Commande",
    pt: "Comando",
  },
  label_frequency: {
    it: "Frequenza",
    en: "Frequency",
    hu: "Gyakoriság",
    es: "Frecuencia",
    de: "Häufigkeit",
    fr: "Fréquence",
    pt: "Frequência",
  },
  aria_cron: {
    it: "Espressione cron",
    en: "Cron expression",
    hu: "Cron kifejezés",
    es: "Expresión cron",
    de: "Cron-Ausdruck",
    fr: "Expression cron",
    pt: "Expressão cron",
  },
  aria_interval: {
    it: "Intervallo in minuti",
    en: "Interval in minutes",
    hu: "Időköz percben",
    es: "Intervalo en minutos",
    de: "Intervall in Minuten",
    fr: "Intervalle en minutes",
    pt: "Intervalo em minutos",
  },
  aria_datetime: {
    it: "Data e ora esecuzione",
    en: "Execution date and time",
    hu: "Végrehajtás dátuma és ideje",
    es: "Fecha y hora de ejecución",
    de: "Ausführungsdatum und -uhrzeit",
    fr: "Date et heure d'exécution",
    pt: "Data e hora de execução",
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
  creating: {
    it: "Creazione…",
    en: "Creating…",
    hu: "Létrehozás…",
    es: "Creando…",
    de: "Wird erstellt…",
    fr: "Création…",
    pt: "A criar…",
  },
  create_job: {
    it: "Crea job",
    en: "Create job",
    hu: "Feladat létrehozása",
    es: "Crear tarea",
    de: "Job erstellen",
    fr: "Créer la tâche",
    pt: "Criar tarefa",
  },
};

export function CronForm({ onCreated, onCancel }: Props) {
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;

  const SCHEDULE_KINDS: { value: ScheduleKind; label: string }[] = [
    { value: "cron", label: tr("kind_cron") },
    { value: "every", label: tr("kind_every") },
    { value: "at", label: tr("kind_at") },
  ];
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [command, setCommand] = useState("");
  const [kind, setKind] = useState<ScheduleKind>("cron");
  const [cronExpr, setCronExpr] = useState("0 9 * * 1-5");
  const [everyMin, setEveryMin] = useState("30");
  const [atWhen, setAtWhen] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const buildSchedule = () => {
    if (kind === "cron")
      return { kind: "cron" as const, expr: cronExpr.trim() };
    if (kind === "every")
      return { kind: "every" as const, everyMs: Number(everyMin) * 60_000 };
    return { kind: "at" as const, at: atWhen.trim() };
  };

  const validate = (): string | undefined => {
    if (!name.trim()) return tr("err_name_required");
    if (!command.trim()) return tr("err_command_required");
    if (/[\n\r\0]/.test(command)) return tr("err_command_invalid");
    if (kind === "cron" && !cronExpr.trim()) return tr("err_cron_required");
    if (kind === "every" && (isNaN(Number(everyMin)) || Number(everyMin) < 1))
      return tr("err_interval_invalid");
    if (kind === "at" && !atWhen.trim()) return tr("err_datetime_required");
    return undefined;
  };

  const submit = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setSaving(true);
    setError(undefined);

    const body: CronJobCreateInput = {
      name: name.trim(),
      description: desc.trim() || undefined,
      enabled: true,
      schedule: buildSchedule(),
      payload: { kind: "command", command: command.trim() },
    };

    try {
      const res = await fetch("/api/cron", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? tr("err_create"));
        setSaving(false);
        return;
      }
      onCreated();
    } catch {
      setError(tr("err_network"));
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      {/* Nome */}
      <div className="flex flex-col gap-1">
        <label
          className="text-[10px] font-semibold tracking-widest uppercase"
          style={{ color: "var(--color-muted)" }}
        >
          {tr("label_name")}
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="scout-linkedin"
          className={inputCls}
          style={{ color: "var(--color-bright)" }}
        />
      </div>
      {/* Descrizione */}
      <div className="flex flex-col gap-1">
        <label
          className="text-[10px] font-semibold tracking-widest uppercase"
          style={{ color: "var(--color-muted)" }}
        >
          {tr("label_desc")}
        </label>
        <input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder={tr("ph_desc")}
          className={inputCls}
          style={{ color: "var(--color-bright)" }}
        />
      </div>
      {/* Comando */}
      <div className="flex flex-col gap-1">
        <label
          className="text-[10px] font-semibold tracking-widest uppercase"
          style={{ color: "var(--color-muted)" }}
        >
          {tr("label_command")}
        </label>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="jht scout run"
          className={inputCls}
          style={{ color: "var(--color-bright)" }}
        />
      </div>
      {/* Schedule kind */}
      <div className="flex flex-col gap-2">
        <label
          className="text-[10px] font-semibold tracking-widest uppercase"
          style={{ color: "var(--color-muted)" }}
        >
          {tr("label_frequency")}
        </label>
        <div className="flex gap-2">
          {SCHEDULE_KINDS.map((k) => (
            <button
              key={k.value}
              onClick={() => setKind(k.value)}
              className="flex-1 py-1.5 rounded text-[10px] font-semibold tracking-wide cursor-pointer transition-all"
              style={
                kind === k.value
                  ? { background: "var(--color-green)", color: "#000" }
                  : {
                      background: "var(--color-card)",
                      color: "var(--color-muted)",
                      border: "1px solid var(--color-border)",
                    }
              }
            >
              {k.label}
            </button>
          ))}
        </div>
        {kind === "cron" && (
          <input
            value={cronExpr}
            onChange={(e) => setCronExpr(e.target.value)}
            placeholder="0 9 * * 1-5"
            aria-label={tr("aria_cron")}
            className={inputCls}
            style={{ color: "var(--color-bright)" }}
          />
        )}
        {kind === "every" && (
          <input
            value={everyMin}
            onChange={(e) => setEveryMin(e.target.value)}
            type="number"
            min="1"
            placeholder="30"
            aria-label={tr("aria_interval")}
            className={inputCls}
            style={{ color: "var(--color-bright)" }}
          />
        )}
        {kind === "at" && (
          <input
            value={atWhen}
            onChange={(e) => setAtWhen(e.target.value)}
            placeholder="2026-04-10 09:00"
            aria-label={tr("aria_datetime")}
            className={inputCls}
            style={{ color: "var(--color-bright)" }}
          />
        )}
      </div>
      {error && (
        <p className="text-[11px]" style={{ color: "var(--color-red)" }}>
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button
          onClick={onCancel}
          className="flex-1 py-2.5 rounded text-[12px] font-semibold cursor-pointer"
          style={{
            border: "1px solid var(--color-border)",
            color: "var(--color-muted)",
            background: "transparent",
          }}
        >
          {tr("cancel")}
        </button>
        <button
          onClick={submit}
          disabled={saving}
          className="flex-1 py-2.5 rounded text-[12px] font-bold cursor-pointer transition-all"
          style={
            saving
              ? { background: "var(--color-border)", color: "var(--color-dim)" }
              : { background: "var(--color-green)", color: "#000" }
          }
        >
          {saving ? tr("creating") : tr("create_job")}
        </button>
      </div>
    </div>
  );
}
