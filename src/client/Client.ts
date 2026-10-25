import { EventEmitter } from 'node:events';
import { REST, YapperAPIError, DEFAULT_BASE } from '../rest/REST.js';
import { connectGateway, hasWebSocket, type GatewaySession } from '../gateway/Gateway.js';
import { ChannelManager, ServerManager, UserManager } from '../managers/index.js';
import { ButtonInteraction } from '../structures/Interaction.js';
import { Message } from '../structures/Message.js';
import { User } from '../structures/User.js';
import { backoff, serializeList, sleep, soft } from '../util.js';
import type { EditOptions, GatewayPayload, RawEvent, RawInteraction, RawMessage, RawUser, SendOptions } from '../types.js';

export const DEFAULT_GATEWAY = 'wss://rt.yapper.website/bot';
const COMMAND_LIMIT = 100;

export interface ClientOptions {
  /** REST base URL. */
  base?: string;
  /** WebSocket gateway URL, or false to always long-poll. Needs a runtime with built-in WebSocket (Node 22+, Bun, Deno). */
  gateway?: string | false;
  /** Text prefixes that trigger commands (default ['/', '!']). */
  prefixes?: string[];
  /** Skip messages from other bots and webhooks (default true) so two bots can't loop forever. */
  ignoreBots?: boolean;
  /** Log connection info to the console (default true). */
  log?: boolean;
}

export interface CommandOptions {
  description?: string;
  /** Seconds a user must wait between uses of this command. */
  cooldown?: number;
  /** Return false to skip the command for this message. */
  check?: (msg: Message) => boolean | Promise<boolean>;
  run: (msg: Message) => unknown;
}

interface RegisteredCommand extends CommandOptions { description: string }

export interface ClientEvents {
  ready: [user: User];
  messageCreate: [message: Message];
  commandRun: [message: Message];
  commandCooldown: [message: Message, remainingMs: number];
  interactionCreate: [interaction: ButtonInteraction];
  memberAdd: [event: GatewayPayload];
  memberRemove: [event: GatewayPayload];
  reactionAdd: [event: GatewayPayload];
  reactionRemove: [event: GatewayPayload];
  voiceJoin: [event: GatewayPayload];
  voiceLeave: [event: GatewayPayload];
  /** Every event exactly as the API sent it. */
  raw: [event: RawEvent];
  error: [error: Error];
}

const EVENT_NAMES: Record<string, keyof ClientEvents> = {
  member_join: 'memberAdd',
  member_leave: 'memberRemove',
  reaction_add: 'reactionAdd',
  reaction_remove: 'reactionRemove',
  voice_join: 'voiceJoin',
  voice_leave: 'voiceLeave',
};

// Typed on/once/off, merged into the class below.
export interface Client {
  on<K extends keyof ClientEvents>(event: K, listener: (...args: ClientEvents[K]) => unknown): this;
  once<K extends keyof ClientEvents>(event: K, listener: (...args: ClientEvents[K]) => unknown): this;
  off<K extends keyof ClientEvents>(event: K, listener: (...args: ClientEvents[K]) => unknown): this;
}

export class Client extends EventEmitter {
  readonly options: Required<Omit<ClientOptions, 'gateway'>> & { gateway: string | false };
  rest!: REST;
  /** The bot's own account, set after login(). */
  user!: User;
  readonly users = new UserManager(this);
  readonly servers = new ServerManager(this);
  readonly channels = new ChannelManager(this);
  readonly commands = new Map<string, RegisteredCommand>();

  private token = '';
  private running = false;
  private cursor = 0;
  private registered = false;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private session?: GatewaySession;
  private loop?: Promise<void>;
  private readonly buttons: { match: string | RegExp; fn: (i: ButtonInteraction) => unknown }[] = [];
  private readonly cooldowns = new Map<string, number>();

  constructor(options: ClientOptions = {}) {
    super();
    this.options = {
      base: options.base ?? DEFAULT_BASE,
      gateway: options.gateway === undefined ? DEFAULT_GATEWAY : options.gateway,
      prefixes: options.prefixes ?? ['/', '!'],
      ignoreBots: options.ignoreBots !== false,
      log: options.log !== false,
    };
  }

  // ---- commands & buttons ----

  /** Register a command. People type /name or !name, and the composer suggests it. */
  command(name: string, description: string, run: CommandOptions['run']): this;
  command(name: string, options: CommandOptions): this;
  command(name: string, a: string | CommandOptions, b?: CommandOptions['run']): this {
    const opts: CommandOptions = typeof a === 'string' ? { description: a, run: b as CommandOptions['run'] } : a;
    const n = String(name).toLowerCase().replace(/^[/!]/, '');
    if (!/^[a-z0-9_-]{1,32}$/.test(n)) throw new Error(`Bad command name "${name}": letters, numbers, - and _ only`);
    if (typeof opts.run !== 'function') throw new Error(`Command /${n} needs a run function`);
    if (!this.commands.has(n) && this.commands.size >= COMMAND_LIMIT) throw new Error(`Up to ${COMMAND_LIMIT} commands per bot`);
    this.commands.set(n, { ...opts, description: String(opts.description ?? '').slice(0, 100) });
    this.syncSoon();
    return this;
  }

  /** Handle clicks on buttons whose custom_id equals a string or matches a RegExp. */
  onButton(match: string | RegExp, fn: (i: ButtonInteraction) => unknown): this {
    this.buttons.push({ match, fn });
    return this;
  }

  // ---- connecting ----

  /** Connects, registers commands and starts receiving events. Resolves once `ready` has fired. */
  async login(token: string | undefined = process.env.YAPPER_BOT_TOKEN): Promise<void> {
    if (!token || !token.trim().startsWith('yb_')) throw new Error('Pass your bot token (starts with yb_). Get one in Settings → Developer.');
    if (this.running) return;
    this.token = token.trim();
    this.rest = new REST(this.token, {
      base: this.options.base,
      onRateLimit: ({ method, path, waitSeconds }) => this.log(`rate limited, retrying ${method} ${path} in ${waitSeconds}s`, 'warn'),
    });
    this.running = true;

    for (let n = 1; ; n++) {
      try {
        this.user = new User(this, await this.rest.get<RawUser>('/me'));
        await this.syncCommands();
        this.registered = true;
        // Skip events from before we started.
        this.cursor = (await this.rest.get<{ last?: number }>('/events?after=0&wait=0')).last ?? 0;
        break;
      } catch (e) {
        if (e instanceof YapperAPIError && [400, 401, 403].includes(e.status)) { this.running = false; throw e; }
        await this.fail(e); // network blip or server hiccup: retry
        await sleep(backoff(n));
        if (!this.running) return;
      }
    }

    this.log(`${this.user.username} is online with ${this.commands.size} command(s)`);
    await this.emitAsync('ready', this.user);
    this.loop = this.run().catch((e) => this.fail(e));
  }

  /** Stop receiving events and close the socket. */
  async destroy(): Promise<void> {
    this.running = false;
    this.registered = false;
    this.session?.close();
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = null;
    await this.loop;
  }

  // ---- sending & helpers ----

  /** Send a message to a channel. */
  send(channelId: string, content: string, opts: SendOptions = {}): Promise<Message> {
    return this.soft(
      this.rest
        .post<{ message: RawMessage }>(`/channels/${channelId}/messages`, {
          content: String(content ?? ''),
          reply_to: opts.replyTo,
          embeds: this.list(opts.embeds),
          components: this.list(opts.components),
        })
        .then((out) => new Message(this, out.message)),
    );
  }

  /** Edit one of the bot's own messages. */
  async edit(channelId: string, messageId: string, content?: string | null, opts: EditOptions = {}) {
    const body: Record<string, unknown> = {};
    if (content != null) body.content = String(content);
    if (opts.embeds !== undefined) body.embeds = this.list(opts.embeds);
    if (opts.components !== undefined) body.components = this.list(opts.components);
    return (await this.rest.patch<{ message: RawMessage }>(`/channels/${channelId}/messages/${messageId}`, body)).message;
  }

  /** Online status and what the bot is "playing": setStatus('dnd', 'Moderating'). Status: online, idle, dnd. */
  setStatus(status: 'online' | 'idle' | 'dnd' = 'online', activity: string | null = null) {
    return this.rest.put('/me/status', { status, activity });
  }
  setProfile({ displayName, bio }: { displayName?: string; bio?: string } = {}) {
    return this.rest.patch('/me', { display_name: displayName, bio });
  }

  /** @internal Embeds / components (builders or plain objects) → plain JSON. */
  list(v: unknown) { return serializeList(v); }
  /** @internal Fire-and-forget safety: unhandled failures go to the error event instead of crashing. */
  soft<T>(p: Promise<T>): Promise<T> { return soft(p, (e) => void this.fail(e)); }

  // ---- internals ----

  private log(text: string, level: 'log' | 'warn' = 'log') {
    if (this.options.log) console[level](`[yapper.js] ${text}`);
  }

  private commandList() { return [...this.commands].map(([name, c]) => ({ name, description: c.description })); }
  private syncCommands() { return this.rest.put('/commands', { commands: this.commandList() }); }

  /** Commands added after login: send the new list once things settle. */
  private syncSoon() {
    if (!this.running || !this.registered) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      this.syncCommands().then(() => this.log(`commands updated (${this.commands.size})`), (e) => this.fail(e));
    }, 1000);
  }

  /** Listeners run one at a time, in order, and an async listener that throws goes to `error`. */
  private async emitAsync<K extends keyof ClientEvents>(event: K, ...args: ClientEvents[K]) {
    for (const fn of this.rawListeners(event)) {
      try { await (fn as (...a: unknown[]) => unknown).apply(this, args); } catch (e) {
        if (event === 'error') this.log(`error listener threw: ${(e as Error)?.message ?? e}`, 'warn');
        else await this.fail(e);
      }
    }
  }

  private async fail(e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (this.listenerCount('error')) await this.emitAsync('error', err);
    else console.error('[yapper.js]', err.message);
  }

  /** Gateway first; long polling when the gateway is off for this bot or keeps failing. */
  private async run() {
    let failures = 0;
    let gwFails = 0;
    let gwRetryAt = 0;
    while (this.running) {
      if (this.options.gateway && hasWebSocket() && Date.now() >= gwRetryAt) {
        this.session = connectGateway({
          url: this.options.gateway,
          token: this.token,
          seq: () => this.cursor,
          onEvent: (ev) => this.handleEvent(ev),
          onReady: () => this.log('connected to the gateway'),
        });
        const r = await this.session.result;
        this.session = undefined;
        if (!this.running) break;
        if (r === 'bad_token') { await this.fail(new Error('Token rejected: make a new one in Settings → Developer')); this.running = false; break; }
        if (r === 'disabled') gwRetryAt = Date.now() + 10 * 60_000;
        else if (r === 'ok') { gwFails = 0; await sleep(backoff(1)); continue; }
        else if (++gwFails >= 3) { gwFails = 0; gwRetryAt = Date.now() + 5 * 60_000; this.log('gateway unavailable, long polling for 5 minutes'); }
        else { await sleep(backoff(gwFails)); continue; }
      }
      try {
        const out = await this.rest.get<{ events?: RawEvent[]; last?: number }>(`/events?after=${this.cursor}&wait=25`, { timeout: 45_000, retries: 0 });
        failures = 0;
        for (const ev of out.events ?? []) await this.handleEvent(ev);
        // The server answers with the newest id even when there were no events.
        if (typeof out.last === 'number' && out.last > this.cursor) this.cursor = out.last;
      } catch (e) {
        failures++;
        if (e instanceof YapperAPIError && e.status === 401) { await this.fail(new Error('Token rejected: make a new one in Settings → Developer')); this.running = false; break; }
        await this.fail(e);
        await sleep(Math.max((e instanceof YapperAPIError ? e.retryAfter ?? 0 : 0) * 1000, backoff(failures)));
      }
    }
  }

  /** Each event is handled once and in order: anything at or below the cursor was already seen. */
  private async handleEvent(ev: RawEvent) {
    if (!(ev.id > this.cursor)) return;
    this.cursor = ev.id;
    try { await this.dispatch(ev); } catch (e) { await this.fail(e); }
  }

  private async dispatch(ev: RawEvent) {
    const data = ev.data ?? {};
    await this.emitAsync('raw', ev);
    if (ev.type === 'message') return this.onMessage(data as RawMessage);
    if (ev.type === 'interaction') return this.onInteraction(data as RawInteraction);
    const name = EVENT_NAMES[ev.type];
    if (name) await this.emitAsync(name as 'memberAdd', { ...data, type: ev.type });
  }

  private async onMessage(data: RawMessage) {
    if (this.options.ignoreBots && data.author_bot) return;
    const msg = new Message(this, data);
    let name = data.command;
    let args = data.args;
    // A command picked for another bot ("/fish @OtherBot") isn't ours to answer.
    const forOther = Array.isArray(data.command_for) && !data.command_for.includes(this.user?.id);
    if (!name && !forOther) {
      const content = data.content ?? '';
      for (const p of [...this.options.prefixes].sort((a, b) => b.length - a.length)) {
        if (!p || !content.startsWith(p)) continue;
        const m = /^([a-z0-9_-]{1,32})(?:\s+([\s\S]*))?$/i.exec(content.slice(p.length));
        if (m && this.commands.has(m[1].toLowerCase())) { name = m[1].toLowerCase(); args = (m[2] ?? '').trim(); break; }
      }
    }
    const cmd = name ? this.commands.get(name) : undefined;
    if (name && cmd) {
      msg.command = name;
      msg.args = args ?? '';
      msg.argv = msg.args ? msg.args.split(/\s+/) : [];
      await this.runCommand(name, cmd, msg);
    }
    await this.emitAsync('messageCreate', msg);
  }

  private async runCommand(name: string, cmd: RegisteredCommand, msg: Message) {
    if (cmd.cooldown) {
      const key = `${name}:${msg.author.id}`;
      const left = (this.cooldowns.get(key) ?? 0) - Date.now();
      if (left > 0) return this.emitAsync('commandCooldown', msg, left);
      this.cooldowns.set(key, Date.now() + cmd.cooldown * 1000);
    }
    if (cmd.check) {
      try { if ((await cmd.check(msg)) === false) return; } catch (e) { return this.fail(e); }
    }
    try { await cmd.run(msg); } catch (e) { await this.fail(e); }
    await this.emitAsync('commandRun', msg);
  }

  private async onInteraction(data: RawInteraction) {
    const i = new ButtonInteraction(this, data);
    for (const b of this.buttons) {
      const hit = b.match instanceof RegExp ? ((b.match.lastIndex = 0), b.match.test(i.customId)) : b.match === i.customId;
      if (hit) { try { await b.fn(i); } catch (e) { await this.fail(e); } }
    }
    await this.emitAsync('interactionCreate', i);
  }
}
