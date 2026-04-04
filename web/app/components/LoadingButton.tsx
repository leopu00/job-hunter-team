'use client'

import React from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type ButtonSize    = 'sm' | 'md' | 'lg'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:     ButtonVariant
  size?:        ButtonSize
  loading?:     boolean
  loadingText?: string
  icon?:        React.ReactNode
  iconPosition?: 'left' | 'right'
  fullWidth?:   boolean
}

// ── Style maps ─────────────────────────────────────────────────────────────

const VARIANT_STYLE: Record<ButtonVariant, React.CSSProperties> = {
  primary:   { background: 'var(--color-green)',  color: '#000',                    border: 'none' },
  secondary: { background: 'var(--color-row)',    color: 'var(--color-muted)',      border: '1px solid var(--color-border)' },
  danger:    { background: 'color-mix(in srgb, var(--color-red) 15%, var(--color-panel))', color: 'var(--color-red)', border: '1px solid color-mix(in srgb, var(--color-red) 30%, transparent)' },
  ghost:     { background: 'transparent',         color: 'var(--color-muted)',      border: '1px solid transparent' },
}

const VARIANT_HOVER: Record<ButtonVariant, string> = {
  primary:   'btn-hover-primary',
  secondary: 'btn-hover-secondary',
  danger:    'btn-hover-danger',
  ghost:     'btn-hover-ghost',
}

const SIZE_CLS: Record<ButtonSize, string> = {
  sm: 'text-[10px] px-3 py-1.5 gap-1.5 rounded',
  md: 'text-[11px] px-4 py-2 gap-2 rounded-md',
  lg: 'text-[13px] px-5 py-2.5 gap-2.5 rounded-lg',
}

const SPINNER_SIZE: Record<ButtonSize, number> = { sm: 10, md: 12, lg: 14 }

// ── Spinner ────────────────────────────────────────────────────────────────

function Spinner({ size }: { size: number }) {
  return (
    <span
      className="inline-block rounded-full border-2 flex-shrink-0 animate-spin"
      style={{
        width: size, height: size,
        borderColor: 'currentColor',
        borderTopColor: 'transparent',
      }}
    />
  )
}

// ── Button (base) ──────────────────────────────────────────────────────────

export function Button({
  children, variant = 'primary', size = 'md',
  loading = false, loadingText,
  icon, iconPosition = 'left',
  fullWidth = false, disabled, className = '', style, ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading

  return (
    <>
      <style>{`
        .btn-hover-primary:hover:not(:disabled)   { opacity: 0.88; }
        .btn-hover-secondary:hover:not(:disabled) { border-color: var(--color-muted) !important; }
        .btn-hover-danger:hover:not(:disabled)    { background: color-mix(in srgb, var(--color-red) 25%, var(--color-panel)) !important; }
        .btn-hover-ghost:hover:not(:disabled)     { background: var(--color-row) !important; border-color: var(--color-border) !important; }
        button:disabled { opacity: 0.45; cursor: not-allowed !important; }
      `}</style>
      <button
        {...rest}
        disabled={isDisabled}
        className={`inline-flex items-center justify-center font-semibold tracking-wide leading-none transition-all cursor-pointer select-none ${SIZE_CLS[size]} ${VARIANT_HOVER[variant]} ${fullWidth ? 'w-full' : ''} ${className}`}
        style={{ ...VARIANT_STYLE[variant], ...style }}
      >
        {/* Left icon / spinner */}
        {loading
          ? <Spinner size={SPINNER_SIZE[size]} />
          : icon && iconPosition === 'left' && <span className="flex items-center flex-shrink-0">{icon}</span>
        }

        {/* Label */}
        <span>{loading && loadingText ? loadingText : children}</span>

        {/* Right icon */}
        {!loading && icon && iconPosition === 'right' && (
          <span className="flex items-center flex-shrink-0">{icon}</span>
        )}
      </button>
    </>
  )
}

// ── LoadingButton (alias con props semplificate) ───────────────────────────

export function LoadingButton(props: ButtonProps) {
  return <Button {...props} />
}

// ── ButtonGroup ────────────────────────────────────────────────────────────

export interface ButtonGroupProps {
  children:  React.ReactNode
  gap?:      'sm' | 'md' | 'lg'
  vertical?: boolean
}

const GAP: Record<string, string> = { sm: 'gap-1', md: 'gap-2', lg: 'gap-3' }

export function ButtonGroup({ children, gap = 'md', vertical = false }: ButtonGroupProps) {
  return (
    <div className={`flex ${vertical ? 'flex-col' : 'flex-row flex-wrap'} ${GAP[gap]}`}>
      {children}
    </div>
  )
}

// ── IconButton (shorthand bottone icona quadrato) ─────────────────────────

export interface IconButtonProps {
  icon:      React.ReactNode
  onClick?:  () => void
  variant?:  ButtonVariant
  size?:     ButtonSize
  label:     string   // aria-label obbligatorio
  loading?:  boolean
  disabled?: boolean
}

const ICON_SIZE: Record<ButtonSize, string> = { sm: 'w-7 h-7', md: 'w-8 h-8', lg: 'w-10 h-10' }

export function IconButton({ icon, onClick, variant = 'secondary', size = 'md', label, loading = false, disabled }: IconButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={label}
      className={`inline-flex items-center justify-center rounded-md cursor-pointer transition-all flex-shrink-0 ${ICON_SIZE[size]} ${VARIANT_HOVER[variant]}`}
      style={{ ...VARIANT_STYLE[variant], padding: 0 }}
    >
      {loading ? <Spinner size={SPINNER_SIZE[size]} /> : icon}
    </button>
  )
}
