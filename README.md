# Discord Music Bot

A prefix-based Discord music bot built with Discord.js and Discord voice.

## Commands

- `!play <song or URL>` / `?play <song or URL>`
- `!pl <song or URL>` / `?pl <song or URL>`
- `!queue` / `?queue`
- `!skip` / `?skip`
- `!pause` / `?pause`
- `!resume` / `?resume`
- `!stop` / `?stop`
- `!leave` / `?leave`
- `!loop off`, `!loop track`, or `!loop queue` (also works with ?)
- `!help` / `?help`

## Discord setup

Enable the **Message Content Intent** in the Discord Developer Portal. The bot also needs permission to view and send messages, connect to voice, and speak.

## Render setup

Create a **Background Worker** connected to this repository. Set these environment variables in Render:

- `DISCORD_TOKEN` — your bot token
- `CLIENT_ID` — optional for this prefix-only version; not currently read by the code

Use the default build command (`npm install`) and start command (`npm start`). Never put your bot token in GitHub or commit a `.env` file.

## Notes

Search and playback depend on the supported source and may stop working if that source changes its access or streaming behavior.
