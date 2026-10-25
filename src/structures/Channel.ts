import { Base } from './Base.js';
import type { Message } from './Message.js';
import type { Client } from '../client/Client.js';
import type { RawChannel, RawMessage, RawUser, SendOptions } from '../types.js';

export interface ChannelEdit {
  name?: string; categoryId?: string; private?: boolean; roleIds?: string[];
  readOnly?: boolean; postRoleIds?: string[]; slowmode?: number;
}

export class Channel extends Base<RawChannel> {
  id!: string;
  name!: string;
  type!: 'text' | 'voice';
  serverId?: string;
  position?: number;
  private = false;
  readOnly = false;
  slowmode = 0;

  constructor(client: Client, raw: RawChannel, serverId?: string) {
    super(client, raw);
    this.patch(raw, serverId);
  }

  patch(raw: RawChannel, serverId?: string) {
    this.raw = raw;
    this.id = raw.id;
    this.name = raw.name;
    this.type = raw.type;
    this.serverId = raw.server_id ?? serverId ?? this.serverId;
    this.position = raw.position;
    this.private = !!raw.private;
    this.readOnly = !!raw.read_only;
    this.slowmode = raw.slowmode ?? 0;
    return this;
  }

  isText() { return this.type === 'text'; }
  isVoice() { return this.type === 'voice'; }
  toString() { return this.name; }

  send(content: string, opts: SendOptions = {}): Promise<Message> { return this.client.send(this.id, content, opts); }

  /** Recent messages, oldest first. */
  async fetchMessages(limit = 50): Promise<Message[]> {
    const { Message } = await import('./Message.js');
    const out = await this.client.rest.get<{ messages?: RawMessage[]; authors?: RawUser[] }>(`/channels/${this.id}/messages?limit=${limit}`);
    const authors = new Map((out.authors ?? []).map((a) => [a.id, a]));
    return (out.messages ?? []).map((m) => new Message(this.client, { ...m, author: authors.get(m.author_id) ?? null }));
  }

  async edit(changes: ChannelEdit): Promise<this> {
    const { name, categoryId, private: priv, roleIds, readOnly, postRoleIds, slowmode } = changes;
    const out = await this.client.rest.patch<{ channel: RawChannel }>(`/channels/${this.id}`, {
      name, category_id: categoryId, private: priv, role_ids: roleIds, read_only: readOnly, post_role_ids: postRoleIds, slowmode,
    });
    return this.patch(out.channel) as this;
  }

  async delete(): Promise<void> {
    await this.client.rest.delete(`/channels/${this.id}`);
    this.client.channels.cache.delete(this.id);
  }

  /** Delete up to 100 messages at once (Manage messages for other people's). */
  bulkDelete(messageIds: string[]) {
    return this.client.rest.post<{ deleted: number; skipped: number }>(`/channels/${this.id}/messages/bulk-delete`, { ids: messageIds });
  }
}
