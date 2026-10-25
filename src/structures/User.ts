import { Base } from './Base.js';
import type { Message } from './Message.js';
import type { RawUser, SendOptions } from '../types.js';

export class User extends Base<RawUser> {
  id!: string;
  username!: string;
  displayName!: string;
  avatarUrl: string | null = null;
  bio: string | null = null;
  bot = false;

  constructor(client: import('../client/Client.js').Client, raw: RawUser) {
    super(client, raw);
    this.patch(raw);
  }

  patch(raw: RawUser) {
    this.raw = raw;
    this.id = raw.id;
    this.username = raw.username;
    this.displayName = raw.display_name || raw.username;
    this.avatarUrl = raw.avatar_url ?? null;
    this.bio = raw.bio ?? null;
    this.bot = !!raw.bot;
    return this;
  }

  /** `<@id>`: pings the user when sent in a message. */
  get mention() { return `<@${this.id}>`; }
  toString() { return this.mention; }

  /** Open a DM and return its channel id (the user must allow DMs from the bot). */
  async createDM(): Promise<string> {
    return (await this.client.rest.post<{ channel_id: string }>(`/users/${this.id}/dm`)).channel_id;
  }

  /** Open a DM and send one message in it. */
  async send(content: string, opts: SendOptions = {}): Promise<Message> {
    return this.client.send(await this.createDM(), content, opts);
  }
}
