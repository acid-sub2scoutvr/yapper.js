# @client.jar/yapper.js

```
npm install @client.jar/yapper.js
```

An unofficial discord.js-style library for building [Yapper](https://www.yapin.gg/developers) bots. Standalone (own REST client,
WebSocket gateway and long-poll fallback), written in TypeScript, no runtime dependencies. Node 18+ (the gateway
needs Node 22+, Bun or Deno; otherwise it long-polls automatically).

```ts
import { Client, Embed, Button, Row } from '@client.jar/yapper.js';

const client = new Client();

client.on('ready', (me) => console.log(`online as ${me.username}`));
client.command('ping', 'Check the bot is alive', (msg) => msg.reply('pong'));

client.command('kick', {
  description: 'Kick someone',
  cooldown: 5,
  check: async (msg) => !!(await msg.fetchMember()),
  run: async (msg) => (await (await msg.fetchServer())!.members.fetch(msg.argv[0]))?.kick(),
});

client.onButton(/^vote:/, (i) => i.ephemeral(`You picked ${i.customId.slice(5)}`));

await client.login(); // reads YAPPER_BOT_TOKEN (token starts with yb_, from Settings → Developer)
```

## What's in it

| Area | |
|---|---|
| `Client` | typed events (`ready`, `messageCreate`, `memberAdd`, `interactionCreate`, `raw`, `error`, …), `command()`, `onButton()`, `send()`, `setStatus()` |
| Structures | `User`, `Message`, `Channel`, `Server`, `Member`, `ButtonInteraction`, all with methods (`msg.reply()`, `member.kick()`, `channel.send()`) |
| Managers | `client.users / servers / channels`, `server.channels / members`: `.cache`, `.fetch(id)`, `.fetchAll()` |
| Builders | `Embed`, `Button`, `Row` |
| Transport | `REST` (429/503 retry with jitter, timeouts), gateway with heartbeat + resume, long-poll fallback with a cursor so no event is handled twice or lost |
| Safety | un-awaited `msg.reply()` failures go to the `error` event instead of crashing Node; bot messages ignored by default |

## Not done yet

- Components V2 layouts, voice (LiveKit), avatar/banner upload helpers, DM helpers beyond `user.send()`.
- Cogs/extensions, argument parsing and type converters, permission checks, collectors / `awaitMessages`, paginator.
- CommonJS build (the package is ESM-only; add `tsup` if you want both).

## Verify before publishing

The REST paths, auth scheme and gateway opcodes were taken from the behaviour of the existing SDK. Several payload
fields are guesses and are marked optional in `src/types.ts` (for example `server_id` on messages, the member
`user_id`/`id` field, and `author` on messages). Check them against the official docs and tighten the types.
Also check Yapper's developer terms for naming and branding rules before you pick the npm name.

## Develop

```
npm install
npm test      # builds, then runs tests/smoke.mjs against a local mock Yapper server
```
