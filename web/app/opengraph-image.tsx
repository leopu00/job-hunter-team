import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'Job Hunter Team — AI agents that find jobs for you'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OGImage() {
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
            top: '-100px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '800px',
            height: '400px',
            background: 'radial-gradient(ellipse, rgba(0,232,122,0.12) 0%, transparent 70%)',
          }}
        />

        {/* Green dot + JHT */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '32px' }}>
          <div
            style={{
              width: '16px',
              height: '16px',
              borderRadius: '50%',
              background: '#00e87a',
              boxShadow: '0 0 20px rgba(0,232,122,0.6)',
            }}
          />
          <span style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '0.2em', color: '#e0e0e0' }}>
            JHT
          </span>
        </div>

        {/* Title */}
        <h1
          style={{
            fontSize: '56px',
            fontWeight: 800,
            color: '#ffffff',
            textAlign: 'center',
            lineHeight: 1.2,
            margin: 0,
            padding: '0 60px',
          }}
        >
          Il tuo team di agenti AI
        </h1>
        <h2
          style={{
            fontSize: '56px',
            fontWeight: 800,
            color: '#00e87a',
            textAlign: 'center',
            lineHeight: 1.2,
            margin: 0,
            marginTop: '8px',
          }}
        >
          per trovare lavoro
        </h2>

        {/* Subtitle */}
        <p
          style={{
            fontSize: '20px',
            color: '#888',
            marginTop: '28px',
            textAlign: 'center',
            maxWidth: '700px',
            lineHeight: 1.5,
          }}
        >
          7 agenti AI specializzati. 100% locale e privato. Open source.
        </p>

        {/* Bottom bar */}
        <div
          style={{
            position: 'absolute',
            bottom: '30px',
            display: 'flex',
            gap: '40px',
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: '14px', color: '#555', letterSpacing: '0.15em' }}>
            jobhunterteam.ai
          </span>
          <span style={{ fontSize: '14px', color: '#555' }}>
            MIT License
          </span>
          <span style={{ fontSize: '14px', color: '#555' }}>
            v0.1.6
          </span>
        </div>
      </div>
    ),
    { ...size }
  )
}
