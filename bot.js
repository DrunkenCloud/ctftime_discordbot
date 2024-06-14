const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const { config } = require('dotenv');
const { DateTime } = require('luxon');

config();

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const ALLOWED_GUILD_ID = process.env.ALLOWED_GUILD_ID;

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildScheduledEvents] });

async function getEvents(weeksTime = 1) {
    const currentTime = DateTime.now();
    const oneWeekLater = currentTime.plus({ weeks: weeksTime });

    const startTimestamp = Math.floor(currentTime.toSeconds());
    const finishTimestamp = Math.floor(oneWeekLater.toSeconds());

    const url = `https://ctftime.org/api/v1/events/?limit=20&start=${startTimestamp}&finish=${finishTimestamp}`;
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    };

    try {
        const response = await axios.get(url, { headers });
        return response.data;
    } catch (error) {
        console.error('Error fetching events:', error);
        return null;
    }
}

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    
    const rest = new REST({ version: '10' }).setToken(TOKEN);

    const commands = [
        new SlashCommandBuilder().setName('ping').setDescription('Get the ping'),
        new SlashCommandBuilder()
            .setName('create_event')
            .setDescription('Schedule a server event')
            .addIntegerOption(option =>
                option.setName('weeks')
                      .setDescription('How many weeks of CTFs do you want to add to the Events Tab?')
                      .setRequired(true))
    ].map(command => command.toJSON());

    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationGuildCommands(client.user.id, ALLOWED_GUILD_ID),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (interaction.guildId.toString() !== ALLOWED_GUILD_ID) {
        await interaction.reply({ content: "This bot only works in the designated server.", ephemeral: true });
        return;
    }

    if (commandName === 'ping') {
        await interaction.reply({ content: `**Latency:** ${client.ws.ping}ms`, ephemeral: true });
    } else if (commandName === 'create_event') {
        const weeks = interaction.options.getInteger('weeks');
        await interaction.deferReply({ ephemeral: true });

        const guild = interaction.guild;
        const events = await getEvents(weeks);

        if (events) {
            const existingEvents = await guild.scheduledEvents.fetch();
            const existingEventTitles = new Map(existingEvents.map(event => [event.name, event]));

            const createdEvents = [];
            const updatedEvents = [];

            for (const event of events) {
                let loc = String(event.url);

                if (event.onsite && !event.location.includes("India")) continue;

                let description = `CTFtime URL: ${event.ctftime_url}\n\nFormat: ${event.format}\n\nWeight: ${event.weight}\n\nPrizes: ${event.prizes}\n\n${event.description}`;
                if (event.restrictions !== "Open") {
                    description = `Restriction: ${event.restrictions}\n\n` + description;
                }

                const startTime = DateTime.fromISO(event.start).toJSDate();
                const finishTime = DateTime.fromISO(event.finish).toJSDate();

                if (existingEventTitles.has(event.title)) {
                    const scheduledEvent = existingEventTitles.get(event.title);
                    await scheduledEvent.edit({
                        description: description,
                        scheduledStartTime: startTime,
                        scheduledEndTime: finishTime,
                        entityType: 3,
                        entity_metadata: { location: event.url }
                    });
                    updatedEvents.push(event.title);
                } else {
                    await guild.scheduledEvents.create({
                        name: event.title,
                        description: description,
                        scheduledStartTime: startTime,
                        scheduledEndTime: finishTime,
                        privacyLevel: '2',
                        entityType: 3,
                        entity_metadata: { location: event.url }
                    });
                    createdEvents.push(event.title);
                }
            }

            let summaryMessage = "Event update summary:\n";
            if (createdEvents.length) {
                summaryMessage += `Created events: ${createdEvents.join(', ')}\n`;
            }
            if (updatedEvents.length) {
                summaryMessage += `Updated events: ${updatedEvents.join(', ')}\n`;
            }
            if (!createdEvents.length && !updatedEvents.length) {
                summaryMessage += "No events were created or updated.";
            }

            await interaction.followUp({ content: summaryMessage, ephemeral: true });
        } else {
            await interaction.followUp({ content: "Error! No events found using API", ephemeral: true });
        }
    }
});

client.login(TOKEN);