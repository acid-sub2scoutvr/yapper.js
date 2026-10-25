import type { Serializable } from '../types.js';

const NAMED_COLORS: Record<string, number> = {
  red: 0xed4245, green: 0x57f287, blue: 0x5865f2, yellow: 0xfee75c,
  purple: 0x9b59b6, orange: 0xe67e22, grey: 0x95a5a6, gray: 0x95a5a6,
};
const toColor = (c: number | string) =>
  typeof c === 'number' ? c : NAMED_COLORS[c.toLowerCase()] ?? parseInt(c.replace('#', ''), 16);

/**
 * An embed card. Every setter returns the embed so calls chain:
 *   new Embed().setTitle('Score').setDescription('**3** wins').setColor('#57f287').addField('Kills', '12', true)
 */
export class Embed implements Serializable {
  data: Record<string, unknown> = {};
  constructor(data: Record<string, unknown> = {}) { this.data = { ...data }; }
  setTitle(t: string) { this.data.title = String(t); return this; }
  setDescription(t: string) { this.data.description = String(t); return this; }
  setURL(u: string) { this.data.url = String(u); return this; }
  /** '#5865f2', 0x5865f2, or red | green | blue | yellow | purple | orange | grey. */
  setColor(c: number | string) { this.data.color = toColor(c); return this; }
  addField(name: string, value: string, inline = false) {
    ((this.data.fields ||= []) as unknown[]).push({ name: String(name), value: String(value), inline });
    return this;
  }
  setAuthor(name: string, opts: { url?: string; icon?: string } = {}) { this.data.author = { name, url: opts.url, icon_url: opts.icon }; return this; }
  setFooter(text: string, icon?: string) { this.data.footer = { text, icon_url: icon }; return this; }
  setThumbnail(url: string) { this.data.thumbnail = { url }; return this; }
  setImage(url: string) { this.data.image = { url }; return this; }
  setTimestamp(t: Date | number | string = new Date()) { this.data.timestamp = new Date(t).toISOString(); return this; }
  toJSON() { return this.data; }
}

export type ButtonStyle = 'primary' | 'secondary' | 'success' | 'danger' | 'link';

/** A button: `Button.success('Yes', 'vote:yes')` or `Button.link('Rules', 'https://…')`. */
export class Button implements Serializable {
  data: Record<string, unknown>;
  constructor(data: Record<string, unknown> = {}) { this.data = { type: 'button', style: 'secondary', ...data }; }
  static primary(label: string, customId: string) { return new Button({ style: 'primary', label, custom_id: customId }); }
  static secondary(label: string, customId: string) { return new Button({ style: 'secondary', label, custom_id: customId }); }
  static success(label: string, customId: string) { return new Button({ style: 'success', label, custom_id: customId }); }
  static danger(label: string, customId: string) { return new Button({ style: 'danger', label, custom_id: customId }); }
  static link(label: string, url: string) { return new Button({ style: 'link', label, url }); }
  setStyle(s: ButtonStyle) { this.data.style = s; return this; }
  setLabel(t: string) { this.data.label = t; return this; }
  setEmoji(e: string) { this.data.emoji = e; return this; }
  setCustomId(id: string) { this.data.custom_id = id; return this; }
  setDisabled(on = true) { this.data.disabled = on; return this; }
  toJSON() { return this.data; }
}

/** A row of up to 5 buttons. */
export class Row implements Serializable {
  buttons: Serializable[];
  constructor(...buttons: (Serializable | Serializable[])[]) { this.buttons = buttons.flat(); }
  add(...buttons: Serializable[]) { this.buttons.push(...buttons); return this; }
  toJSON() { return { type: 'row', components: this.buttons.map((b) => b.toJSON()) }; }
}
