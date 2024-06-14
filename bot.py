import discord
from discord.ext import commands
from discord import app_commands
import requests
from datetime import datetime, timedelta
import time
from dotenv import load_dotenv
import os
import pprint

load_dotenv()
TOKEN = os.getenv('DISCORD_BOT_TOKEN')
ALLOWED_GUILD_ID = int(os.getenv('ALLOWED_GUILD_ID'))

bot = commands.Bot(command_prefix="!", intents=discord.Intents.all())

def get_events(weeks_time = 1):
    current_time = datetime.now()
    one_week_later = current_time + timedelta(weeks=weeks_time)

    start_timestamp = int(time.mktime(current_time.timetuple()))
    finish_timestamp = int(time.mktime(one_week_later.timetuple()))

    url = f"https://ctftime.org/api/v1/events/?limit=20&start={start_timestamp}&finish={finish_timestamp}"
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }

    response = requests.get(url, headers=headers)
    if response.status_code == 200:
        events = response.json()
        return events
    else:
        return None

@bot.event
async def on_ready():
    print(f"Logged in as {bot.user.name}")
    try:
        synced = await bot.tree.sync()
        print(f"Synced {len(synced)} commands")
    except Exception as e:
        print(e)

@bot.tree.command(name="ping", description="Get the ping")
async def ping(interaction: discord.Interaction):
    if interaction.guild.id != ALLOWED_GUILD_ID:
        await interaction.response.send_message("This bot only works in the designated server.", ephemeral=True)
        return

    await interaction.response.send_message(f"**Latency:** {int((bot.latency * 1000))}ms", ephemeral=True)

@bot.tree.command(name="create_event", description="Schedule a server event")
@app_commands.describe(weeks="How many weeks of CTFs do you want to add to the Events Tab?")
async def create_event(interaction: discord.Interaction, weeks: int):
    if interaction.guild.id != ALLOWED_GUILD_ID:
        await interaction.response.send_message("This bot only works in the designated server.", ephemeral=True)
        return

    await interaction.response.defer(ephemeral=True)
    
    guild = interaction.guild

    events = get_events(weeks)

    if events:
        existing_events = await guild.fetch_scheduled_events()
        existing_event_titles = {event.name: event for event in existing_events}
        
        created_events = []
        updated_events = []
        
        for event in events:
            if event['onsite'] and "India" not in event['location']:
                continue

            description = (
                "CTFtime URL: " + event['ctftime_url'] + "\n\n" +
                "Format: " + event['format'] + "\n\n" +
                "Weight: " + str(event['weight']) + "\n\n" +
                "Prizes: " + event['prizes'] + "\n\n" +
                event['description']
            )
            if event['restrictions'] != "Open":
                description = "Restriction: " + event['restrictions'] + "\n\n" + description

            start_time = datetime.strptime(str(event['start']).replace('T', ' '), "%Y-%m-%d %H:%M:%S%z")
            finish_time = datetime.strptime(str(event['finish']).replace('T', ' '), "%Y-%m-%d %H:%M:%S%z")

            if event['title'] in existing_event_titles:
                scheduled_event = existing_event_titles[event['title']]
                await scheduled_event.edit(
                    description=description,
                    start_time=start_time,
                    end_time=finish_time,
                    entity_type=discord.EntityType.external,
                    location=event['url']
                )
                updated_events.append(event['title'])
            else:
                new_event = await guild.create_scheduled_event(
                    name=event['title'],
                    description=description,
                    start_time=start_time,
                    end_time=finish_time,
                    privacy_level=discord.PrivacyLevel.guild_only,
                    entity_type=discord.EntityType.external,
                    location=event['url']
                )
                created_events.append(event['title'])

        summary_message = "Event update summary:\n"
        if created_events:
            summary_message += f"Created events: {', '.join(created_events)}\n"
        if updated_events:
            summary_message += f"Updated events: {', '.join(updated_events)}\n"
        if not created_events and not updated_events:
            summary_message += "No events were created or updated."

        await interaction.followup.send(summary_message, ephemeral=True)
    else:
        await interaction.followup.send("Error! No events found using API", ephemeral=True)

bot.run(TOKEN)
