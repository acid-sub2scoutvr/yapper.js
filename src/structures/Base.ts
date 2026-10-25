import type { Client } from '../client/Client.js';

export abstract class Base<R = unknown> {
  constructor(public readonly client: Client, public raw: R) {}
  toJSON(): R { return this.raw; }
}
