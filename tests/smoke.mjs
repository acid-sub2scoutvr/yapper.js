// Runs the built library against a local mock of the Yapper bot API (REST + long poll + gateway).
import http from 'node:http';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { Client, Embed, Button, Row, YapperAPIError } from '../dist/index.js';

const TOKEN = 'yb_test';
const calls = [];
let queue = [];                 // events the long poll will hand out
let nextId = 1;
let rateLimitOnce = true;
const push = (type, data) => queue.push({ id: nextId++, type, data });

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    const url = new URL(req.url, 'http://x');
    const json = body ? JSON.parse(body) : undefined;
    calls.push({ method: req.method, path: url.pathname + url.search, json, auth: req.headers.authorization });
    const send = (code, obj, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
    if (req.headers.authorization !== `Bot ${TOKEN}`) return send(401, { error: 'bad token' });

    const p = url.pathname;
    if (p === '/api/me') return send(200, { id: 'bot1', username: 'testbot', bot: true });
    if (p === '/api/commands') return send(200, {});
    if (p === '/api/events') {
      const after = Number(url.searchParams.get('after'));
      if (url.searchParams.get('wait') === '0') return send(200, { events: [], last: nextId - 1 });
      const events = queue.filter((e) => e.id > after);
      if (!events.length) { await new Promise((r) => setTimeout(r, 100)); return send(200, { events: [], last: after }); }
      return send(200, { events, last: events.at(-1).id });
    }
    if (p === '/api/channels/c1/messages' && req.method === 'POST') {
      if (rateLimitOnce) { rateLimitOnce = false; return send(429, { error: 'slow down' }, { 'retry-after': '0.05' }); }
      return send(200, { message: { id: 'm-out', channel_id: 'c1', author_id: 'bot1', content: json.content } });
    }
    if (p.startsWith('/api/interactions/')) return send(200, {});
    if (p === '/api/servers/s1') return send(200, { server: { id: 's1', name: 'Test Server' } });
    if (p === '/api/servers/s1/members/u1') return send(200, { member: { user_id: 'u1', nickname: 'Alice', role_ids: ['r1'] } });
    if (p === '/api/servers/s1/kick') return send(200, {});
    send(404, { error: 'not found' });
  });
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/api`;
const until = async (fn, ms = 3000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)); } };

// ---- 1. long-poll mode ----
{
  const client = new Client({ base, gateway: false, log: false });
  const seen = [];
  client.on('ready', (u) => seen.push(`ready:${u.username}`));
  client.command('ping', 'pong', (msg) => msg.reply('pong'));                   // fire-and-forget, hits a 429 first
  client.command('info', { description: 'card', cooldown: 60, run: (msg) => msg.reply('', { embeds: [new Embed().setTitle('Hi').setColor('blue')] }) });
  client.command('who', { run: async (msg) => { const m = await msg.fetchMember(); seen.push(`who:${m.displayName}`); await m.kick(); } });
  client.onButton(/^vote:/, (i) => i.ephemeral(`picked ${i.customId.slice(5)}`));
  client.on('memberAdd', (ev) => seen.push(`join:${ev.user_id}`));
  client.on('commandCooldown', (m) => seen.push(`cooldown:${m.command}`));
  client.on('messageCreate', (m) => seen.push(`msg:${m.content}`));

  await client.login(TOKEN);
  assert.equal(client.user.username, 'testbot');
  assert.deepEqual(calls.find((c) => c.path === '/api/commands').json.commands.map((c) => c.name).sort(), ['info', 'ping', 'who']);

  push('message', { id: 'm1', channel_id: 'c1', server_id: 's1', author_id: 'u1', content: '!ping' });
  push('message', { id: 'm2', channel_id: 'c1', author_id: 'u1', author_bot: true, content: '!ping' });       // bot: ignored
  push('message', { id: 'm3', channel_id: 'c1', author_id: 'u1', content: '/info' });
  push('message', { id: 'm4', channel_id: 'c1', author_id: 'u1', content: '/info' });                         // cooldown
  push('message', { id: 'm5', channel_id: 'c1', server_id: 's1', author_id: 'u1', content: '/who', command: 'who', args: '' });
  push('member_join', { server_id: 's1', user_id: 'u9' });
  push('interaction', { id: 'i1', token: 'tok', custom_id: 'vote:yes', user_id: 'u1', message_id: 'm1', channel_id: 'c1' });

  await until(() => calls.some((c) => c.path === '/api/interactions/i1/tok/callback') && calls.some((c) => c.path.endsWith('/kick')));
  const sends = calls.filter((c) => c.path === '/api/channels/c1/messages');
  assert.equal(sends.length, 3, 'pong (429 + retry) + info = 3 POSTs');
  assert.equal(sends[1].json.content, 'pong');
  assert.equal(sends[1].json.reply_to, 'm1');
  assert.equal(sends[2].json.embeds[0].title, 'Hi');
  assert.ok(seen.includes('cooldown:info') && seen.includes('who:Alice') && seen.includes('join:u9'));
  assert.equal(seen.filter((s) => s === 'msg:!ping').length, 1, 'the bot-authored !ping was skipped');
  assert.deepEqual(calls.find((c) => c.path.includes('/interactions/')).json, { type: 'ephemeral', content: 'picked yes' });
  await client.destroy();
  console.log('ok  long-poll: login, commands, 429 retry, cooldown, bot-skip, member fetch, kick, buttons, events');
}

// ---- 2. bad token stops cleanly ----
{
  const client = new Client({ base, gateway: false, log: false });
  await assert.rejects(client.login('yb_wrong'), (e) => e instanceof YapperAPIError && e.status === 401);
  console.log('ok  bad token rejects with YapperAPIError(401)');
}

// ---- 3. an unawaited failing send goes to the error event, not a crash ----
{
  const client = new Client({ base, gateway: false, log: false });
  const errors = [];
  client.on('error', (e) => errors.push(e.message));
  await client.login(TOKEN);
  client.send('missing-channel', 'x');   // 404, nobody awaits
  await until(() => errors.length);
  assert.match(errors[0], /not found/);
  await client.destroy();
  console.log('ok  fire-and-forget failure reported via error event');
}

// ---- 4. gateway mode: hello -> resume -> ready -> events, then a reconnect resumes from the cursor ----
if (typeof globalThis.WebSocket === 'function') {
  const wss = new WebSocketServer({ port: 0 });
  const resumes = [];
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ op: 'hello' }));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.op === 'resume') {
        resumes.push(m);
        ws.send(JSON.stringify({ op: 'ready', heartbeat_interval: 200 }));
        if (resumes.length === 1) {
          ws.send(JSON.stringify({ op: 'event', d: { id: 100, type: 'message', data: { id: 'g1', channel_id: 'c1', author_id: 'u1', content: '!ping' } } }));
          setTimeout(() => ws.close(1000), 50);   // short session ends -> 'failed' -> retry
        }
      } else if (m.op === 'heartbeat') ws.send(JSON.stringify({ op: 'heartbeat_ack' }));
    });
  });
  rateLimitOnce = false;
  const before = calls.length;
  const client = new Client({ base, gateway: `ws://127.0.0.1:${wss.address().port}`, log: false });
  client.command('ping', 'pong', (m) => m.reply('pong-gw'));
  await client.login(TOKEN);
  await until(() => calls.slice(before).some((c) => c.json?.content === 'pong-gw'));
  await until(() => resumes.length >= 2, 5000);
  assert.equal(resumes[0].token, TOKEN);
  assert.equal(resumes[1].seq, 100, 'reconnect resumes after the last handled event');
  await client.destroy();
  wss.close();
  console.log('ok  gateway: resume, event dispatch, reconnect with cursor');
} else console.log('--  skipped gateway test (no global WebSocket on this Node)');

server.close();
console.log('\nall smoke tests passed');
process.exit(0);
