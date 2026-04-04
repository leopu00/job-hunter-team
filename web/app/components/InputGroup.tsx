'use client'

import React, { createContext, useContext } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type InputSize = 'sm' | 'md' | 'lg'

export interface InputGroupProps {
  children:   React.ReactNode
  prefix?:    React.ReactNode
  suffix?:    React.ReactNode
  error?:     string
  size?:      InputSize
  fullWidth?: boolean
  className?: string
}

// ── Context (passa size agli slot) ─────────────────────────────────────────

const SizeCtx = createContext<InputSize>('md')

// ── Size maps ──────────────────────────────────────────────────────────────

const ADDON_CLS: Record<InputSize, string> = {
  sm: 'px-2 py-1 text-[9px]',
  md: 'px-3 py-2 text-[10px]',
  lg: 'px-4 py-2.5 text-[11px]',
}

const INPUT_CLS: Record<InputSize, string> = {
  sm: 'px-2 py-1 text-[10px]',
  md: 'px-3 py-2 text-[11px]',
  lg: 'px-4 py-2.5 text-[12px]',
}

// ── InputGroup ─────────────────────────────────────────────────────────────

export function InputGroup({
  children, prefix, suffix, error,
  size = 'md', fullWidth = false, className = '',
}: InputGroupProps) {
  const borderColor = error ? 'var(--color-red)' : 'var(--color-border)'
  const focusBorder = error ? 'var(--color-red)' : 'var(--color-green)'

  return (
    <SizeCtx.Provider value={size}>
      <div className={`flex flex-col gap-1 ${fullWidth ? 'w-full' : ''} ${className}`}>
        {/* Input row */}
        <div
          className={`flex items-stretch rounded overflow-hidden ${fullWidth ? 'w-full' : ''}`}
          style={{
            border: `1px solid ${borderColor}`,
            transition: 'border-color 0.15s',
          }}
          onFocusCapture={e => { (e.currentTarget as HTMLDivElement).style.borderColor = focusBorder }}
          onBlurCapture={e  => { (e.currentTarget as HTMLDivElement).style.borderColor = borderColor }}
        >
          {/* Prefix addon */}
          {prefix && (
            <span
              className={`flex items-center flex-shrink-0 font-mono select-none ${ADDON_CLS[size]}`}
              style={{
                background: 'var(--color-row)',
                color: 'var(--color-dim)',
                borderRight: `1px solid ${borderColor}`,
              }}
            >
              {prefix}
            </span>
          )}

          {/* Input — clona per iniettare className e style */}
          <span className="flex-1 flex items-stretch min-w-0">
            {React.Children.map(children, child => {
              if (!React.isValidElement(child)) return child
              return React.cloneElement(child as React.ReactElement<React.InputHTMLAttributes<HTMLInputElement>>, {
                className: [
                  'w-full bg-[var(--color-card)] outline-none font-mono',
                  'text-[var(--color-bright)] placeholder:text-[var(--color-dim)]',
                  INPUT_CLS[size],
                  (child.props as React.InputHTMLAttributes<HTMLInputElement>).className ?? '',
                ].join(' '),
                style: {
                  border: 'none',
                  borderRadius: 0,
                  ...((child.props as React.InputHTMLAttributes<HTMLInputElement>).style ?? {}),
                },
              })
            })}
          </span>

          {/* Suffix addon */}
          {suffix && (
            <span
              className={`flex items-center flex-shrink-0 font-mono select-none ${ADDON_CLS[size]}`}
              style={{
                background: 'var(--color-row)',
                color: 'var(--color-dim)',
                borderLeft: `1px solid ${borderColor}`,
              }}
            >
              {suffix}
            </span>
          )}
        </div>

        {/* Error */}
        {error && (
          <p className="text-[10px]" style={{ color: 'var(--color-red)' }}>{error}</p>
        )}
      </div>
    </SizeCtx.Provider>
  )
}

// ── InputAddon (standalone addon per composizioni custom) ──────────────────

export interface InputAddonProps {
  children:  React.ReactNode
  position?: 'left' | 'right'
}

export function InputAddon({ children, position = 'left' }: InputAddonProps) {
  const size = useContext(SizeCtx)
  return (
    <span
      className={`flex items-center flex-shrink-0 font-mono select-none ${ADDON_CLS[size]}`}
      style={{
        background: 'var(--color-row)',
        color: 'var(--color-dim)',
        [position === 'left' ? 'borderRight' : 'borderLeft']: '1px solid var(--color-border)',
      }}
    >
      {children}
    </span>
  )
}

// ── Input (standalone con styling base, usabile anche senza InputGroup) ────

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  size?:      InputSize
  error?:     boolean
  fullWidth?: boolean
}

export function Input({ size = 'md', error = false, fullWidth = false, className = '', style, ...rest }: InputProps) {
  return (
    <input
      {...rest}
      className={`rounded font-mono bg-[var(--color-card)] text-[var(--color-bright)] placeholder:text-[var(--color-dim)] outline-none transition-colors ${INPUT_CLS[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
      style={{
        border: `1px solid ${error ? 'var(--color-red)' : 'var(--color-border)'}`,
        ...style,
      }}
      onFocus={e => { e.currentTarget.style.borderColor = error ? 'var(--color-red)' : 'var(--color-green)'; rest.onFocus?.(e) }}
      onBlur={e  => { e.currentTarget.style.borderColor = error ? 'var(--color-red)' : 'var(--color-border)'; rest.onBlur?.(e) }}
    />
  )
}
