"use client";

import Link from "next/link";

// Shared building blocks for /docs pages — keeps each guide short and
// consistent. One place for the type styles, the breadcrumb header, the
// green callout, code blocks, and the "read more on GitHub" footer.
//
// The docs on the site are deliberately the *essentials*: short, neutral,
// actionable. The full technical detail lives in the public repository — so
// every guide ends with a link back to the source.

export const REPO = "https://github.com/leopu00/job-hunter-team";
/** Build a link into the repo (file or folder) on the master branch. */
export const repoFile = (path: string) => `${REPO}/blob/master/${path}`;
export const repoTree = (path: string) => `${REPO}/tree/master/${path}`;

export const P_CLS =
  "text-[12px] text-[var(--color-muted)] leading-relaxed mb-3";
export const LI_CLS = "text-[12px] text-[var(--color-muted)] leading-relaxed";
export const CODE_CLS =
  "px-1.5 py-0.5 rounded bg-[var(--color-border)] text-[var(--color-white)] text-[11px] font-mono";

export function Code({ children }: { children: React.ReactNode }) {
  return <code className={CODE_CLS}>{children}</code>;
}

/** A fenced command/code block. */
export function Pre({ children }: { children: React.ReactNode }) {
  return (
    <pre className="my-4 overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4 text-[11.5px] leading-relaxed text-[var(--color-bright)] font-mono">
      <code>{children}</code>
    </pre>
  );
}

export function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[15px] font-bold text-[var(--color-white)] mt-10 mb-3 flex items-center gap-2">
      {children}
    </h2>
  );
}

export function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[13px] font-bold text-[var(--color-white)] mt-6 mb-2">
      {children}
    </h3>
  );
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className={P_CLS}>{children}</p>;
}

export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc pl-5 space-y-1.5 mb-3">{children}</ul>;
}

export function LI({ children }: { children: React.ReactNode }) {
  return <li className={LI_CLS}>{children}</li>;
}

export function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-4 pl-3 border-l-2 border-[var(--color-green)] text-[12px] text-[var(--color-muted)] leading-relaxed">
      {children}
    </div>
  );
}

/** Breadcrumb + title + tagline + optional intro paragraph(s). */
export function DocHeader({
  emoji,
  title,
  tagline,
  children,
}: {
  emoji: string;
  title: string;
  tagline?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
      <div className="flex items-center gap-2 mb-3">
        <Link
          href="/"
          className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
        >
          Home
        </Link>
        <span className="text-[var(--color-border)]">/</span>
        <Link
          href="/docs"
          className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
        >
          Docs
        </Link>
        <span className="text-[var(--color-border)]">/</span>
        <span className="text-[10px] text-[var(--color-muted)]">{title}</span>
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
        {emoji} {title}
      </h1>
      {tagline ? (
        <p className="text-[var(--color-dim)] text-[10px] mt-2">{tagline}</p>
      ) : null}
      {children ? (
        <div className="text-[var(--color-muted)] text-[12px] mt-3 leading-relaxed">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** "Go deeper in the source" footer — every guide points back to the repo. */
export function GitHubMore({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-12 pt-6 border-t border-[var(--color-border)]">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-dim)] mb-2">
        Going deeper
      </div>
      <p className="text-[12px] text-[var(--color-muted)] leading-relaxed">
        These docs are the essentials. For the full detail, the exact flags and
        the code itself, read the source:{" "}
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-[var(--color-green)] hover:opacity-80 transition-opacity no-underline"
        >
          {children} ↗
        </a>
      </p>
    </div>
  );
}
