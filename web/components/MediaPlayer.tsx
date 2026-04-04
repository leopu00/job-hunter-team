'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface MediaPlayerProps {
  src: string
  type?: 'audio' | 'video'
  autoPlay?: boolean
  poster?: string
  className?: string
}

function fmtTime(s: number): string {
  if (!isFinite(s)) return '0:00'
  const m = Math.floor(s / 60); const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function MediaPlayer({ src, type = 'video', autoPlay = false, poster, className }: MediaPlayerProps) {
  const mediaRef   = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying]   = useState(false)
  const [current, setCurrent]   = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume]     = useState(1)
  const [muted, setMuted]       = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [showControls, setShow] = useState(true)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* ── Media events ── */
  useEffect(() => {
    const m = mediaRef.current; if (!m) return
    const onTime   = () => setCurrent(m.currentTime)
    const onLoad   = () => setDuration(m.duration)
    const onPlay   = () => setPlaying(true)
    const onPause  = () => setPlaying(false)
    const onEnded  = () => setPlaying(false)
    m.addEventListener('timeupdate',     onTime)
    m.addEventListener('loadedmetadata', onLoad)
    m.addEventListener('play',           onPlay)
    m.addEventListener('pause',          onPause)
    m.addEventListener('ended',          onEnded)
    return () => { m.removeEventListener('timeupdate', onTime); m.removeEventListener('loadedmetadata', onLoad); m.removeEventListener('play', onPlay); m.removeEventListener('pause', onPause); m.removeEventListener('ended', onEnded) }
  }, [])

  /* ── Fullscreen change ── */
  useEffect(() => {
    const fn = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', fn)
    return () => document.removeEventListener('fullscreenchange', fn)
  }, [])

  /* ── Auto-hide controls ── */
  const resetHide = useCallback(() => {
    setShow(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    if (type === 'video') hideTimer.current = setTimeout(() => setShow(false), 2500)
  }, [type])

  /* ── Keyboard ── */
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      const m = mediaRef.current; if (!m) return
      if (['INPUT','TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return
      if (e.key === ' ')           { e.preventDefault(); playing ? m.pause() : m.play() }
      if (e.key === 'ArrowRight')  { e.preventDefault(); m.currentTime = Math.min(m.currentTime + 5, duration) }
      if (e.key === 'ArrowLeft')   { e.preventDefault(); m.currentTime = Math.max(m.currentTime - 5, 0) }
      if (e.key === 'ArrowUp')     { e.preventDefault(); m.volume = Math.min(m.volume + 0.1, 1); setVolume(m.volume) }
      if (e.key === 'ArrowDown')   { e.preventDefault(); m.volume = Math.max(m.volume - 0.1, 0); setVolume(m.volume) }
      if (e.key === 'm')           { m.muted = !m.muted; setMuted(m.muted) }
      if (e.key === 'f')           { toggleFS() }
    }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [playing, duration])

  const togglePlay = () => { const m = mediaRef.current; if (!m) return; playing ? m.pause() : m.play() }
  const toggleFS   = () => { const c = containerRef.current; if (!c) return; !document.fullscreenElement ? c.requestFullscreen() : document.exitFullscreen() }

  /* ── Progress drag ── */
  const seek = (e: React.MouseEvent | MouseEvent) => {
    const el = progressRef.current; if (!el || !mediaRef.current) return
    const rect = el.getBoundingClientRect()
    const pct  = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1)
    mediaRef.current.currentTime = pct * duration
  }
  const onProgressMouseDown = (e: React.MouseEvent) => {
    seek(e)
    const onMove = (ev: MouseEvent) => seek(ev)
    const onUp   = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
  }

  const pct = duration ? (current / duration) * 100 : 0
  const isAudio = type === 'audio'

  const controls = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: isAudio ? 0 : '6px 10px', background: isAudio ? 'var(--color-panel)' : 'linear-gradient(transparent, rgba(0,0,0,0.75))', borderRadius: isAudio ? 0 : '0 0 8px 8px' }}>
      {/* Progress */}
      <div ref={progressRef} onMouseDown={onProgressMouseDown} style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', cursor: 'pointer', position: 'relative' }}>
        <div style={{ height: '100%', borderRadius: 2, background: 'var(--color-green)', width: `${pct}%`, transition: 'width 0.1s linear', position: 'relative' }}>
          <div style={{ position: 'absolute', right: -5, top: -4, width: 12, height: 12, borderRadius: '50%', background: 'var(--color-green)', border: '2px solid #fff' }} />
        </div>
      </div>
      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={togglePlay} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 16, cursor: 'pointer', padding: 0, lineHeight: 1 }}>{playing ? '⏸' : '▶'}</button>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.7)', minWidth: 70, fontVariantNumeric: 'tabular-nums' }}>{fmtTime(current)} / {fmtTime(duration)}</span>
        <button onClick={() => { const m = mediaRef.current; if (m) { m.muted = !m.muted; setMuted(m.muted) } }} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 13, cursor: 'pointer', padding: 0 }}>{muted ? '🔇' : volume > 0.5 ? '🔊' : '🔉'}</button>
        <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={e => { const v = +e.target.value; const m = mediaRef.current; if (m) { m.volume = v; m.muted = v === 0 }; setVolume(v); setMuted(v === 0) }} style={{ width: 60, accentColor: 'var(--color-green)', cursor: 'pointer' }} />
        {!isAudio && <button onClick={toggleFS} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#fff', fontSize: 13, cursor: 'pointer', padding: 0 }}>{fullscreen ? '⊠' : '⛶'}</button>}
      </div>
    </div>
  )

  if (isAudio) return (
    <div style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <audio ref={mediaRef} src={src} autoPlay={autoPlay} style={{ display: 'none' }} />
      {controls}
    </div>
  )

  return (
    <div ref={containerRef} className={className} onMouseMove={resetHide} onClick={togglePlay} style={{ position: 'relative', background: '#000', borderRadius: 8, overflow: 'hidden', cursor: 'pointer' }}>
      <video ref={mediaRef} src={src} poster={poster} autoPlay={autoPlay} style={{ width: '100%', display: 'block' }} />
      <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, opacity: showControls ? 1 : 0, transition: 'opacity 0.3s ease' }}>
        {controls}
      </div>
    </div>
  )
}
