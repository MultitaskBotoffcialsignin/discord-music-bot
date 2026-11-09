const {
  Client,
  GatewayIntentBits,
  PermissionsBitField
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
  entersState
} = require("@discordjs/voice");

const play = require("@iamtraction/play-dl");

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("Missing DISCORD_TOKEN environment variable.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ]
});

const queues = new Map();
const PREFIXES = ["!", "?"];

function getQueue(guildId) {
  let queue = queues.get(guildId);
  if (!queue) {
    const player = createAudioPlayer();
    queue = {
      songs: [],
      current: null,
      player,
      connection: null,
      loop: "off",
      skipOnce: false,
      textChannel: null,
      starting: false
    };

    player.on(AudioPlayerStatus.Idle, () => {
      playNext(guildId).catch(error => {
        console.error("Playback error:", error);
        queues.get(guildId)?.textChannel?.send("I couldn't start the next track. Try another song or URL.");
      });
    });

    player.on("error", error => {
      console.error("Audio player error:", error);
      queue.textChannel?.send("There was a playback error. I'll try the next track.");
    });

    queues.set(guildId, queue);
  }
  return queue;
}

function getStreamType(type) {
  const types = {
    opus: StreamType.Opus,
    ogg_opus: StreamType.OggOpus,
    webm_opus: StreamType.WebmOpus,
    raw: StreamType.Raw
  };
  return types[type] ?? StreamType.Arbitrary;
}

async function playNext(guildId) {
  const queue = queues.get(guildId);
  if (!queue || queue.starting) return;

  if (queue.skipOnce) {
    queue.skipOnce = false;
  } else if (queue.current && queue.loop === "track") {
    queue.songs.unshift(queue.current);
  } else if (queue.current && queue.loop === "queue") {
    queue.songs.push(queue.current);
  }

  queue.current = null;
  const next = queue.songs.shift();

  if (!next) {
    queue.textChannel?.send("The queue is finished.");
    return;
  }

  queue.starting = true;
  try {
    const source = await play.stream(next.url);
    const resource = createAudioResource(source.stream, {
      inputType: getStreamType(source.type),
      metadata: next
    });

    queue.current = next;
    queue.player.play(resource);
    queue.textChannel?.send("▶️ Now playing: **" + next.title + "**");
  } catch (error) {
    console.error("Track stream error:", error);
    queue.textChannel?.send("Couldn't play **" + next.title + "**. Skipping it.");
    queue.current = null;
    queue.starting = false;
    return playNext(guildId);
  } finally {
    queue.starting = false;
  }
}

async function findTrack(query) {
  if (play.yt_validate(query) === "yt_video") {
    const info = await play.video_basic_info(query);
    return {
      title: info.video_details.title,
      url: info.video_details.url
    };
  }

  const results = await play.search(query, { limit: 1, source: { youtube: "video" } });
  if (!results.length) return null;

  return {
    title: results[0].title,
    url: results[0].url
  };
}

async function connectToMemberVoice(message, queue) {
  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) {
    await message.reply("Join a voice channel first.");
    return false;
  }

  const permissions = voiceChannel.permissionsFor(message.guild.members.me);
  if (!permissions?.has([PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak])) {
    await message.reply("I need permission to Connect and Speak in that voice channel.");
    return false;
  }

  if (!queue.connection || queue.connection.state.status === VoiceConnectionStatus.Destroyed) {
    queue.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: message.guild.id,
      adapterCreator: message.guild.voiceAdapterCreator,
      selfDeaf: true
    });
    queue.connection.subscribe(queue.player);
    await entersState(queue.connection, VoiceConnectionStatus.Ready, 20_000);
  } else if (queue.connection.joinConfig.channelId !== voiceChannel.id) {
    await message.reply("I'm already playing in another voice channel in this server.");
    return false;
  }

  return true;
}

client.once("ready", () => {
  console.log("Music bot online as " + client.user.tag);
});

client.on("messageCreate", async message => {
  if (!message.guild || message.author.bot) return;

  const prefix = PREFIXES.find(value => message.content.startsWith(value));
  if (!prefix) return;

  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const command = (args.shift() || "").toLowerCase();
  const query = args.join(" ");

  try {
    if (["help", "commands"].includes(command)) {
      return message.reply(
        "**Music commands**\n" +
        "!play <song or URL> / ?play <song or URL>\n" +
        "!pl <song or URL> / ?pl <song or URL>\n" +
        "!queue, !skip, !pause, !resume, !stop, !leave\n" +
        "!loop off, !loop track, !loop queue\n" +
        "You can use ! or ? with every command."
      );
    }

    if (["play", "pl"].includes(command)) {
      if (!query) return message.reply("Tell me a song name or paste a supported video URL.");
      const queue = getQueue(message.guild.id);
      queue.textChannel = message.channel;

      const connected = await connectToMemberVoice(message, queue);
      if (!connected) return;

      await message.reply("🔎 Looking for **" + query + "**...");
      const track = await findTrack(query);
      if (!track) return message.channel.send("I couldn't find a matching track.");

      queue.songs.push({
        ...track,
        requestedBy: message.author.tag
      });

      if (!queue.current && queue.player.state.status !== AudioPlayerStatus.Playing) {
        await playNext(message.guild.id);
      } else {
        await message.channel.send("➕ Added to queue: **" + track.title + "**");
      }
      return;
    }

    const queue = queues.get(message.guild.id);

    if (command === "queue" || command === "q") {
      if (!queue || (!queue.current && queue.songs.length === 0)) {
        return message.reply("The queue is empty.");
      }
      const upcoming = queue.songs.slice(0, 10)
        .map((song, index) => (index + 1) + ". **" + song.title + "**")
        .join("\n");
      return message.reply(
        "**Now playing:** " + (queue.current ? queue.current.title : "Nothing") +
        "\n**Up next:**\n" + (upcoming || "No more tracks.") +
        (queue.songs.length > 10 ? "\n…and " + (queue.songs.length - 10) + " more." : "")
      );
    }

    if (command === "skip" || command === "s") {
      if (!queue?.current) return message.reply("Nothing is playing.");
      queue.skipOnce = true;
      queue.player.stop(true);
      return message.reply("⏭️ Skipped.");
    }

    if (command === "pause") {
      if (!queue?.player.pause()) return message.reply("Nothing is playing right now.");
      return message.reply("⏸️ Paused.");
    }

    if (command === "resume") {
      if (!queue?.player.unpause()) return message.reply("The player isn't paused.");
      return message.reply("▶️ Resumed.");
    }

    if (command === "stop") {
      if (!queue) return message.reply("Nothing is playing.");
      queue.songs = [];
      queue.current = null;
      queue.loop = "off";
      queue.skipOnce = true;
      queue.player.stop(true);
      return message.reply("⏹️ Playback stopped and the queue was cleared.");
    }

    if (command === "leave" || command === "disconnect") {
      if (!queue) return message.reply("I'm not in a voice channel.");
      queue.songs = [];
      queue.current = null;
      queue.loop = "off";
      queue.player.stop(true);
      queue.connection?.destroy();
      queues.delete(message.guild.id);
      return message.reply("👋 Left the voice channel.");
    }

    if (command === "loop") {
      if (!queue) return message.reply("Start playing something first.");
      const mode = (args[0] || "").toLowerCase();
      if (!["off", "track", "queue"].includes(mode)) {
        return message.reply("Use !loop off, !loop track, or !loop queue.");
      }
      queue.loop = mode;
      return message.reply("🔁 Loop mode set to **" + mode + "**.");
    }
  } catch (error) {
    console.error("Command error:", error);
    message.reply("Something went wrong. Check the Render logs for details.").catch(() => {});
  }
});

client.login(token);
