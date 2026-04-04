'use client'

// ── Types ──────────────────────────────────────────────────────────────────

export type ChatRole = 'user' | 'assistant'

export type ChatMessage = {
  id:        string
  role:      ChatRole
  content:   string
  timestamp?: string
  avatar?:   string   // URL immagine o iniziali
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtTime(ts?: string): string {
  if (!ts) return ''
  const d = new Date(ts)
  return isNaN(d.getTime()) ? ts : d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
}

// ── Avatar ─────────────────────────────────────────────────────────────────

function BubbleAvatar({ value, role }: { value?: string; role: ChatRole }) {
  const color  = role === 'user' ? 'var(--color-blue)' : 'var(--color-green)'
  const isUrl  = value?.startsWith('http') || value?.startsWith('/')
  const label  = value && !isUrl ? value.slice(0, 2).toUpperCase() : (role === 'user' ? 'U' : 'AI')

  return (
    <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold overflow-hidden"
      style={{ background: `${color}20`, border: `1.5px solid ${color}44`, color }}>
      {isUrl
        ? <img src={value} alt={role} className="w-full h-full object-cover" />
        : label
      }
    </div>
  )
}

// ── Typing indicator ───────────────────────────────────────────────────────

export function TypingIndicator({ label = 'Sta scrivendo…' }: { label?: string }) {
  return (
    <div className="flex items-end gap-2 mb-2">
      <BubbleAvatar role="assistant" />
      <div className="flex items-center gap-1.5 px-3 py-2.5 rounded-2xl rounded-bl-sm"
        style={{ background: 'var(--color-deep)', border: '1px solid var(--color-border)' }}>
        {[0, 1, 2].map(i => (
          <span key={i} className="rounded-full"
            style={{
              width: 6, height: 6, display: 'inline-block',
              background: 'var(--color-dim)',
              animation: `typing-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
            }} />
        ))}
      </div>
      <span className="text-[9px] mb-1" style={{ color: 'var(--color-dim)' }}>{label}</span>
      <style>{`
        @keyframes typing-dot {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30%            { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

// ── ChatBubble ─────────────────────────────────────────────────────────────

type ChatBubbleProps = {
  message:    ChatMessage
  showAvatar?: boolean
  className?: string
}

export function ChatBubble({ message, showAvatar = true, className }: ChatBubbleProps) {
  const isUser  = message.role === 'user'
  const color   = isUser ? 'var(--color-blue)' : 'var(--color-green)'
  const ts      = fmtTime(message.timestamp)

  return (
    <div className={`flex items-end gap-2 mb-2 ${isUser ? 'flex-row-reverse' : 'flex-row'} ${className ?? ''}`}>
      {showAvatar && <BubbleAvatar value={message.avatar} role={message.role} />}

      <div className="flex flex-col gap-1 max-w-[75%]" style={{ alignItems: isUser ? 'flex-end' : 'flex-start' }}>
        <div className={`px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words ${isUser ? 'rounded-2xl rounded-br-sm' : 'rounded-2xl rounded-bl-sm'}`}
          style={{
            background: isUser ? `${color}18` : 'var(--color-deep)',
            border:     `1px solid ${isUser ? `${color}44` : 'var(--color-border)'}`,
            color:      'var(--color-muted)',
          }}>
          {message.content}
        </div>
        {ts && (
          <span className="text-[8px] font-mono px-1" style={{ color: 'var(--color-dim)' }}>{ts}</span>
        )}
      </div>
    </div>
  )
}

// ── ChatList — lista messaggi con scroll ───────────────────────────────────

type ChatListProps = {
  messages:   ChatMessage[]
  typing?:    boolean
  typingLabel?: string
  className?: string
}

export function ChatList({ messages, typing, typingLabel, className }: ChatListProps) {
  return (
    <div className={`flex flex-col px-4 py-3 overflow-y-auto ${className ?? ''}`}>
      {messages.map((msg, i) => {
        const prevRole = i > 0 ? messages[i - 1].role : null
        return (
          <ChatBubble key={msg.id} message={msg} showAvatar={msg.role !== prevRole} />
        )
      })}
      {typing && <TypingIndicator label={typingLabel} />}
    </div>
  )
}
