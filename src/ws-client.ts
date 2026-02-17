import WebSocket from "ws";
import { inflate } from "node:zlib";
import { promisify } from "node:util";
import type { KookClient } from "./client.js";
import type { KookWSSignal, KookHelloData, KookEventData } from "./types.js";

const inflateAsync = promisify(inflate);

const SIGNAL = {
  EVENT: 0,
  HELLO: 1,
  PING: 2,
  PONG: 3,
  RESUME: 4,
  RECONNECT: 5,
  RESUME_ACK: 6,
} as const;

const HELLO_CODE = {
  SUCCESS: 0,
  MISSING_PARAMS: 40100,
  INVALID_TOKEN: 40101,
  TOKEN_VERIFY_FAIL: 40102,
  TOKEN_EXPIRED: 40103,
} as const;

export type KookWSOptions = {
  client: KookClient;
  compress?: boolean;
  onEvent: (event: KookEventData) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  abortSignal?: AbortSignal;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class KookWSClient {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private lastSn = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private buffer: Map<number, KookWSSignal> = new Map();
  private stopped = false;
  private compress: boolean;

  // Heartbeat timing
  private static readonly HEARTBEAT_INTERVAL_MS = 30_000;
  private static readonly HEARTBEAT_JITTER_MS = 5_000;
  private static readonly PONG_TIMEOUT_MS = 6_000;

  constructor(private options: KookWSOptions) {
    this.compress = options.compress ?? true;
  }

  async start(): Promise<void> {
    this.stopped = false;

    // Listen for abort
    if (this.options.abortSignal) {
      this.options.abortSignal.addEventListener("abort", () => {
        this.stop();
      }, { once: true });
    }

    await this.connectFresh();
  }

  stop(): void {
    this.stopped = true;
    this.clearHeartbeat();
    this.clearPongTimeout();
    if (this.ws) {
      try { this.ws.close(1000); } catch {}
      this.ws = null;
    }
    this.options.onDisconnected?.();
  }

  private async connectFresh(): Promise<void> {
    if (this.stopped) return;

    try {
      const { url } = await this.options.client.getGateway(this.compress ? 1 : 0);
      this.options.log("kook ws: gateway URL obtained");
      await this.connect(url);
    } catch (err) {
      this.options.error("kook ws: failed to get gateway", err);
      if (!this.stopped) {
        await this.reconnectWithBackoff();
      }
    }
  }

  private connect(url: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.stopped) { resolve(); return; }

      const ws = new WebSocket(url);
      this.ws = ws;

      const helloTimeout = setTimeout(() => {
        this.options.error("kook ws: HELLO timeout (6s)");
        ws.close();
        reject(new Error("HELLO timeout"));
      }, 6000);

      ws.on("open", () => {
        this.options.log("kook ws: connection opened, waiting for HELLO");
      });

      ws.on("message", async (data: WebSocket.RawData) => {
        try {
          const signal = await this.parseMessage(data);
          if (!signal) return;

          if (signal.s === SIGNAL.HELLO) {
            clearTimeout(helloTimeout);
            const hello = signal.d as KookHelloData;
            if (hello.code === HELLO_CODE.SUCCESS) {
              this.sessionId = hello.session_id ?? null;
              this.reconnectAttempts = 0;
              this.startHeartbeat();
              this.options.log(`kook ws: HELLO success, session=${this.sessionId}`);
              this.options.onConnected?.();
              resolve();
            } else {
              this.options.error(`kook ws: HELLO failed with code ${hello.code}`);
              ws.close();
              reject(new Error(`HELLO code ${hello.code}`));
            }
            return;
          }

          this.handleSignal(signal);
        } catch (err) {
          this.options.error("kook ws: message parse error", err);
        }
      });

      ws.on("close", (code, reason) => {
        this.options.log(`kook ws: closed (code=${code}, reason=${reason.toString()})`);
        clearTimeout(helloTimeout);
        this.clearHeartbeat();
        this.clearPongTimeout();
        if (!this.stopped) {
          this.reconnectWithBackoff();
        }
      });

      ws.on("error", (err) => {
        this.options.error("kook ws: error", err);
        this.options.onError?.(err);
      });
    });
  }

  private async parseMessage(data: WebSocket.RawData): Promise<KookWSSignal | null> {
    let text: string;

    if (this.compress && Buffer.isBuffer(data)) {
      try {
        const decompressed = await inflateAsync(data);
        text = decompressed.toString("utf-8");
      } catch {
        // Not compressed, try as plain text
        text = data.toString("utf-8");
      }
    } else if (Buffer.isBuffer(data)) {
      text = data.toString("utf-8");
    } else if (data instanceof ArrayBuffer) {
      text = Buffer.from(data).toString("utf-8");
    } else {
      // Array of Buffers
      text = Buffer.concat(data as Buffer[]).toString("utf-8");
    }

    try {
      return JSON.parse(text) as KookWSSignal;
    } catch {
      this.options.error("kook ws: failed to parse JSON");
      return null;
    }
  }

  private handleSignal(signal: KookWSSignal): void {
    switch (signal.s) {
      case SIGNAL.EVENT:
        this.handleEvent(signal);
        break;
      case SIGNAL.PONG:
        this.handlePong();
        break;
      case SIGNAL.RECONNECT:
        this.options.log("kook ws: received RECONNECT signal");
        this.handleReconnect();
        break;
      case SIGNAL.RESUME_ACK:
        this.options.log("kook ws: RESUME_ACK received");
        this.handleResumeAck(signal.d as { session_id: string });
        break;
      default:
        this.options.log(`kook ws: unhandled signal s=${signal.s}`);
    }
  }

  private handleEvent(signal: KookWSSignal): void {
    const sn = signal.sn;
    if (sn === undefined) return;

    // Process in order
    if (sn === this.lastSn + 1) {
      this.lastSn = sn;
      this.dispatchEvent(signal.d as KookEventData);
      this.processEventBuffer();
    } else if (sn > this.lastSn + 1) {
      // Out of order, buffer it
      this.buffer.set(sn, signal);
      this.options.log(`kook ws: buffered out-of-order event sn=${sn} (expected ${this.lastSn + 1})`);
    }
    // else sn <= lastSn: duplicate, ignore
  }

  private processEventBuffer(): void {
    while (true) {
      const next = this.buffer.get(this.lastSn + 1);
      if (!next) break;
      this.buffer.delete(this.lastSn + 1);
      this.lastSn++;
      this.dispatchEvent(next.d as KookEventData);
    }
  }

  private dispatchEvent(event: KookEventData): void {
    try {
      this.options.onEvent(event);
    } catch (err) {
      this.options.error("kook ws: event handler error", err);
    }
  }

  // ---- Heartbeat ----

  private startHeartbeat(): void {
    this.clearHeartbeat();
    const jitter = Math.floor(Math.random() * KookWSClient.HEARTBEAT_JITTER_MS * 2) - KookWSClient.HEARTBEAT_JITTER_MS;
    const interval = KookWSClient.HEARTBEAT_INTERVAL_MS + jitter;

    this.heartbeatTimer = setInterval(() => {
      this.sendPing();
    }, interval);
  }

  private sendPing(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    try {
      // KOOK PING format: { "s": 2, "sn": <last_received_sn> }
      this.ws.send(JSON.stringify({ s: SIGNAL.PING, sn: this.lastSn }));
    } catch (err) {
      this.options.error("kook ws: failed to send PING", err);
    }

    // Set PONG timeout
    this.clearPongTimeout();
    this.pongTimeout = setTimeout(() => {
      this.options.log("kook ws: PONG timeout, attempting recovery");
      this.attemptRecovery();
    }, KookWSClient.PONG_TIMEOUT_MS);
  }

  private handlePong(): void {
    this.clearPongTimeout();
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearPongTimeout(): void {
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  // ---- Recovery ----

  private async attemptRecovery(): Promise<void> {
    this.clearHeartbeat();
    this.clearPongTimeout();

    // Step 1: Send PING twice more (2s, 4s intervals)
    for (let i = 0; i < 2; i++) {
      if (this.stopped) return;
      await sleep((i + 1) * 2000);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.sendPing();
        await sleep(KookWSClient.PONG_TIMEOUT_MS);
        if (this.pongTimeout === null) {
          // PONG received, recovery successful
          this.options.log("kook ws: recovery successful via extra PING");
          this.startHeartbeat();
          return;
        }
        this.clearPongTimeout();
      }
    }

    // Step 2: Try RESUME twice (8s, 16s intervals)
    for (let i = 0; i < 2; i++) {
      if (this.stopped) return;
      await sleep((i + 1) * 8000);
      const resumed = await this.tryResume();
      if (resumed) {
        this.options.log("kook ws: recovery successful via RESUME");
        return;
      }
    }

    // Step 3: Full reconnect
    this.options.log("kook ws: recovery failed, full reconnect");
    this.handleReconnect();
  }

  private async tryResume(): Promise<boolean> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.sessionId) {
      return false;
    }

    try {
      this.ws.send(JSON.stringify({ s: SIGNAL.RESUME, d: { sn: this.lastSn } }));
      // Wait 6s then check if heartbeat restarted (RESUME_ACK handler restarts it)
      await sleep(6000);
      return this.heartbeatTimer !== null;
    } catch {
      return false;
    }
  }

  private handleReconnect(): void {
    // Full reset
    this.lastSn = 0;
    this.sessionId = null;
    this.buffer.clear();
    if (this.ws) {
      try { this.ws.close(1000); } catch {}
      this.ws = null;
    }
    this.clearHeartbeat();
    this.clearPongTimeout();

    if (!this.stopped) {
      this.connectFresh();
    }
  }

  private handleResumeAck(d: { session_id: string }): void {
    this.sessionId = d.session_id;
    this.startHeartbeat();
  }

  private async reconnectWithBackoff(): Promise<void> {
    if (this.stopped) return;

    this.reconnectAttempts++;
    const backoff = Math.min(60_000, 1000 * Math.pow(2, this.reconnectAttempts - 1));
    this.options.log(`kook ws: reconnecting in ${backoff}ms (attempt ${this.reconnectAttempts})`);
    await sleep(backoff);

    if (!this.stopped) {
      await this.connectFresh();
    }
  }
}
