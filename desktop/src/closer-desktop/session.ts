import { closerDesktopRequest, errorCode, isId, isSequence, mission, pngUrl, sameMission,
  type Control, type DesktopReply, type DesktopRequest, type DesktopTransport,
  type DisplayBinding, type InputEvent, type MissionBinding } from "../lib/closer-desktop";

export interface Descriptor extends MissionBinding {
  phase: string;
  review_id: string | null;
  display_id: string | null;
  frame_sequence: number;
  input_ready: boolean;
  stream_available: boolean;
  allowed_actions: string[];
  gate_reason: string;
  block: { event_id: string; reason: string; action: string; screenshot_available: boolean } | null;
}
export interface Frame extends DisplayBinding { url: string; width: number; height: number; received: number }
export interface View {
  descriptor: Descriptor | null; descriptorAt: number; frame: Frame | null;
  screenshot: { event_id: string; url: string } | null;
  phase: string; error: string; notice: "" | "queued" | "discarded"; busy: boolean;
}
const text = (v: unknown) => typeof v === "string" ? v.slice(0, 240) : "";
const actions = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const terminal = new Set(["absent", "completed", "closed", "unknown"]);
const phases = new Set(["admitted", "ready", "running", "review_wait", "confirmed", "handoff_pending",
  "handoff", "observing", "blocked", "completed", "closed", "unknown"]);

/** A single request lane. Queued input keeps the identity of the pixels that produced it. */
export class DesktopSession {
  view: View = { descriptor: null, descriptorAt: 0, frame: null, screenshot: null,
    phase: "disconnected", error: "", notice: "", busy: false };
  private disposed = false;
  private inputs: Array<DisplayBinding & InputEvent & { observed: number }> = [];
  private controlPending = false;
  private refreshFrame = false;
  private descriptorDue = true;
  private queuedControls = new Set<string>();
  private readAfter = 0;
  constructor(private changed: () => void, private transport: DesktopTransport = closerDesktopRequest,
    private clock: () => number = () => performance.now()) {}
  dispose() { this.disposed = true; this.inputs = []; this.view = { ...this.view, frame: null, screenshot: null }; }
  private publish() { if (!this.disposed) this.changed(); }
  fresh() { return !this.disposed && !!this.view.descriptor && this.clock() - this.view.descriptorAt < 2000; }
  allowed(op: string) { return this.fresh() && this.view.descriptor!.allowed_actions.includes(op); }
  canInput() {
    const { descriptor: d, frame: f } = this.view;
    return !!d && !!f && this.allowed("input") && d.phase === "handoff" && d.input_ready &&
      this.frameFresh();
  }
  frameFresh() {
    const { descriptor: d, frame: f } = this.view;
    return !!d && !!f && this.fresh() && sameMission(f, d) && f.display_id === d.display_id &&
      f.frame_sequence === d.frame_sequence && this.clock() - f.received < 1800;
  }
  canControl(op: Control) {
    const d = this.view.descriptor;
    return !this.view.busy && !this.controlPending && !!d && this.allowed(op) &&
      !this.queuedControls.has(this.controlKey(d, op)) &&
      (op !== "confirm" || (d.phase === "review_wait" && isId(d.review_id)));
  }
  private controlKey(d: Descriptor, op: Control) {
    return `${d.mission_id}:${d.owner_id}:${d.generation}:${op}:${op === "confirm" || op === "handoff" ? d.review_id : ""}`;
  }
  private discard() {
    this.inputs = []; this.view.notice = "discarded"; this.refreshFrame = true;
  }
  enqueue(event: InputEvent) {
    if (!this.canInput()) return false;
    if (this.inputs.length >= 64) { this.discard(); this.publish(); return false; }
    const f = this.view.frame!;
    this.inputs.push({ ...mission(f)!, display_id: f.display_id, frame_sequence: f.frame_sequence,
      ...event, observed: f.received });
    return true;
  }
  imageFailed(kind: "frame" | "snapshot") {
    if (kind === "frame") { this.view.frame = null; this.discard(); }
    else this.view.screenshot = null;
    this.view.error = "desktop_image_invalid"; this.publish();
  }
  private fail(code: string) {
    this.inputs = []; this.view = { ...this.view, descriptor: null, descriptorAt: 0,
      frame: null, screenshot: null, phase: "disconnected", error: code };
    this.descriptorDue = true;
    this.readAfter = this.clock() + 1500;
  }
  private applyDescriptor(reply: DesktopReply) {
    if (reply.phase === "absent") {
      this.fail(""); this.view.phase = "absent"; this.descriptorDue = false;
      this.view.descriptorAt = this.clock(); return;
    }
    if (reply.phase === "admitted" && reply.owner_id == null) {
      this.fail(""); this.view.phase = "admitted"; this.descriptorDue = false;
      this.view.descriptorAt = this.clock(); return;
    }
    const binding = mission(reply);
    if (!binding || !actions(reply.allowed_actions) || typeof reply.phase !== "string" || !phases.has(reply.phase)) {
      this.fail("desktop_descriptor_unavailable"); return;
    }
    const old = this.view.descriptor;
    if (!old || !sameMission(binding, old) || old.display_id !== reply.display_id) {
      this.view.frame = null; this.view.screenshot = null; this.inputs = [];
    }
    const block = reply.block && typeof reply.block === "object" ? reply.block as Record<string, unknown> : null;
    const d: Descriptor = { ...binding, phase: text(reply.phase), review_id: isId(reply.review_id) ? reply.review_id : null,
      display_id: isId(reply.display_id) ? reply.display_id : null,
      frame_sequence: isSequence(reply.frame_sequence) ? reply.frame_sequence : 0,
      input_ready: reply.input_ready === true, stream_available: reply.stream_available === true,
      allowed_actions: reply.allowed_actions, gate_reason: text(reply.gate_reason),
      block: block && isId(block.event_id) ? { event_id: block.event_id, reason: text(block.reason),
        action: text(block.action), screenshot_available: block.screenshot_available === true } : null };
    this.view.descriptor = d; this.view.descriptorAt = this.clock();
    this.view.phase = d.phase; this.view.error = ""; this.descriptorDue = false;
    if (!d.stream_available || !d.allowed_actions.includes("frame") || terminal.has(d.phase)) this.view.frame = null;
    if (!d.block?.screenshot_available || !d.allowed_actions.includes("snapshot") ||
        d.block.event_id !== this.view.screenshot?.event_id) this.view.screenshot = null;
    if (!this.canInput() && this.inputs.length) this.discard();
  }
  private async request(request: DesktopRequest, apply: (reply: DesktopReply) => void) {
    if (this.disposed || this.view.busy) return;
    this.view.busy = true; this.publish();
    try {
      const reply = await this.transport(request);
      if (this.disposed) return;
      if (!reply || reply.ok !== true) this.fail(errorCode(reply ?? { ok: false }));
      else apply(reply);
    } catch { if (!this.disposed) this.fail("desktop_transport_unavailable"); }
    finally { this.view.busy = false; this.publish(); }
  }
  async control(op: Control) {
    if (!this.canControl(op)) return;
    const d = this.view.descriptor!;
    const request: DesktopRequest = op === "confirm" || op === "handoff"
      ? { ...mission(d)!, op, review_id: d.review_id } : { ...mission(d)!, op };
    this.controlPending = true; this.inputs = [];
    await this.request(request, (reply) => {
      this.view.notice = reply.queued === true ? "queued" : "";
      if (reply.queued === true) this.queuedControls.add(this.controlKey(d, op));
      this.applyDescriptor(reply); this.descriptorDue = true;
    });
    this.controlPending = false;
  }
  async deleteScreenshot() {
    const d = this.view.descriptor;
    if (!d?.block || !this.allowed("delete_snapshot") || this.view.busy) return;
    await this.request({ ...mission(d)!, op: "delete_snapshot", event_id: d.block.event_id }, () => {
      this.view.screenshot = null;
      if (this.view.descriptor?.block) this.view.descriptor.block.screenshot_available = false;
      this.descriptorDue = true;
    });
  }
  refresh() { this.descriptorDue = true; this.readAfter = 0; this.publish(); }
  async poll() {
    if (this.disposed || this.view.busy || this.controlPending) return;
    const d = this.view.descriptor;
    if (this.descriptorDue || !d || this.clock() - this.view.descriptorAt >= 1200) {
      if (this.clock() < this.readAfter) return;
      this.readAfter = this.clock() + 1200;
      await this.request({ op: "descriptor" }, (r) => this.applyDescriptor(r)); return;
    }
    if (this.inputs.length) {
      const event = this.inputs.shift()!;
      if (!this.canInput() || !sameMission(event, d) || event.display_id !== d.display_id ||
          event.frame_sequence !== this.view.frame?.frame_sequence || this.clock() - event.observed >= 1800) {
        this.discard(); this.publish(); return;
      }
      const { observed: _observed, ...body } = event;
      await this.request({ op: "input", ...body }, () => {}); return;
    }
    if (d.display_id && d.stream_available && this.allowed("frame") &&
        (this.refreshFrame || !this.view.frame || this.clock() - this.view.frame.received >= 700)) {
      this.refreshFrame = false;
      await this.request({ ...mission(d)!, op: "frame", display_id: d.display_id, frame_sequence: d.frame_sequence }, (r) => {
        const url = pngUrl(r.png_base64, 1440, 1000);
        if (!sameMission(d, r) || r.display_id !== d.display_id || !isSequence(r.frame_sequence) ||
            r.frame_sequence <= (this.view.frame?.frame_sequence ?? -1) || r.width !== 1440 || r.height !== 1000 || !url) {
          this.fail("desktop_frame_invalid"); return;
        }
        this.view.frame = { ...mission(d)!, display_id: d.display_id!, frame_sequence: r.frame_sequence,
          width: 1440, height: 1000, url, received: this.clock() };
        d.frame_sequence = r.frame_sequence;
        if (actions(r.allowed_actions)) d.allowed_actions = r.allowed_actions;
        if (this.inputs.some((event) => event.frame_sequence !== r.frame_sequence)) this.discard();
      }); return;
    }
    if (!this.view.screenshot && d.block?.screenshot_available && this.allowed("snapshot")) {
      const event = d.block.event_id;
      await this.request({ ...mission(d)!, op: "snapshot", event_id: event }, (r) => {
        const url = pngUrl(r.png_base64);
        if (!sameMission(d, r) || r.event_id !== event || !url) { this.fail("desktop_snapshot_invalid"); return; }
        this.view.screenshot = { event_id: event, url };
      });
    }
  }
}
