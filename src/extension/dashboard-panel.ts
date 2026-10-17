import { randomBytes } from 'node:crypto';
import { acceptMessage, buildDomModel, renderDashboardShell } from './dashboard-shell.ts';

type Webview = { html: string; postMessage(message: object): PromiseLike<boolean> | boolean };

/** One panel document at a time. The static page remains authoritative until its own script says ready. */
export class DashboardPanel {
 private html = '';
 private load = 0;
 private version = 0;
 private ready = false;
 private failed = false;
 private pending = 0;
 private lastSent = '';
 private timer: ReturnType<typeof setTimeout> | undefined;
 private cooldownTimer: ReturnType<typeof setTimeout> | undefined;
 private lastAckAt = -Infinity;
 private disposed = false;
 private arrivals: number[] = [];
 private readonly webview: Webview;
 private readonly script: string;
 private readonly rejected: () => void;
 private readonly now: () => number;
 constructor(webview: Webview, script: string, rejected: () => void, now = Date.now) { this.webview = webview; this.script = script; this.rejected = rejected; this.now = now; }

 set(html: string): void {
  if (this.disposed) return;
  if (html === this.html) return;
  this.html = html;
  if (!this.ready || this.failed) { this.assign(); return; }
  if (!this.pending) this.send();
 }

 reveal(html: string): void { if (this.disposed) return; this.html = html; this.failed = false; this.assign(); }

 receive(raw: unknown): void {
  if (this.disposed) return;
  const time = this.now();
  this.arrivals = this.arrivals.filter(t => time - t < 1000);
  if (this.arrivals.length >= 10) { this.rejected(); return; }
  this.arrivals.push(time);
  // Ready is scoped to this document load. ACKs have a 2 s cooldown; outbound models are
  // coalesced to keep that cooldown from rejecting the ACK needed for the 5 s delivery gate.
  const message = acceptMessage(raw, this.load, this.pending);
  if (!message) { this.rejected(); return; }
  if (message.type === 'ready') {
   if (this.ready || this.failed) { this.rejected(); return; }
   this.ready = true;
   this.send();
  } else {
   if (!this.ready || !this.pending) { this.rejected(); return; }
   if (time - this.lastAckAt < 2000) { this.rejected(); return; }
   this.clearTimer();
   this.lastAckAt = time;
   this.pending = 0;
   this.send(); // Delivers one coalesced newer render, if one arrived while ACK was pending.
  }
 }

 dispose(): void { this.disposed = true; this.clearTimer(); this.clearCooldown(); this.pending = 0; this.ready = false; this.failed = true; }

 private assign(): void {
  this.clearTimer();
  this.clearCooldown();
  this.pending = 0; this.lastSent = ''; this.ready = false;
  this.load++;
  const nonce = randomBytes(16).toString('base64');
  this.webview.html = renderDashboardShell(this.html, nonce, this.load, this.script);
 }

 private send(): void {
  if (this.disposed || this.pending) return;
  const wait = 2000 - (this.now() - this.lastAckAt);
  if (wait > 0) {
   if (!this.cooldownTimer) this.cooldownTimer = setTimeout(() => { this.cooldownTimer = undefined; this.send(); }, wait);
   return;
  }
  let model: ReturnType<typeof buildDomModel>;
  try { model = buildDomModel(this.html); } catch { this.fallback(); return; }
  const encoded = JSON.stringify(model);
  if (encoded === this.lastSent) return;
  const version = ++this.version;
  this.pending = version;
  this.lastSent = encoded;
  this.timer = setTimeout(() => { if (this.pending === version) this.fallback(); }, 5000);
  try {
   void Promise.resolve(this.webview.postMessage({ type: 'model', schema: 1, version, model })).then(ok => { if (!ok && this.pending === version) this.fallback(); }, () => { if (this.pending === version) this.fallback(); });
  } catch { this.fallback(); }
 }

 private fallback(): void {
  if (this.disposed) return;
  this.failed = true;
  this.assign(); // A fresh static document has the latest labels even when delivery or ACK fails.
 }

 private clearTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
 private clearCooldown(): void { if (this.cooldownTimer) clearTimeout(this.cooldownTimer); this.cooldownTimer = undefined; }
}
