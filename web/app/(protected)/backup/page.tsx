"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useLocale } from "@/lib/use-locale";
import { intlTag } from "@/lib/locale-tag";
import { makeT } from "@/lib/i18n-dict";
import { T } from "./page.i18n";
import { attemptWrite, writeFailureReason } from "@/lib/write-failure";

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
  const tr = makeT(T, locale);
  // What did NOT happen, and why: the route's reason, or a server error when
  // a 2xx did not carry the answer of the write.
  const notDone = (
    key: "err_create" | "err_restore" | "err_delete",
    result: Awaited<ReturnType<typeof attemptWrite>>,
  ) =>
    `${tr(key)} ${result.ok ? writeFailureReason(locale, 500) : result.reason}`;
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
    const result = await attemptWrite(locale, "/api/backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: tr("manual_backup").replace(
          "{date}",
          new Date().toLocaleDateString(intlTag(locale)),
        ),
      }),
    });
    setCreating(false);
    // Done only with the route's answer (it names the new backup).
    if (result.ok && result.body.backup) {
      setMsg({ text: tr("created_ok"), ok: true });
      fetchBackups();
    } else {
      setMsg({ text: notDone("err_create", result), ok: false });
    }
  };

  const restoreBackup = async (id: string) => {
    if (!confirm(tr("confirm_restore").replace("{id}", id.slice(0, 20))))
      return;
    const result = await attemptWrite(locale, `/api/backup?id=${id}`, {
      method: "PATCH",
    });
    if (result.ok && Array.isArray(result.body.restored)) {
      const data = result.body as { targetDir?: string; restored?: unknown[] };
      setMsg({
        text: tr("restored_ok")
          .replace("{dir}", data.targetDir ?? "")
          .replace("{n}", String(data.restored?.length ?? 0)),
        ok: true,
      });
    } else {
      setMsg({ text: notDone("err_restore", result), ok: false });
    }
  };

  const deleteBackup = async (id: string) => {
    if (!confirm(tr("confirm_delete").replace("{id}", id.slice(0, 20)))) return;
    const result = await attemptWrite(locale, `/api/backup?id=${id}`, {
      method: "DELETE",
    });
    if (result.ok && result.body.deleted === id) {
      setMsg({ text: tr("deleted_ok"), ok: true });
      fetchBackups();
    } else {
      setMsg({ text: notDone("err_delete", result), ok: false });
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
