import { Component, type ReactNode } from "react";
import { appLocale } from "../lib/app-locale";
import { PAGE_ERROR_TEXT } from "./page-error.i18n";

interface Props {
  children: ReactNode;
  /** The way back: the dashboard. */
  onHome: () => void;
}

/**
 * Around the page the shell draws: a page that breaks while it renders (a reply that is not what it expects, a
 * missing field) would otherwise take the whole window with it, navbar included, leaving it blank. Here the page
 * alone is replaced by a sentence and two ways out; the navbar and every other page stay as they were. The shell
 * keys it by the page's path, so going to another page starts it clean.
 */
export default class PageErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // the console only: what a page failed on may hold the person's data, so nothing leaves the window
    console.error("[page] render failed:", error instanceof Error ? error.name : "unknown");
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const t = PAGE_ERROR_TEXT[appLocale()];
    return (
      <div role="alert" data-testid="page-error" className="mx-auto flex max-w-md flex-col gap-3 px-4 py-10">
        <h2 className="text-[14px] font-semibold text-[var(--color-bright)]">{t.title}</h2>
        <p className="text-[12px] text-[var(--color-muted)]">{t.body}</p>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="page-error-retry"
            onClick={() => this.setState({ failed: false })}
            className="text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-bright)]"
          >
            {t.retry}
          </button>
          <button
            type="button"
            data-testid="page-error-home"
            onClick={this.props.onHome}
            className="text-[10px] font-semibold tracking-widest uppercase px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)]"
          >
            {t.home}
          </button>
        </div>
      </div>
    );
  }
}
