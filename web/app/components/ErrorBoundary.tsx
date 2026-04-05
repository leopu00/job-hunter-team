'use client'

import React, { Component, useState, useCallback } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export interface FallbackProps {
  error:    Error
  reset:    () => void
}

export interface ErrorBoundaryProps {
  children:    React.ReactNode
  fallback?:   React.ComponentType<FallbackProps>
  onError?:    (error: Error, info: React.ErrorInfo) => void
  resetKeys?:  unknown[]    // auto-reset when any key changes
}

interface State {
  error:     Error | null
  prevKeys:  unknown[]
}

// ── Default fallback UI ────────────────────────────────────────────────────

export function DefaultFallback({ error, reset }: FallbackProps) {
  const [detail, setDetail] = useState(false)
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-4 p-8 text-center rounded-lg"
      style={{ background: 'color-mix(in srgb, var(--color-red) 8%, var(--color-panel))', border: '1px solid color-mix(in srgb, var(--color-red) 20%, transparent)' }}>

      {/* Icon */}
      <div className="w-12 h-12 rounded-full flex items-center justify-center"
        style={{ background: 'color-mix(in srgb, var(--color-red) 15%, transparent)' }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          style={{ color: 'var(--color-red)' }}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>

      {/* Message */}
      <div className="flex flex-col gap-1">
        <p className="text-[13px] font-bold" style={{ color: 'var(--color-bright)' }}>Qualcosa è andato storto</p>
        <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{error.message || 'Errore imprevisto durante il rendering.'}</p>
      </div>

      {/* Detail toggle */}
      {error.stack && (
        <button onClick={() => setDetail(v => !v)}
          className="text-[9px] cursor-pointer bg-transparent border-0 p-0 underline"
          style={{ color: 'var(--color-dim)' }}>
          {detail ? 'Nascondi dettagli' : 'Mostra stack trace'}
        </button>
      )}
      {detail && (
        <pre className="w-full text-left text-[9px] leading-relaxed p-3 rounded overflow-auto max-h-32"
          style={{ background: 'var(--color-deep)', color: 'var(--color-dim)', fontFamily: 'var(--font-mono)' }}>
          {error.stack}
        </pre>
      )}

      {/* Reset button */}
      <button onClick={reset}
        className="px-4 py-2 rounded text-[11px] font-bold cursor-pointer transition-opacity hover:opacity-80"
        style={{ background: 'var(--color-red)', color: '#fff', border: 'none' }}>
        Riprova
      </button>
    </div>
  )
}

// ── ErrorBoundary class ────────────────────────────────────────────────────

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { error: null, prevKeys: props.resetKeys ?? [] }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: State): Partial<State> | null {
    const keys = props.resetKeys ?? []
    if (state.error && keys.some((k, i) => k !== state.prevKeys[i])) {
      return { error: null, prevKeys: keys }
    }
    if (keys !== state.prevKeys) return { prevKeys: keys }
    return null
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.props.onError?.(error, info)
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    const { children, fallback: Fallback } = this.props

    if (error) {
      const props: FallbackProps = { error, reset: this.reset }
      return Fallback ? <Fallback {...props} /> : <DefaultFallback {...props} />
    }

    return children
  }
}

// ── withErrorBoundary HOC ──────────────────────────────────────────────────

export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  boundaryProps?: Omit<ErrorBoundaryProps, 'children'>
) {
  const Wrapped = (props: P) => (
    <ErrorBoundary {...boundaryProps}>
      <Component {...props} />
    </ErrorBoundary>
  )
  Wrapped.displayName = `withErrorBoundary(${Component.displayName ?? Component.name})`
  return Wrapped
}

// ── useErrorBoundary — trigger manuale da componenti figli ─────────────────

export function useErrorBoundary() {
  const [, setState] = useState<Error | null>(null)
  const throwError = useCallback((error: Error) => {
    // Forza re-render che lancia l'errore, catchabile dal boundary padre
    setState(() => { throw error })
  }, [])
  return { throwError }
}
