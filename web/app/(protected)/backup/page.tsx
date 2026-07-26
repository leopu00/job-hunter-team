"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useLocale } from "@/lib/use-locale";
import { intlTag } from "@/lib/locale-tag";

/* ── i18n inline ─────────────────────────────────────────────────── */
const T: Record<string, Record<string, string>> = {
  subtitle: {
    it: "{n} backup · {size} totali",
    en: "{n} backups · {size} total",
    hu: "{n} biztonsági mentés · összesen {size}",
    es: "{n} copias · {size} en total",
    de: "{n} Backups · {size} gesamt",
    fr: "{n} sauvegardes · {size} au total",
    pt: "{n} backups · {size} no total",
  },
  create: {
    it: "crea backup",
    en: "create backup",
    hu: "biztonsági mentés",
    es: "crear copia",
    de: "Backup erstellen",
    fr: "créer une sauvegarde",
    pt: "criar backup",
  },
  creating: {
    it: "creazione...",
    en: "creating...",
    hu: "létrehozás...",
    es: "creando...",
    de: "wird erstellt...",
    fr: "création...",
    pt: "criando...",
  },
  restore: {
    it: "ripristina",
    en: "restore",
    hu: "visszaállítás",
    es: "restaurar",
    de: "wiederherstellen",
    fr: "restaurer",
    pt: "restaurar",
  },
  delete: {
    it: "elimina",
    en: "delete",
    hu: "törlés",
    es: "eliminar",
    de: "löschen",
    fr: "supprimer",
    pt: "excluir",
  },
  manual_backup: {
    it: "Backup manuale {date}",
    en: "Manual backup {date}",
    hu: "Kézi biztonsági mentés {date}",
    es: "Copia manual {date}",
    de: "Manuelles Backup {date}",
    fr: "Sauvegarde manuelle {date}",
    pt: "Backup manual {date}",
  },
  created_ok: {
    it: "Backup creato con successo",
    en: "Backup created successfully",
    hu: "Biztonsági mentés sikeresen létrehozva",
    es: "Copia creada con éxito",
    de: "Backup erfolgreich erstellt",
    fr: "Sauvegarde créée avec succès",
    pt: "Backup criado com sucesso",
  },
  err_create: {
    it: "Errore creazione backup",
    en: "Backup creation error",
    hu: "Hiba a biztonsági mentés létrehozásakor",
    es: "Error al crear la copia",
    de: "Fehler beim Erstellen des Backups",
    fr: "Erreur de création de la sauvegarde",
    pt: "Erro ao criar backup",
  },
  confirm_restore: {
    it: "Ripristinare il backup {id}…?",
    en: "Restore backup {id}…?",
    hu: "Visszaállítja a(z) {id}… biztonsági mentést?",
    es: "¿Restaurar la copia {id}…?",
    de: "Backup {id}… wiederherstellen?",
    fr: "Restaurer la sauvegarde {id}… ?",
    pt: "Restaurar o backup {id}…?",
  },
  restored_ok: {
    it: "Ripristinato in {dir} ({n} file)",
    en: "Restored to {dir} ({n} files)",
    hu: "Visszaállítva ide: {dir} ({n} fájl)",
    es: "Restaurado en {dir} ({n} archivos)",
    de: "Wiederhergestellt nach {dir} ({n} Dateien)",
    fr: "Restauré dans {dir} ({n} fichiers)",
    pt: "Restaurado em {dir} ({n} arquivos)",
  },
  err_restore: {
    it: "Errore ripristino",
    en: "Restore error",
    hu: "Visszaállítási hiba",
    es: "Error de restauración",
    de: "Fehler bei der Wiederherstellung",
    fr: "Erreur de restauration",
    pt: "Erro de restauração",
  },
  confirm_delete: {
    it: "Eliminare definitivamente il backup {id}…?",
    en: "Permanently delete backup {id}…?",
    hu: "Véglegesen törli a(z) {id}… biztonsági mentést?",
    es: "¿Eliminar definitivamente la copia {id}…?",
    de: "Backup {id}… endgültig löschen?",
    fr: "Supprimer définitivement la sauvegarde {id}… ?",
    pt: "Excluir permanentemente o backup {id}…?",
  },
  deleted_ok: {
    it: "Backup eliminato",
    en: "Backup deleted",
    hu: "Biztonsági mentés törölve",
    es: "Copia eliminada",
    de: "Backup gelöscht",
    fr: "Sauvegarde supprimée",
    pt: "Backup excluído",
  },
  err_delete: {
    it: "Errore eliminazione",
    en: "Deletion error",
    hu: "Törlési hiba",
    es: "Error de eliminación",
    de: "Fehler beim Löschen",
    fr: "Erreur de suppression",
    pt: "Erro de exclusão",
  },
  loading: {
    it: "Caricamento...",
    en: "Loading...",
    hu: "Betöltés...",
    es: "Cargando...",
    de: "Wird geladen...",
    fr: "Chargement...",
    pt: "Carregando...",
  },
  empty: {
    it: "Nessun backup trovato.",
    en: "No backups found.",
    hu: "Nem található biztonsági mentés.",
    es: "No se encontraron copias.",
    de: "Keine Backups gefunden.",
    fr: "Aucune sauvegarde trouvée.",
    pt: "Nenhum backup encontrado.",
  },
};

type Backup = {
  id: string;
  createdAt: number;
  sizeBytes: number;
  sources: string[];
  compressed: boolean;
  description?: string;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ts: number, locale: string): string {
  return new Date(ts).toLocaleString(intlTag(locale), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function BackupRow({
  b,
  onRestore,
  onDelete,
  tr,
  locale,
}: {
  b: Backup;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  tr: (k: string) => string;
  locale: string;
}) {
  return (
    <div className="flex items-center gap-4 px-5 py-3.5 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className="text-[12px] font-semibold text-[var(--color-bright)] font-mono">
            {b.id.slice(0, 25)}…
          </span>
          {b.compressed && (
            <span
              className="badge"
              style={{
                fontSize: 9,
                color: "var(--color-blue)",
                border: "1px solid rgba(59,130,246,0.3)",
              }}
            >
              gz
            </span>
          )}
        </div>
        <p className="text-[10px] text-[var(--color-dim)] truncate">
          {b.description || b.sources.map((s) => s.split("/").pop()).join(", ")}
        </p>
      </div>
      <span className="text-[10px] text-[var(--color-muted)] font-mono flex-shrink-0">
        {formatSize(b.sizeBytes)}
      </span>
      <span className="text-[10px] text-[var(--color-dim)] flex-shrink-0">
        {formatDate(b.createdAt, locale)}
      </span>
      <div className="flex gap-2 flex-shrink-0">
        <button
          onClick={() => onRestore(b.id)}
          className="px-3 py-1 rounded text-[10px] font-semibold tracking-wide cursor-pointer transition-colors"
          style={{
            color: "var(--color-blue)",
            border: "1px solid rgba(59,130,246,0.3)",
          }}
        >
          {tr("restore")}
        </button>
        <button
          onClick={() => onDelete(b.id)}
          className="px-3 py-1 rounded text-[10px] font-semibold tracking-wide cursor-pointer transition-colors"
          style={{
            color: "var(--color-red)",
            border: "1px solid rgba(255,69,96,0.3)",
          }}
        >
          {tr("delete")}
        </button>
      </div>
    </div>
  );
}

export default function BackupPage() {
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
  const [backups, setBackups] = useState<Backup[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchBackups = useCallback(async () => {
    const res = await fetch("/api/backup").catch(() => null);
    if (!res?.ok) {
      setLoading(false);
      return;
    }
    const data = await res.json();
    setBackups(data.backups ?? []);
    setTotalSize(data.totalSize ?? 0);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchBackups();
  }, [fetchBackups]);

  const createBackup = async () => {
    setCreating(true);
    setMsg(null);
    const res = await fetch("/api/backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: tr("manual_backup").replace(
          "{date}",
          new Date().toLocaleDateString(intlTag(locale)),
        ),
      }),
    }).catch(() => null);
    setCreating(false);
    if (res?.ok) {
      setMsg({ text: tr("created_ok"), ok: true });
      fetchBackups();
    } else {
      const err = await res?.json().catch(() => ({}));
      setMsg({ text: err?.error || tr("err_create"), ok: false });
    }
  };

  const restoreBackup = async (id: string) => {
    if (!confirm(tr("confirm_restore").replace("{id}", id.slice(0, 20))))
      return;
    const res = await fetch(`/api/backup?id=${id}`, { method: "PATCH" }).catch(
      () => null,
    );
    if (res?.ok) {
      const data = await res.json();
      setMsg({
        text: tr("restored_ok")
          .replace("{dir}", data.targetDir)
          .replace("{n}", String(data.restored?.length ?? 0)),
        ok: true,
      });
    } else {
      setMsg({ text: tr("err_restore"), ok: false });
    }
  };

  const deleteBackup = async (id: string) => {
    if (!confirm(tr("confirm_delete").replace("{id}", id.slice(0, 20)))) return;
    const res = await fetch(`/api/backup?id=${id}`, { method: "DELETE" }).catch(
      () => null,
    );
    if (res?.ok) {
      setMsg({ text: tr("deleted_ok"), ok: true });
      fetchBackups();
    } else {
      setMsg({ text: tr("err_delete"), ok: false });
    }
  };

  return (
    <div style={{ animation: "fade-in 0.35s ease both" }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link
            href="/dashboard"
            className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
          >
            Dashboard
          </Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">
            /
          </span>
          <span
            className="text-[10px] text-[var(--color-muted)]"
            aria-current="page"
          >
            Backup
          </span>
        </nav>
        <div className="mt-3 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
              Backup
            </h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">
              {tr("subtitle")
                .replace("{n}", String(backups.length))
                .replace("{size}", formatSize(totalSize))}
            </p>
          </div>
          <button
            onClick={createBackup}
            disabled={creating}
            className="px-4 py-2 rounded-lg text-[11px] font-bold tracking-wide transition-all cursor-pointer disabled:opacity-50"
            style={{ background: "var(--color-green)", color: "#000" }}
          >
            {creating ? tr("creating") : tr("create")}
          </button>
        </div>
        {msg && (
          <div
            role="alert"
            className="mt-3 px-4 py-2 rounded text-[11px] font-semibold"
            style={{
              background: msg.ok
                ? "rgba(0,200,83,0.08)"
                : "rgba(255,69,96,0.08)",
              color: msg.ok ? "var(--color-green)" : "var(--color-red)",
              border: `1px solid ${msg.ok ? "rgba(0,200,83,0.3)" : "rgba(255,69,96,0.3)"}`,
            }}
          >
            {msg.text}
          </div>
        )}
      </div>

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        {loading ? (
          <div className="py-16 text-center">
            <p className="text-[var(--color-dim)] text-[12px]">
              {tr("loading")}
            </p>
          </div>
        ) : backups.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <p className="text-[var(--color-dim)] text-[12px]">{tr("empty")}</p>
          </div>
        ) : (
          backups.map((b) => (
            <BackupRow
              key={b.id}
              b={b}
              onRestore={restoreBackup}
              onDelete={deleteBackup}
              tr={tr}
              locale={locale}
            />
          ))
        )}
      </div>
    </div>
  );
}
