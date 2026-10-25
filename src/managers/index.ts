import { Collection } from '../util.js';
import { Channel } from '../structures/Channel.js';
import { Member } from '../structures/Member.js';
import { Server } from '../structures/Server.js';
import { User } from '../structures/User.js';
import type { Client } from '../client/Client.js';
import type { RawChannel, RawMember, RawServer, RawUser } from '../types.js';

/** Cached users: `client.users.fetch(id)`. */
export class UserManager {
  readonly cache = new Collection<string, User>();
  constructor(private readonly client: Client) {}

  add(raw: RawUser): User {
    const hit = this.cache.get(raw.id);
    if (hit) return hit.patch(raw);
    const user = new User(this.client, raw);
    this.cache.set(user.id, user);
    return user;
  }

  /** Cached copy unless `force`; null if the user can't be found. */
  async fetch(id: string, force = false): Promise<User | null> {
    if (!force && this.cache.has(id)) return this.cache.get(id)!;
    try { return this.add((await this.client.rest.get<{ user: RawUser }>(`/users/${id}`)).user); } catch { return null; }
  }
}

/** Servers the bot is in: `client.servers.fetchAll()`. */
export class ServerManager {
  readonly cache = new Collection<string, Server>();
  constructor(private readonly client: Client) {}

  add(raw: RawServer): Server {
    const hit = this.cache.get(raw.id);
    if (hit) return hit.patch(raw);
    const server = new Server(this.client, raw);
    this.cache.set(server.id, server);
    return server;
  }

  async fetch(id: string, force = false): Promise<Server | null> {
    if (!force && this.cache.has(id)) return this.cache.get(id)!;
    try { return this.add((await this.client.rest.get<{ server: RawServer }>(`/servers/${id}`)).server); } catch { return null; }
  }

  async fetchAll(): Promise<Collection<string, Server>> {
    const out = await this.client.rest.get<{ servers: RawServer[] }>('/servers');
    return new Collection(out.servers.map((s) => [s.id, this.add(s)] as const));
  }
}

/** Channels: `client.channels` (any server) or `server.channels` (one server). */
export class ChannelManager {
  readonly cache = new Collection<string, Channel>();
  constructor(private readonly client: Client, private readonly server?: Server) {}

  add(raw: RawChannel): Channel {
    const serverId = this.server?.id;
    // A server's channels are also findable from client.channels.
    const store = this.server ? this.client.channels.cache : this.cache;
    const hit = store.get(raw.id);
    const channel = hit ? hit.patch(raw, serverId) : new Channel(this.client, raw, serverId);
    store.set(channel.id, channel);
    if (this.server) this.cache.set(channel.id, channel);
    return channel;
  }

  /** Null if the bot can't see it. */
  async fetch(id: string, force = false): Promise<Channel | null> {
    const cached = (this.server ? this.client.channels.cache : this.cache).get(id);
    if (!force && cached) return cached;
    try { return this.add((await this.client.rest.get<{ channel: RawChannel }>(`/channels/${id}`)).channel); } catch { return null; }
  }

  /** All channels the bot can see: in this server, or in every server for `client.channels`. */
  async fetchAll(opts: { type?: 'text' | 'voice' } = {}): Promise<Collection<string, Channel>> {
    const q = opts.type ? `?type=${encodeURIComponent(opts.type)}` : '';
    const path = this.server ? `/servers/${this.server.id}/channels${q}` : `/channels${q}`;
    const out = await this.client.rest.get<{ channels: RawChannel[] }>(path);
    return new Collection(out.channels.map((c) => [c.id, this.add(c)] as const));
  }
}

/** Members of one server: `server.members.fetch(userId)`. */
export class MemberManager {
  readonly cache = new Collection<string, Member>();
  constructor(private readonly client: Client, private readonly server: Server) {}

  add(raw: RawMember): Member {
    const id = (raw.user_id ?? raw.id) as string;
    const hit = this.cache.get(id);
    if (hit) return hit.patch(raw);
    const member = new Member(this.client, raw, this.server.id);
    this.cache.set(id, member);
    return member;
  }

  async fetch(userId: string, force = false): Promise<Member | null> {
    if (!force && this.cache.has(userId)) return this.cache.get(userId)!;
    try { return this.add((await this.client.rest.get<{ member: RawMember }>(`/servers/${this.server.id}/members/${userId}`)).member); } catch { return null; }
  }

  /** Every member, 200 per request. */
  async fetchAll(): Promise<Collection<string, Member>> {
    let after: string | undefined;
    for (;;) {
      const page = (await this.client.rest.get<{ members: RawMember[] }>(`/servers/${this.server.id}/members?limit=200${after ? `&after=${after}` : ''}`)).members;
      for (const raw of page) this.add(raw);
      if (page.length < 200) break;
      const last = page[page.length - 1];
      after = (last.user_id ?? last.id) as string;
    }
    return this.cache;
  }
}
