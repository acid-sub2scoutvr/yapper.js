import { Base } from './Base.js';
import { User } from './User.js';
import type { Client } from '../client/Client.js';
import type { Channel } from './Channel.js';
import type { Server } from './Server.js';
import type { Member } from './Member.js';
import type { EditOptions, RawMessage, SendOptions } from '../types.js';

export class Message extends Base<RawMessage> {
  id!: string;
  content!: string;
  channelId!: string;
  serverId?: string;
  author!: User;
  /** True when a bot or webhook sent it. */
  fromBot = false;
  /** True when the message mentions this bot (when the API says so). */
  mentioned = false;
  /** Set when a command matched. */
  command?: string;
  /** Everything after the command name. */
  args = '';
  /** `args` split on whitespace. */
  argv: string[] = [];

  constructor(client: Client, raw: RawMessage) {
    super(client, raw);
    this.id = raw.id;
    this.content = raw.content ?? '';
    this.channelId = raw.channel_id;
    this.serverId = raw.server_id;
    this.fromBot = !!raw.author_bot;
    this.mentioned = !!raw.mentioned;
    this.author = new User(client, raw.author ?? { id: raw.author_id, username: String(raw.author_username ?? 'unknown') });
  }

  /** Cached channel, if the client has seen it. Use fetchChannel() otherwise. */
  get channel(): Channel | undefined { return this.client.channels.cache.get(this.channelId); }
  get server(): Server | undefined { return this.serverId ? this.client.servers.cache.get(this.serverId) : undefined; }

  fetchChannel(): Promise<Channel | null> { return this.client.channels.fetch(this.channelId); }
  async fetchServer(): Promise<Server | null> {
    const serverId = this.serverId ?? (await this.fetchChannel())?.serverId;
    return serverId ? this.client.servers.fetch(serverId) : null;
  }
  /** The author as a server member (null in DMs or if not found). */
  async fetchMember(): Promise<Member | null> {
    const server = await this.fetchServer();
    return server ? server.members.fetch(this.author.id) : null;
  }

  /** Reply (quoted). */
  reply(content: string, opts: SendOptions = {}) { return this.client.send(this.channelId, content, { ...opts, replyTo: this.id }); }
  /** Post in the same channel without quoting. */
  say(content: string, opts: SendOptions = {}) { return this.client.send(this.channelId, content, opts); }

  async edit(content?: string | null, opts: EditOptions = {}): Promise<this> {
    const body: Record<string, unknown> = {};
    if (content != null) body.content = content;
    if (opts.embeds !== undefined) body.embeds = this.client.list(opts.embeds);
    if (opts.components !== undefined) body.components = this.client.list(opts.components);
    const out = await this.client.rest.patch<{ message: RawMessage }>(`/channels/${this.channelId}/messages/${this.id}`, body);
    if (typeof out.message?.content === 'string') this.content = out.message.content;
    return this;
  }
  delete() { return this.client.rest.delete(`/channels/${this.channelId}/messages/${this.id}`); }
  react(emoji: string) { return this.client.soft(this.client.rest.put(`/channels/${this.channelId}/messages/${this.id}/reactions/${encodeURIComponent(emoji)}`)); }
  unreact(emoji: string) { return this.client.rest.delete(`/channels/${this.channelId}/messages/${this.id}/reactions/${encodeURIComponent(emoji)}`); }
  pin() { return this.client.rest.put(`/channels/${this.channelId}/messages/${this.id}/pin`); }
  unpin() { return this.client.rest.delete(`/channels/${this.channelId}/messages/${this.id}/pin`); }
}
