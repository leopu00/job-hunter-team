"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useLocale } from "@/lib/use-locale";

const T: Record<string, Record<string, string>> = {
  placeholder: {
    it: "Scrivi note… Supporta **grassetto**, *corsivo*, `codice`, # titoli, - liste",
    en: "Write notes… Supports **bold**, *italic*, `code`, # headings, - lists",
    hu: "Írj jegyzeteket… Támogatja a **félkövér**, *dőlt*, `kód`, # címsorok, - listák formázást",
    es: "Escribe notas… Admite **negrita**, *cursiva*, `código`, # títulos, - listas",
    de: "Notizen schreiben… Unterstützt **fett**, *kursiv*, `Code`, # Überschriften, - Listen",
    fr: "Écris des notes… Prend en charge **gras**, *italique*, `code`, # titres, - listes",
    pt: "Escreva notas… Suporta **negrito**, *itálico*, `código`, # títulos, - listas",
  },
  edit: {
    it: "Modifica",
    en: "Edit",
    hu: "Szerkesztés",
    es: "Editar",
    de: "Bearbeiten",
    fr: "Modifier",
    pt: "Editar",
  },
  preview: {
    it: "Preview",
    en: "Preview",
    hu: "Előnézet",
    es: "Vista previa",
    de: "Vorschau",
    fr: "Aperçu",
    pt: "Pré-visualização",
  },
  words_chars: {
    it: "{w}p · {c}c",
    en: "{w}w · {c}c",
    hu: "{w}sz · {c}k",
    es: "{w}p · {c}c",
    de: "{w}W · {c}Z",
    fr: "{w}m · {c}c",
    pt: "{w}p · {c}c",
  },
  saving: {
    it: "● salvataggio…",
    en: "● saving…",
    hu: "● mentés…",
    es: "● guardando…",
    de: "● Speichern…",
    fr: "● enregistrement…",
    pt: "● a guardar…",
  },
  modified: {
    it: "● modificato",
    en: "● modified",
    hu: "● módosítva",
    es: "● modificado",
    de: "● geändert",
    fr: "● modifié",
    pt: "● modificado",
  },
  no_note: {
    it: "Nessuna nota",
    en: "No note",
    hu: "Nincs jegyzet",
    es: "Sin notas",
    de: "Keine Notiz",
    fr: "Aucune note",
    pt: "Sem nota",
  },
};

// ── Markdown renderer (no deps) ────────────────────────────────────────────
// Escape HTML first, then apply markdown — sicuro da XSS

function renderMd(raw: string): string {
  let s = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Headings
  s = s.replace(
    /^### (.+)$/gm,
    '<b style="font-size:10px;color:var(--color-bright)">$1</b>',
  );
  s = s.replace(
    /^## (.+)$/gm,
    '<b style="font-size:11px;color:var(--color-bright)">$1</b>',
  );
  s = s.replace(
    /^# (.+)$/gm,
    '<b style="font-size:12px;color:var(--color-bright)">$1</b>',
  );
  // Bold / italic / code
  s = s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
  s = s.replace(
    /`(.+?)`/g,
    '<code style="font-family:monospace;font-size:10px;padding:0 3px;border-radius:3px;background:var(--color-border)">$1</code>',
  );
  // Lists
  s = s.replace(/^[-*] (.+)$/gm, "&bull; $1");
  // Newlines
  s = s.replace(/\n/g, "<br/>");
  return s;
}

// ── Timestamp fmt ──────────────────────────────────────────────────────────

function fmtTs(d: Date): string {
  return d.toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── NotesEditor ────────────────────────────────────────────────────────────

type NotesEditorProps = {
  initialValue?: string;
  onSave?: (text: string) => Promise<void> | void;
  placeholder?: string;
  label?: string;
  debounceMs?: number;
  className?: string;
};

export function NotesEditor({
  initialValue = "",
  onSave,
  placeholder,
  label,
  debounceMs = 1500,
  className,
}: NotesEditorProps) {
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
  const ph = placeholder ?? tr("placeholder");
  const [text, setText] = useState(initialValue);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(
    async (val: string) => {
      if (!onSave) {
        setLastSaved(new Date());
        setDirty(false);
        return;
      }
      setSaving(true);
      try {
        await onSave(val);
        setLastSaved(new Date());
        setDirty(false);
      } finally {
        setSaving(false);
      }
    },
    [onSave],
  );

  // Autosave con debounce
  useEffect(() => {
    if (!dirty) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => save(text), debounceMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [text, dirty, debounceMs, save]);

  const handleChange = (val: string) => {
    setText(val);
    setDirty(true);
  };

  const chars = text.length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div
      className={`flex flex-col rounded-xl overflow-hidden ${className ?? ""}`}
      style={{
        border: "1px solid var(--color-border)",
        background: "var(--color-panel)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center gap-2">
          {label && (
            <span
              className="text-[10px] font-bold uppercase tracking-widest"
              style={{ color: "var(--color-dim)" }}
            >
              {label}
            </span>
          )}
          {/* Tab switcher */}
          <div
            role="tablist"
            className="flex rounded overflow-hidden"
            style={{ border: "1px solid var(--color-border)" }}
          >
            {(["edit", "preview"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className="px-2 py-0.5 text-[9px] font-semibold uppercase transition-colors"
                style={{
                  background: tab === t ? "var(--color-border)" : "transparent",
                  color: tab === t ? "var(--color-bright)" : "var(--color-dim)",
                }}
              >
                {t === "edit" ? tr("edit") : tr("preview")}
              </button>
            ))}
          </div>
        </div>

        {/* Status */}
        <div className="flex items-center gap-2">
          <span
            className="text-[9px] font-mono"
            style={{ color: "var(--color-dim)" }}
          >
            {tr("words_chars")
              .replace("{w}", String(words))
              .replace("{c}", String(chars))}
          </span>
          <span
            className="text-[9px]"
            style={{
              color: saving
                ? "var(--color-yellow)"
                : dirty
                  ? "var(--color-muted)"
                  : "var(--color-green)",
            }}
          >
            {saving
              ? tr("saving")
              : dirty
                ? tr("modified")
                : lastSaved
                  ? `✓ ${fmtTs(lastSaved)}`
                  : ""}
          </span>
        </div>
      </div>

      {/* Edit */}
      {tab === "edit" && (
        <textarea
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={ph}
          rows={8}
          className="w-full resize-y bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-green)] p-3 text-[11px] font-mono leading-relaxed"
          style={{ color: "var(--color-muted)", minHeight: 120 }}
          spellCheck={false}
        />
      )}

      {/* Preview */}
      {tab === "preview" && (
        <div
          className="p-3 text-[11px] leading-relaxed min-h-[120px]"
          style={{ color: "var(--color-muted)" }}
        >
          {text ? (
            <div dangerouslySetInnerHTML={{ __html: renderMd(text) }} />
          ) : (
            <span style={{ color: "var(--color-dim)" }}>{tr("no_note")}</span>
          )}
        </div>
      )}
    </div>
  );
}
