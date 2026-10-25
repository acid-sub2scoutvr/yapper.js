import type { RawEvent } from '../types.js';

/** ok: was up a while, reconnect. disabled: gateway not on for this bot (use long polling). */
export type SessionResult = 'ok' | 'disabled' | 'bad_token' | 'failed';

export interface GatewayOptions {
  url: string;
  token: string;
  /** Last event id handled; sent on connect so nothing is missed between sessions. */
  seq: () => number;
  onEvent: (ev: RawEvent) => Promise<void>;
  onReady?: () => void;
}

export interface GatewaySession {
  result: Promise<SessionResult>;
  close(): void;
}

export const hasWebSocket = () => typeof (globalThis as any).WebSocket === 'function';

/**
 * One WebSocket session: waits for `hello`, resumes from `seq`, heartbeats, and hands each event
 * to `onEvent` one at a time, in order. Resolves when the socket is done.
 */
export function connectGateway(o: GatewayOptions): GatewaySession {
  let ws: any;
  const result = new Promise<SessionResult>((resolve) => {
    try { ws = new (globalThis as any).WebSocket(o.url); } catch { resolve('failed'); return; }

    let readyAt = 0;
    let beat: ReturnType<typeof setInterval> | undefined;
    let acked = true;
    let over = false;
    let chain: Promise<void> = Promise.resolve();

    const finish = (r: SessionResult) => {
      if (over) return;
      over = true;
      ws.onmessage = ws.onerror = ws.onclose = null;
      clearInterval(beat);
      clearTimeout(slow);
      chain.then(() => resolve(r));
    };
    const closeQuietly = (code: number, reason: string) => { try { ws.close(code, reason); } catch { /* already closed */ } };

    // A socket that never reaches `ready` must not hold the bot up.
    const slow = setTimeout(() => { finish('failed'); closeQuietly(4000, 'no ready'); }, 15_000);

    ws.onmessage = (m: { data: unknown }) => {
      let msg: any;
      try { msg = JSON.parse(typeof m.data === 'string' ? m.data : String(m.data)); } catch { return; }
      switch (msg.op) {
        case 'hello':
          ws.send(JSON.stringify({ op: 'resume', token: o.token, seq: o.seq() }));
          break;
        case 'ready':
          readyAt = Date.now();
          clearTimeout(slow);
          o.onReady?.();
          beat = setInterval(() => {
            if (!acked) { finish('ok'); closeQuietly(4000, 'no heartbeat ack'); return; } // dead connection
            acked = false;
            ws.send(JSON.stringify({ op: 'heartbeat' }));
          }, msg.heartbeat_interval || 30_000);
          break;
        case 'heartbeat_ack':
          acked = true;
          break;
        case 'event':
          if (msg.d) chain = chain.then(() => o.onEvent(msg.d as RawEvent)).catch(() => {});
          break;
      }
    };
    // Node's WebSocket fires only `error` (no `close`) when it can't connect at all.
    ws.onerror = () => { if (!readyAt) finish('failed'); };
    ws.onclose = (e: { code: number }) =>
      finish(e.code === 4004 ? 'bad_token' : e.code === 4003 ? 'disabled' : readyAt && Date.now() - readyAt > 10_000 ? 'ok' : 'failed');
  });
  return { result, close: () => { try { ws?.close(1000); } catch { /* already closed */ } } };
}
