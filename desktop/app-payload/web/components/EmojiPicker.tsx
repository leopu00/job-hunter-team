'use client'

import { useEffect, useRef, useState } from 'react'

const CATEGORIES: Record<string, { icon: string; emojis: string[] }> = {
  recenti:  { icon: '🕐', emojis: [] },
  sorrisi:  { icon: '😀', emojis: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤧','🥵','🥶','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️'] },
  persone:  { icon: '👋', emojis: ['👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','💪','🦾','🖕','✍️','💅','🤳','👶','🧒','👦','👧','🧑','👱','👨','🧔','🧓','👴','👵','👲','👳','🧕','👮','👷','💂','🕵️','👩‍⚕️','👨‍⚕️','👩‍🎓','👨‍🎓','👩‍🏫','👨‍🏫','👩‍⚖️','👨‍⚖️'] },
  animali:  { icon: '🐶', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦟','🦗','🕷','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🦣','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🦬','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐'] },
  cibo:     { icon: '🍎', emojis: ['🍎','🍊','🍋','🍇','🍓','🫐','🍈','🍑','🥭','🍍','🥝','🍅','🫒','🥥','🥑','🍆','🥦','🥬','🥒','🌶','🫑','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🦴','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍘','🍥','🥮','🍢','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🧃','🥤','🧋','☕','🍵','🫖','🍺','🍻','🥂','🍷','🫗','🥃','🍸','🍹','🧉','🍾'] },
  viaggi:   { icon: '✈️', emojis: ['✈️','🚀','🛸','🚁','🛶','⛵','🚤','🛥','🛳','⛴','🚢','🚂','🚃','🚄','🚅','🚆','🚇','🚈','🚉','🚊','🚝','🚞','🚋','🚌','🚍','🚎','🚐','🚑','🚒','🚓','🚔','🚕','🚖','🚗','🚘','🚙','🛻','🚚','🚛','🚜','🏎','🏍','🛵','🦽','🦼','🛺','🚲','🛴','🛹','🛼','🚏','🛣','🛤','⛽','🚧','⚓','🚦','🚥','🗺','🗾','🧭','🏔','⛰','🌋','🗻','🏕','🏖','🏜','🏝','🏞','🏟','🏛','🏗','🧱','🪨','🪵','🛖','🏘','🏚','🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏬','🏭','🏯','🏰','💒','🗼','🗽','⛪','🕌','🛕','🕍','🕋','⛩','🗾'] },
  oggetti:  { icon: '💡', emojis: ['💡','🔦','🕯','🪔','🧯','🛢','💰','💴','💵','💶','💷','💸','💳','🪙','💎','⚖','🪜','🔧','🪛','🔨','⚒','🛠','⛏','🪚','🔩','🪤','🧲','🔫','🪃','🏹','🛡','🪖','⚔','🗡','🗡','🔪','🗡','🪤','🗜','🔗','⛓','🪝','🧰','🪣','🧲','💊','💉','🩸','🩹','🩼','🩺','🩻','🪬','🧬','🔬','🔭','🩻','🪄','🪅','🪆','🖼','🧵','🪡','🧶','🪢','🔑','🗝','🔐','🔒','🔓','🗄','🗃','📦','📫','📪','📬','📭','📮','🗳','📥','📤','📧','✉️','📝','📄','📃','📑','🗒','🗓','📆','📅','🗑','📁','📂'] },
  simboli:  { icon: '❤️', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','❤️‍🔥','❤️‍🩹','💕','💞','💓','💗','💖','💝','💘','💔','❣️','💟','☮️','✝️','☪️','🕉️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','🔕','🔇','🔕','❗','❕','❓','❔','‼️','⁉️','🔅','🔆','📶','🔱','⚜️','🔰','♻️','✅','🈯','💹','❇️','✳️','🌐','🏧','♿','🅿️','🈳','🈹'] },
}

const LS_KEY = 'emoji_recents'
const MAX_RECENTS = 18
type CategoryKey = keyof typeof CATEGORIES | 'recenti'

export interface EmojiPickerProps {
  onSelect: (emoji: string) => void
  trigger?: React.ReactNode
}

export default function EmojiPicker({ onSelect, trigger }: EmojiPickerProps) {
  const [open, setOpen]       = useState(false)
  const [search, setSearch]   = useState('')
  const [cat, setCat]         = useState<CategoryKey>('sorrisi')
  const [recents, setRecents] = useState<string[]>([])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    queueMicrotask(() => {
      try { setRecents(JSON.parse(localStorage.getItem(LS_KEY) ?? '[]')) } catch {}
    })
  }, [open])

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', fn); return () => document.removeEventListener('mousedown', fn)
  }, [])

  const select = (emoji: string) => {
    onSelect(emoji)
    const next = [emoji, ...recents.filter(e => e !== emoji)].slice(0, MAX_RECENTS)
    setRecents(next); localStorage.setItem(LS_KEY, JSON.stringify(next))
    setOpen(false)
  }

  const catData: Record<CategoryKey, { icon: string; emojis: string[] }> = { ...CATEGORIES, recenti: { icon: '🕐', emojis: recents } }
  const displayEmojis = search
    ? Object.values(CATEGORIES).flatMap(c => c.emojis).filter(e => e.includes(search))
    : cat === 'recenti' ? recents : (catData as Record<string, { emojis: string[] }>)[cat]?.emojis ?? []

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <div role="button" aria-expanded={open} aria-label="Seleziona emoji" onClick={() => setOpen(v => !v)} style={{ cursor: 'pointer', display: 'inline-flex' }}>
        {trigger ?? <button style={{ fontSize: 18, background: 'none', border: '1px solid var(--color-border)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>😀</button>}
      </div>

      {open && (
        <div style={{ position: 'absolute', bottom: '110%', left: 0, zIndex: 200, background: 'var(--color-panel)', border: '1px solid var(--color-border)', borderRadius: 10, boxShadow: '0 4px 24px rgba(0,0,0,0.4)', width: 280, animation: 'fade-in 0.1s ease both' }}>
          {/* Search */}
          <div style={{ padding: '8px 8px 4px' }}>
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca emoji..."
              style={{ width: '100%', padding: '5px 8px', fontSize: 11, borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-row)', color: 'var(--color-bright)', outline: 'none', boxSizing: 'border-box' }} />
          </div>

          {/* Category tabs */}
          {!search && (
            <div style={{ display: 'flex', padding: '2px 6px', gap: 2, borderBottom: '1px solid var(--color-border)', overflowX: 'auto' }}>
              {Object.entries(catData).map(([key, { icon }]) => (
                <button key={key} onClick={() => setCat(key as CategoryKey)} title={key}
                  style={{ background: cat === key ? 'var(--color-row)' : 'none', border: 'none', fontSize: 14, cursor: 'pointer', borderRadius: 5, padding: '3px 5px', opacity: key === 'recenti' && recents.length === 0 ? 0.3 : 1 }}>
                  {icon}
                </button>
              ))}
            </div>
          )}

          {/* Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 1, padding: 6, maxHeight: 200, overflowY: 'auto' }}>
            {displayEmojis.length === 0
              ? <div style={{ gridColumn: '1/-1', textAlign: 'center', fontSize: 10, color: 'var(--color-dim)', padding: '16px 0' }}>Nessun risultato</div>
              : displayEmojis.map((emoji: string, i: number) => (
                <button key={i} onClick={() => select(emoji)} title={emoji}
                  style={{ fontSize: 18, background: 'none', border: 'none', cursor: 'pointer', borderRadius: 4, padding: 2, lineHeight: 1.2 }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--color-row)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                  {emoji}
                </button>
              ))
            }
          </div>
        </div>
      )}
    </div>
  )
}
