export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Wait before retry n (1, 2, ...): 1s, 2s, 4s ... capped at 30s, with jitter. */
export const backoff = (n: number) => Math.min(30_000, 1000 * 2 ** (n - 1)) * (0.75 + Math.random() * 0.5);

const plain = (x: any) => (x && typeof x.toJSON === 'function' ? x.toJSON() : x);

/** undefined stays undefined, null stays null, a single item or array becomes an array of plain objects. */
export function serializeList(v: unknown): unknown[] | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return ([] as unknown[]).concat(v).map(plain);
}

/**
 * Makes fire-and-forget calls safe: `msg.reply('hi')` without await would otherwise crash Node on a
 * failed request. If nobody awaits or catches the promise, the error goes to `report` instead.
 */
export function soft<T>(p: Promise<T>, report: (e: unknown) => void): Promise<T> {
  let used = false;
  p.catch((e) => { if (!used) report(e); });
  const use = () => { used = true; return p; };
  return {
    then: (a?: any, b?: any) => use().then(a, b),
    catch: (b?: any) => use().catch(b),
    finally: (f?: any) => use().finally(f),
    [Symbol.toStringTag]: 'Promise',
  } as Promise<T>;
}

export class Collection<K, V> extends Map<K, V> {
  first(): V | undefined { return this.values().next().value; }
  find(fn: (v: V, k: K) => boolean): V | undefined { for (const [k, v] of this) if (fn(v, k)) return v; return undefined; }
  filter(fn: (v: V, k: K) => boolean): Collection<K, V> {
    const out = new Collection<K, V>();
    for (const [k, v] of this) if (fn(v, k)) out.set(k, v);
    return out;
  }
  map<T>(fn: (v: V, k: K) => T): T[] { return [...this].map(([k, v]) => fn(v, k)); }
}
