import type { ExistingTeamProfileText } from "./existing-team-profile.i18n";

export function ProfileReadHeader({ t, time, busy, read, reason }: {
  t: ExistingTeamProfileText; time: string | null; busy: boolean; read: () => void; reason: string;
}) {
  return <>
    <div className="flex items-center justify-between gap-4 mb-2">
      <p data-testid="profile-time" className="text-[11px]" style={{ color: "var(--color-muted)" }}>{time}</p>
      <button type="button" onClick={read} disabled={busy}
        className="text-[11px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)] disabled:opacity-60 disabled:cursor-wait">
        {busy ? t.refreshing : t.refresh}
      </button>
    </div>
    <p className="text-[12px] mb-3 px-3 py-2 rounded border border-[var(--color-border)]" style={{ color: "var(--color-muted)" }}>
      <span data-testid="profile-edit-reason">{reason}</span>{" "}
      <span data-testid="profile-limits">{t.limits}</span>
    </p>
  </>;
}
