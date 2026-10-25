import { Base } from './Base.js';
import { ChannelManager, MemberManager } from '../managers/index.js';
import type { Client } from '../client/Client.js';
import type { Channel } from './Channel.js';
import type { RawChannel, RawRole, RawServer } from '../types.js';

export class Server extends Base<RawServer> {
  id!: string;
  name!: string;
  iconUrl: string | null = null;
  ownerId?: string;
  readonly channels: ChannelManager;
  readonly members: MemberManager;

  constructor(client: Client, raw: RawServer) {
    super(client, raw);
    this.channels = new ChannelManager(client, this);
    this.members = new MemberManager(client, this);
    this.patch(raw);
  }

  patch(raw: RawServer) {
    this.raw = raw;
    this.id = raw.id;
    this.name = raw.name;
    this.iconUrl = raw.icon_url ?? null;
    this.ownerId = raw.owner_id;
    return this;
  }

  toString() { return this.name; }

  async fetchRoles(): Promise<RawRole[]> { return (await this.client.rest.get<{ roles: RawRole[] }>(`/servers/${this.id}/roles`)).roles; }
  kick(userId: string) { return this.client.rest.post(`/servers/${this.id}/kick`, { user_id: userId }); }
  ban(userId: string) { return this.client.rest.post(`/servers/${this.id}/bans`, { user_id: userId }); }
  unban(userId: string) { return this.client.rest.delete(`/servers/${this.id}/bans/${userId}`); }
  async fetchBans() { return (await this.client.rest.get<{ bans: unknown[] }>(`/servers/${this.id}/bans`)).bans; }

  async createChannel(name: string, opts: { kind?: 'text' | 'voice'; categoryId?: string } = {}): Promise<Channel> {
    const out = await this.client.rest.post<{ channel: RawChannel }>(`/servers/${this.id}/channels`, {
      name, kind: opts.kind ?? 'text', category_id: opts.categoryId,
    });
    return this.channels.add(out.channel);
  }
}
