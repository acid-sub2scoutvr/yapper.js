import { sleep } from '../util.js';

export class YapperAPIError extends Error {
  constructor(message: string, public readonly status: number, public readonly retryAfter?: number) {
    super(message);
    this.name = 'YapperAPIError';
  }
}

export interface RESTOptions {
  base?: string;
  /** Per-request timeout in ms (default 30000). */
  timeout?: number;
  /** How many times to retry a 429 / busy 503 (default 3). */
  retries?: number;
  onRateLimit?: (info: { method: string; path: string; waitSeconds: number }) => void;
}

export interface RequestOptions { timeout?: number; retries?: number }

export const DEFAULT_BASE = 'https://www.yapin.gg/api/bot/v1';

export class REST {
  readonly base: string;
  private readonly timeout: number;
  private readonly retries: number;

  constructor(private readonly token: string, private readonly opts: RESTOptions = {}) {
    this.base = (opts.base ?? DEFAULT_BASE).replace(/\/$/, '');
    this.timeout = opts.timeout ?? 30_000;
    this.retries = opts.retries ?? 3;
  }

  async request<T = any>(method: string, path: string, body?: unknown, o: RequestOptions = {}): Promise<T> {
    const retries = o.retries ?? this.retries;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(this.base + path, {
        method,
        headers: { authorization: `Bot ${this.token}`, 'content-type': 'application/json', 'user-agent': 'yapper.js-unofficial/1' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(o.timeout ?? this.timeout),
      });
      const out = (await res.json().catch(() => ({}))) as any;
      if (res.ok) return out as T;

      // 429, or a 503 that says when to come back: nothing was done, so waiting and retrying is safe.
      const busy = res.status === 503 && typeof out.retry_after === 'number';
      const wait = res.status === 429 || busy ? Number(res.headers.get('retry-after')) || out.retry_after || 0 : 0;
      if (wait > 0 && wait <= 60 && attempt < retries) {
        this.opts.onRateLimit?.({ method, path, waitSeconds: wait });
        await sleep(wait * 1000 * (1 + Math.random() * 0.5));
        continue;
      }
      throw new YapperAPIError(out.error || `${method} ${path} failed (${res.status})`, res.status, wait || undefined);
    }
  }

  get<T = any>(path: string, o?: RequestOptions) { return this.request<T>('GET', path, undefined, o); }
  post<T = any>(path: string, body?: unknown) { return this.request<T>('POST', path, body); }
  put<T = any>(path: string, body?: unknown) { return this.request<T>('PUT', path, body); }
  patch<T = any>(path: string, body?: unknown) { return this.request<T>('PATCH', path, body); }
  delete<T = any>(path: string) { return this.request<T>('DELETE', path); }

  /** PUT raw image bytes (avatar / banner). */
  async upload<T = any>(path: string, bytes: Uint8Array | ArrayBuffer, contentType: string): Promise<T> {
    const res = await fetch(this.base + path, {
      method: 'PUT',
      headers: { authorization: `Bot ${this.token}`, 'content-type': contentType, 'user-agent': 'yapper.js-unofficial/1' },
      body: bytes as unknown as ArrayBuffer,
    });
    const out = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) throw new YapperAPIError(out.error || `upload failed (${res.status})`, res.status);
    return out as T;
  }
}
