import { Base } from './Base.js';
import type { Client } from '../client/Client.js';
import type { Buildable, RawInteraction } from '../types.js';

export interface InteractionReplyOptions { embeds?: Buildable | Buildable[]; components?: Buildable | Buildable[] }
export interface InteractionUpdate { content?: string | null; embeds?: Buildable | Buildable[] | null; components?: Buildable | Buildable[] | null }

/**
 * A button click. Answer within 3 seconds or the person sees "This interaction failed";
 * after that you have 15 minutes for further answers.
 */
export class ButtonInteraction extends Base<RawInteraction> {
  id: string;
  customId: string;
  userId: string;
  username?: string;
  messageId: string;
  channelId: string;
  serverId?: string;
  private readonly token: string;

  constructor(client: Client, raw: RawInteraction) {
    super(client, raw);
    this.id = raw.id;
    this.token = raw.token;
    this.customId = raw.custom_id;
    this.userId = raw.user_id;
    this.username = raw.username;
    this.messageId = raw.message_id;
    this.channelId = raw.channel_id;
    this.serverId = raw.server_id;
  }

  get userMention() { return `<@${this.userId}>`; }

  private respond(type: 'reply' | 'ephemeral' | 'update' | 'ack', body: { content?: string | null; embeds?: unknown; components?: unknown } = {}) {
    const out: Record<string, unknown> = { type };
    if (body.content !== undefined) out.content = body.content === null ? null : String(body.content);
    if (body.embeds !== undefined) out.embeds = this.client.list(body.embeds);
    if (body.components !== undefined) out.components = this.client.list(body.components);
    return this.client.soft(this.client.rest.post(`/interactions/${this.id}/${this.token}/callback`, out));
  }

  /** A new message in the channel. */
  reply(content: string, opts: InteractionReplyOptions = {}) { return this.respond('reply', { content, ...opts }); }
  /** A message only the clicker sees (text and embeds, no buttons). */
  ephemeral(content: string, opts: InteractionReplyOptions = {}) { return this.respond('ephemeral', { content, ...opts }); }
  /** Edit the message the button is on. Left out = kept, null = removed. */
  update(changes: InteractionUpdate = {}) { return this.respond('update', changes); }
  /** Just acknowledge, so the person doesn't see an error. */
  ack() { return this.respond('ack'); }
}
