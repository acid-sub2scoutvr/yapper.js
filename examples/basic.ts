import { Client, Embed, Button, Row } from '../src/index.js';

const client = new Client();

client.on('ready', (me) => console.log(`online as ${me.username}`));

client.command('ping', 'Check the bot is alive', (msg) => msg.reply('pong'));

client.command('info', {
  description: 'Show a card',
  cooldown: 5,
  run: (msg) => msg.reply('', { embeds: [new Embed().setTitle('Hi').setDescription('**Embeds** work').setColor('blue')] }),
});

client.command('vote', 'Pizza?', (msg) =>
  msg.reply('Pizza?', { components: [new Row(Button.success('Yes', 'vote:yes'), Button.danger('No', 'vote:no'))] }),
);
client.onButton(/^vote:/, (i) => i.ephemeral(`You picked ${i.customId.slice(5)}`));

// Structures have methods, like discord.js:
client.command('whoami', { description: 'Who are you?', run: async (msg) => {
  const member = await msg.fetchMember();
  await msg.reply(`You are ${member?.displayName ?? msg.author.displayName}`);
} });

client.on('memberAdd', async (ev) => {
  const server = await client.servers.fetch(ev.server_id);
  const [general] = (await server!.channels.fetchAll({ type: 'text' })).values();
  await general?.send(`welcome <@${ev.user_id}>`);
});

await client.login(); // reads YAPPER_BOT_TOKEN
