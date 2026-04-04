'use client'

import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode; fallback?: ReactNode }
type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[JHT] ErrorBoundary:', error)
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    if (this.props.fallback) return this.props.fallback

    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p
          className="text-[9px] font-semibold tracking-[0.2em] uppercase"
          style={{ color: 'var(--color-red)' }}
        >
          errore componente
        </p>
        <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
          {error.message || 'Errore imprevisto.'}
        </p>
        <button
          onClick={this.reset}
          className="px-4 py-1.5 rounded text-[11px] font-semibold cursor-pointer"
          style={{ background: 'var(--color-green)', color: 'var(--color-bg)' }}
        >
          Riprova
        </button>
      </div>
    )
  }
}

export default ErrorBoundary
