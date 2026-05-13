import Link from "next/link";

interface VpsSetupCompleteLandingProps {
  userEmail: string | null;
}

export default function VpsSetupCompleteLanding({
  userEmail,
}: VpsSetupCompleteLandingProps) {
  return (
    <div
      className="min-h-[calc(100vh-14rem)] flex items-center justify-center px-5"
      style={{ animation: "fade-in 0.4s ease both" }}
    >
      <div className="max-w-xl w-full text-center">
        <div
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6"
          style={{
            background: "var(--color-card)",
            border: "1px solid var(--color-green)",
          }}
        >
          <span className="text-[11px] font-bold text-[var(--color-green)] leading-none">
            ✓
          </span>
          <span className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-green)]">
            VPS attiva
          </span>
          {userEmail && (
            <span className="text-[10px] text-[var(--color-dim)] truncate max-w-[220px]">
              · {userEmail}
            </span>
          )}
        </div>

        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-[var(--color-white)] mb-4 leading-[1.1]">
          Setup completato — ottimo lavoro
        </h1>

        <p className="text-[13px] text-[var(--color-bright)] leading-relaxed mb-2 max-w-md mx-auto">
          Il tuo team AI è installato e in attesa sulla VPS. Resta un{" "}
          <span className="text-[var(--color-green)] font-medium">
            ultimo passo
          </span>
          : configurare il profilo perché gli agenti sappiano chi sei e cosa
          stai cercando.
        </p>
        <p className="text-[11px] text-[var(--color-muted)] leading-relaxed mb-8 max-w-md mx-auto">
          Puoi farlo qui dal web, oppure conversando con l&apos;Assistente —
          appena il profilo è pronto, il team inizia a cercare lavoro per te.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-10">
          <Link
            href="/profile/edit"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-[12px] font-bold tracking-wide no-underline transition-all hover:opacity-90"
            style={{ background: "var(--color-green)", color: "#000" }}
          >
            Configura il profilo
          </Link>
          <Link
            href="/team/assistente"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-[12px] font-bold tracking-wide no-underline transition-colors"
            style={{
              background: "var(--color-card)",
              color: "var(--color-bright)",
              border: "1px solid var(--color-border)",
            }}
          >
            Apri Assistente
          </Link>
        </div>

        <p className="text-[10px] text-[var(--color-dim)] leading-relaxed max-w-md mx-auto">
          Se nel wizard hai collegato Telegram, l&apos;Assistente ti scriverà
          direttamente sul bot — basta rispondere ai suoi messaggi per
          completare il profilo.
        </p>
      </div>
    </div>
  );
}
