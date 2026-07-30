import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'Job Hunter Team — Agenti AI per trovare lavoro'
export const size = { width: 1200, height: 600 }
export const contentType = 'image/png'

export default function TwitterImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#060608',
          fontFamily: 'system-ui, sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Background glow */}
        <div
          style={{
            position: 'absolute',
            top: '-80px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '700px',
            height: '350px',
            background: 'radial-gradient(ellipse, rgba(0,232,122,0.12) 0%, transparent 70%)',
          }}
        />

        {/* Green dot + JHT */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '28px' }}>
          <div
            style={{
              width: '14px',
              height: '14px',
              borderRadius: '50%',
              background: '#00e87a',
              boxShadow: '0 0 20px rgba(0,232,122,0.6)',
            }}
          />
          <span style={{ fontSize: '24px', fontWeight: 800, letterSpacing: '0.2em', color: '#e0e0e0' }}>
            JHT
          </span>
        </div>

        {/* Title */}
        <h1
          style={{
            fontSize: '48px',
            fontWeight: 800,
            color: '#ffffff',
            textAlign: 'center',
            lineHeight: 1.2,
            margin: 0,
          }}
        >
          Il tuo team di agenti AI
        </h1>
        <h2
          style={{
            fontSize: '48px',
            fontWeight: 800,
            color: '#00e87a',
            textAlign: 'center',
            lineHeight: 1.2,
            margin: 0,
            marginTop: '4px',
          }}
        >
          per trovare lavoro
        </h2>

        <p
          style={{
            fontSize: '18px',
            color: '#888',
            marginTop: '24px',
            textAlign: 'center',
          }}
        >
          7 agenti AI specializzati · 100% locale e privato · Open source
        </p>

        <div
          style={{
            position: 'absolute',
            bottom: '24px',
            fontSize: '13px',
            color: '#555',
            letterSpacing: '0.15em',
          }}
        >
          jobhunterteam.ai
        </div>
      </div>
    ),
    { ...size },
  )
}
