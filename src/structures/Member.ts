import { Base } from './Base.js';
import type { Client } from '../client/Client.js';
import type { RawMember } from '../types.js';

export class Member extends Base<RawMember> {
  userId!: string;
  serverId: string;
  username?: string;
  nickname: string | null = null;
  roleIds: string[] = [];
  timeoutUntil: Date | null = null;

  constructor(client: Client, raw: RawMember, serverId: string) {
    super(client, raw);
    this.serverId = serverId;
    this.patch(raw);
  }

  patch(raw: RawMember) {
    this.raw = raw;
    this.userId = (raw.user_id ?? raw.id) as string;
    this.username = raw.username;
    this.nickname = raw.nickname ?? null;
    this.roleIds = raw.role_ids ?? [];
    this.timeoutUntil = raw.timeout_until ? new Date(raw.timeout_until) : null;
    return this;
  }

  get displayName() { return this.nickname || (this.raw.display_name as string) || this.username || this.userId; }
  get mention() { return `<@${this.userId}>`; }
  toString() { return this.mention; }

  private get base() { return `/servers/${this.serverId}`; }

  kick() { return this.client.rest.post(`${this.base}/kick`, { user_id: this.userId }); }
  ban() { return this.client.rest.post(`${this.base}/bans`, { user_id: this.userId }); }
  unban() { return this.client.rest.delete(`${this.base}/bans/${this.userId}`); }
  /** Time out for `minutes` (0 clears it). */
  timeout(minutes: number, reason = '') { return this.client.rest.post(`${this.base}/timeouts`, { user_id: this.userId, minutes, reason }); }

  async addRole(roleId: string) {
    await this.client.rest.put(`${this.base}/members/${this.userId}/roles/${roleId}`);
    if (!this.roleIds.includes(roleId)) this.roleIds.push(roleId);
  }
  async removeRole(roleId: string) {
    await this.client.rest.delete(`${this.base}/members/${this.userId}/roles/${roleId}`);
    this.roleIds = this.roleIds.filter((r) => r !== roleId);
  }
  /** '' clears the nickname. */
  async setNickname(nickname: string) {
    await this.client.rest.patch(`${this.base}/members/${this.userId}`, { nickname });
    this.nickname = nickname || null;
  }
  hasRole(roleId: string) { return this.roleIds.includes(roleId); }
}
