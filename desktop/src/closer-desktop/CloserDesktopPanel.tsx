import { useEffect, useReducer, useState } from "react";
import { desktopKey, type Control, type DesktopTransport } from "../lib/closer-desktop";
import { DesktopSession } from "./session";
import { desktopCopy } from "./text";
import "./closer-desktop.css";

export function displayPoint(rect: DOMRect, width: number, height: number, x: number, y: number) {
  const scale = Math.min(rect.width / width, rect.height / height);
  if (scale <= 0) return null;
  const px = (x - rect.left - (rect.width - width * scale) / 2) / scale;
  const py = (y - rect.top - (rect.height - height * scale) / 2) / scale;
  return px >= 0 && py >= 0 && px < width && py < height ? { x: Math.floor(px), y: Math.floor(py) } : null;
}

export default function CloserDesktopPanel({ onClose, transport }: { onClose: () => void; transport?: DesktopTransport }) {
  const [, update] = useReducer((n) => n + 1, 0);
  const [session, setSession] = useState<DesktopSession | null>(null);
  const copy = desktopCopy();
  useEffect(() => {
    const current = new DesktopSession(update, transport);
    setSession(current);
    void current.poll();
    const timer = window.setInterval(() => { update(); void current.poll(); }, 200);
    return () => { window.clearInterval(timer); current.dispose(); };
  }, [transport]);
  if (!session) return <section className="closer-desktop" aria-label={copy.title}>
    <h2>{copy.title}</h2><p>{copy.waiting}</p><button onClick={onClose}>{copy.close}</button>
  </section>;
  const { descriptor: d, frame, screenshot, phase, error, notice, busy } = session.view;
  const fresh = session.fresh();
  const input = session.canInput();
  const liveFrame = session.frameFresh();
  const phaseLabel = phase === "absent" ? copy.absent : phase === "unknown" ? copy.unknown
    : ["closed", "completed"].includes(phase) ? copy.ended : phase === "review_wait"
      ? d?.allowed_actions.includes("confirm") ? copy.review : copy.blocked
    : phase === "handoff" ? copy.human : phase === "blocked" ? copy.blocked
    : ["admitted", "ready"].includes(phase) ? copy.waiting : d ? copy.running : copy.unavailable;
  const button = (op: Control) => <button key={op} type="button" disabled={!session.canControl(op)}
    onClick={() => void session.control(op)}>{copy[op]}</button>;

  return <section className="closer-desktop" aria-label={copy.title}>
    <header><div><h2>{copy.title}</h2><p>{copy.mode}</p></div>
      <button type="button" onClick={onClose}>{copy.close}</button></header>
    <div className="closer-desktop__status" role="status" aria-live="polite">
      <strong>{copy.status}: {phaseLabel}</strong>
      {d && <span>{copy.position}: {d.position_id}</span>}
      <span>{d && !fresh ? copy.stale : input ? copy.human : copy.automatic}</span>
      {error && <span className="closer-desktop__error">{copy.unavailable} ({error})</span>}
      {notice && <span>{copy[notice]}</span>}
    </div>
    {(d?.block || d?.gate_reason) && <dl className="closer-desktop__block">
      <dt>{copy.reason}</dt><dd>{d.block?.reason || d.gate_reason}</dd>
      {d.block?.action && <><dt>{copy.action}</dt><dd>{d.block.action}</dd></>}
    </dl>}
    <nav aria-label={copy.title}>
      {(["confirm", "handoff", "observe", "finish", "abandon"] as const).map(button)}
      <button type="button" disabled={busy} onClick={() => session.refresh()}>{copy.refresh}</button>
    </nav>
    <p className="closer-desktop__hint">{copy.recovery}</p>
    <figure>
      <figcaption>{copy.display} · {input ? copy.human : copy.automatic}</figcaption>
      <div className={`closer-desktop__screen${input ? " closer-desktop__screen--input" : ""}`}
        aria-label={copy.focus} role="group" tabIndex={input ? 0 : -1}
        onContextMenu={(e) => e.preventDefault()} onDragStart={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (!input) return;
          e.preventDefault();
          const key = desktopKey(e.key);
          // No clipboard shortcuts, browser accelerators or IME composition forwarding.
          if (key && !e.metaKey && !e.nativeEvent.isComposing && !(e.ctrlKey && ["c", "v", "x"].includes(e.key.toLowerCase())))
            session.enqueue({ kind: "key", key, pressed: true });
        }}
        onKeyUp={(e) => {
          if (!input) return;
          e.preventDefault(); const key = desktopKey(e.key);
          if (key && !e.metaKey && !e.nativeEvent.isComposing)
            session.enqueue({ kind: "key", key, pressed: false });
        }}
        onMouseDown={(e) => {
          if (!input || !frame) return;
          e.preventDefault(); e.currentTarget.focus();
          const p = displayPoint(e.currentTarget.getBoundingClientRect(), frame.width, frame.height, e.clientX, e.clientY);
          if (p && e.button <= 2) session.enqueue({ kind: "pointer", ...p, button: [1, 2, 3][e.button], pressed: true });
        }}
        onMouseUp={(e) => {
          if (!input || !frame) return;
          e.preventDefault();
          const p = displayPoint(e.currentTarget.getBoundingClientRect(), frame.width, frame.height, e.clientX, e.clientY);
          if (p && e.button <= 2) session.enqueue({ kind: "pointer", ...p, button: [1, 2, 3][e.button], pressed: false });
        }}>
        {frame ? <img draggable={false} src={frame.url} alt={copy.display} onError={() => session.imageFailed("frame")} />
          : <p>{copy.unavailable}</p>}
        {frame && !liveFrame && <div className="closer-desktop__stale">{copy.stale}</div>}
      </div>
    </figure>
    <details className="closer-desktop__artifact" open={!!screenshot}>
      <summary>{copy.screenshot}</summary>
      {screenshot ? <img src={screenshot.url} alt={copy.screenshot} draggable={false}
        onError={() => session.imageFailed("snapshot")} /> : <p>{copy.emptyImage}</p>}
      <button type="button" disabled={!fresh || busy || !d?.block?.screenshot_available || !session.allowed("delete_snapshot")}
        onClick={() => void session.deleteScreenshot()}>{copy.remove}</button>
      <p>{copy.privacy}</p>
    </details>
  </section>;
}
