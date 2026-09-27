require("dotenv").config();

const crypto = require("node:crypto");
const { Client } = require("discord.js-selfbot-v13");

const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;

const API = "https://discord.com/api/v10";

const DISBOARD_APPLICATION_ID = "302050872383242240";

// Regulärer DISBOARD-Cooldown nach erfolgreichem Bump
const NORMAL_COOLDOWN_MS = 2 * 60 * 60 * 1000;

// Kleiner Puffer, damit wir nicht auf die Millisekunde zu früh sind
const NORMAL_COOLDOWN_BUFFER_MS = 30 * 1000;

// Wenn DISBOARD eine Restzeit nennt, ebenfalls etwas Puffer drauf
const PARSED_COOLDOWN_BUFFER_MS = 75 * 1000;

const RESPONSE_TIMEOUT_MS = 30 * 1000;

// Falls etwas komplett Unbekanntes passiert
const ERROR_RETRY_MS = 5 * 60 * 1000;

const client = new Client();

let pendingInteraction = null;

/*
 * ============================================================
 * HELPERS
 * ============================================================
 */

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDuration(ms) {
  const totalSeconds = Math.max(
    0,
    Math.ceil(ms / 1000)
  );

  const hours = Math.floor(
    totalSeconds / 3600
  );

  const minutes = Math.floor(
    (totalSeconds % 3600) / 60
  );

  const seconds =
    totalSeconds % 60;

  const parts = [];

  if (hours) {
    parts.push(`${hours}h`);
  }

  if (minutes) {
    parts.push(`${minutes}m`);
  }

  parts.push(`${seconds}s`);

  return parts.join(" ");
}

function createSessionId() {
  return crypto
    .randomBytes(16)
    .toString("hex");
}

function createNonce() {
  return (
    (BigInt(Date.now()) - 1420070400000n) << 22n
  ).toString();
}

/*
 * ============================================================
 * DISCORD REST
 * ============================================================
 */

async function discordRequest(
  url,
  options = {}
) {
  const headers = {
    Authorization: TOKEN,
    Accept: "*/*",
    "Accept-Language":
      "de-DE,de;q=0.9,en;q=0.8",
    "X-Discord-Locale": "de",
    ...options.headers,
  };

  if (options.body) {
    headers["Content-Type"] =
      "application/json";
  }

  const response =
    await fetch(url, {
      ...options,
      headers,
    });

  const text =
    await response.text();

  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const error =
      new Error(
        `Discord antwortete mit ${response.status}: ${
          typeof data === "string"
            ? data
            : JSON.stringify(data)
        }`
      );

    error.status =
      response.status;

    error.data =
      data;

    throw error;
  }

  return {
    status: response.status,
    data,
  };
}

/*
 * ============================================================
 * DISBOARD COMMAND HOLEN
 * ============================================================
 */

async function getBumpCommand() {
  log(
    "Lade Guild Application Command Index..."
  );

  const response =
    await discordRequest(
      `${API}/guilds/${GUILD_ID}/application-command-index`
    );

  const data =
    response.data;

  const commands =
    data?.application_commands ?? [];

  const applications =
    data?.applications ?? [];

  log(
    `Command Index geladen: ${commands.length} Commands, ${applications.length} Apps.`
  );

  const disboardCommands =
    commands.filter(
      (command) =>
        String(
          command.application_id
        ) ===
        DISBOARD_APPLICATION_ID
    );

  log(
    `DISBOARD Commands gefunden: ${disboardCommands.length}`
  );

  const bumpCommand =
    disboardCommands.find(
      (command) => {
        const name = (
          command.name_default ??
          command.name ??
          ""
        ).toLowerCase();

        return name === "bump";
      }
    );

  if (!bumpCommand) {
    throw new Error(
      "DISBOARD /bump wurde nicht gefunden."
    );
  }

  log(
    `DISBOARD /bump gefunden | ID=${bumpCommand.id} | Version=${bumpCommand.version}`
  );

  return bumpCommand;
}

/*
 * ============================================================
 * INTERACTION PAYLOAD
 * ============================================================
 */

function createInteractionPayload(
  command
) {
  return {
    type: 2,

    application_id:
      command.application_id,

    guild_id:
      GUILD_ID,

    channel_id:
      CHANNEL_ID,

    session_id:
      createSessionId(),

    nonce:
      createNonce(),

    analytics_location:
      "slash_ui",

    data: {
      ...command,

      name:
        command.name_default ??
        command.name,

      options: [],

      application_command: {
        ...command,
      },

      attachments: [],
    },
  };
}

/*
 * ============================================================
 * MESSAGE HELPERS
 * ============================================================
 */

function messageIsEphemeral(
  message
) {
  try {
    return message.flags?.has(
      "EPHEMERAL"
    );
  } catch {
    return (
      (Number(
        message.flags?.bitfield ?? 0
      ) &
        64) ===
      64
    );
  }
}

function messageIsLoading(
  message
) {
  try {
    return message.flags?.has(
      "LOADING"
    );
  } catch {
    return (
      (Number(
        message.flags?.bitfield ?? 0
      ) &
        128) ===
      128
    );
  }
}

function extractMessageText(
  message
) {
  const parts = [];

  if (message.content) {
    parts.push(
      message.content
    );
  }

  for (
    const embed of
    message.embeds ?? []
  ) {
    if (embed.title) {
      parts.push(
        embed.title
      );
    }

    if (embed.description) {
      parts.push(
        embed.description
      );
    }

    for (
      const field of
      embed.fields ?? []
    ) {
      parts.push(
        `${field.name}: ${field.value}`
      );
    }

    if (
      embed.footer?.text
    ) {
      parts.push(
        embed.footer.text
      );
    }
  }

  return parts
    .join("\n")
    .trim();
}

/*
 * ============================================================
 * COOLDOWN PARSER
 * ============================================================
 */

function parseCooldownMs(
  message
) {
  const text =
    extractMessageText(
      message
    );

  if (!text) {
    return null;
  }

  /*
   * Beispiel:
   *
   * "Bitte warte noch 24 Minuten bis der Server erneut
   * gebumpt werden kann"
   */

  const germanHours =
    text.match(
      /warte\s+noch\s+(\d+)\s+stunden?(?:\s+(?:und\s+)?(\d+)\s+minuten?)?/i
    );

  if (germanHours) {
    const hours =
      Number(
        germanHours[1]
      );

    const minutes =
      Number(
        germanHours[2] ?? 0
      );

    return (
      ((hours * 60) + minutes) *
      60 *
      1000
    );
  }

  const germanMinutes =
    text.match(
      /warte\s+noch\s+(\d+)\s+minuten?/i
    );

  if (germanMinutes) {
    return (
      Number(
        germanMinutes[1]
      ) *
      60 *
      1000
    );
  }

  const germanSeconds =
    text.match(
      /warte\s+noch\s+(\d+)\s+sekunden?/i
    );

  if (germanSeconds) {
    return (
      Number(
        germanSeconds[1]
      ) *
      1000
    );
  }

  /*
   * Englischer Fallback
   */

  const englishHours =
    text.match(
      /wait(?:\s+another|\s+for)?\s+(\d+)\s+hours?(?:\s+(?:and\s+)?(\d+)\s+minutes?)?/i
    );

  if (englishHours) {
    const hours =
      Number(
        englishHours[1]
      );

    const minutes =
      Number(
        englishHours[2] ?? 0
      );

    return (
      ((hours * 60) + minutes) *
      60 *
      1000
    );
  }

  const englishMinutes =
    text.match(
      /wait(?:\s+another|\s+for)?\s+(\d+)\s+minutes?/i
    );

  if (englishMinutes) {
    return (
      Number(
        englishMinutes[1]
      ) *
      60 *
      1000
    );
  }

  return null;
}

/*
 * ============================================================
 * RESPONSE DEBUG
 * ============================================================
 */

function printInteractionResponse(
  message,
  eventType
) {
  const ephemeral =
    messageIsEphemeral(
      message
    );

  const loading =
    messageIsLoading(
      message
    );

  const text =
    extractMessageText(
      message
    );

  console.log("");
  console.log(
    "============================================================"
  );

  console.log(
    ephemeral
      ? "             DISBOARD EPHEMERAL RESPONSE"
      : "             DISBOARD INTERACTION RESPONSE"
  );

  console.log(
    "============================================================"
  );

  console.log(
    `Event: ${eventType}`
  );

  console.log(
    `Message ID: ${message.id ?? "?"}`
  );

  console.log(
    `Ephemeral: ${ephemeral ? "JA" : "NEIN"}`
  );

  console.log(
    `Loading: ${loading ? "JA" : "NEIN"}`
  );

  console.log(
    `Flags: ${
      message.flags?.bitfield ?? "?"
    }`
  );

  if (
    message.interaction
  ) {
    console.log(
      `Interaction ID: ${
        message.interaction.id ?? "?"
      }`
    );

    console.log(
      `Command: /${
        message.interaction
          .commandName ?? "?"
      }`
    );

    console.log(
      `User: ${
        message.interaction
          .user?.username ?? "?"
      } (${
        message.interaction
          .user?.id ?? "?"
      })`
    );
  }

  console.log(
    "------------------------------------------------------------"
  );

  console.log(
    text ||
      "(Kein Text vorhanden)"
  );

  console.log(
    "============================================================"
  );

  console.log("");
}

/*
 * ============================================================
 * MESSAGE MATCHING
 * ============================================================
 */

function isMatchingDisboardMessage(
  message
) {
  if (
    !pendingInteraction
  ) {
    return false;
  }

  if (
    message.channelId &&
    String(
      message.channelId
    ) !==
      String(
        CHANNEL_ID
      )
  ) {
    return false;
  }

  if (
    message.createdTimestamp &&
    message.createdTimestamp <
      pendingInteraction.startedAt -
        3000
  ) {
    return false;
  }

  if (
    message.applicationId &&
    String(
      message.applicationId
    ) !==
      DISBOARD_APPLICATION_ID
  ) {
    return false;
  }

  if (
    message.interaction
      ?.commandName &&
    message.interaction
      .commandName !==
      "bump"
  ) {
    return false;
  }

  if (
    message.interaction
      ?.user?.id &&
    client.user?.id &&
    String(
      message.interaction
        .user.id
    ) !==
      String(
        client.user.id
      )
  ) {
    return false;
  }

  return (
    String(
      message.applicationId ?? ""
    ) ===
      DISBOARD_APPLICATION_ID ||
    message.interaction
      ?.commandName ===
      "bump"
  );
}

/*
 * ============================================================
 * RESPONSE WAITER
 * ============================================================
 */

function waitForInteractionResponse() {
  if (
    pendingInteraction?.timeout
  ) {
    clearTimeout(
      pendingInteraction.timeout
    );
  }

  return new Promise(
    (resolve) => {
      const startedAt =
        Date.now();

      const timeout =
        setTimeout(() => {
          pendingInteraction =
            null;

          resolve(null);
        }, RESPONSE_TIMEOUT_MS);

      pendingInteraction = {
        startedAt,
        timeout,
        resolve,
      };
    }
  );
}

function resolveInteraction(
  message
) {
  if (
    !pendingInteraction
  ) {
    return;
  }

  clearTimeout(
    pendingInteraction.timeout
  );

  const resolve =
    pendingInteraction.resolve;

  pendingInteraction =
    null;

  resolve(message);
}

/*
 * ============================================================
 * GATEWAY RESPONSE HANDLER
 * ============================================================
 */

function handleInteractionMessage(
  message,
  eventType
) {
  if (
    !isMatchingDisboardMessage(
      message
    )
  ) {
    return;
  }

  const ephemeral =
    messageIsEphemeral(
      message
    );

  const loading =
    messageIsLoading(
      message
    );

  log(
    `${eventType}: DISBOARD Response erkannt | ephemeral=${ephemeral} | loading=${loading}`
  );

  printInteractionResponse(
    message,
    eventType
  );

  /*
   * Noch keine finale Antwort.
   */
  if (loading) {
    return;
  }

  resolveInteraction(
    message
  );
}

/*
 * ============================================================
 * GATEWAY EVENTS
 * ============================================================
 */

client.on(
  "ready",
  () => {
    log(
      `Gateway bereit als ${client.user.username} (${client.user.id})`
    );
  }
);

client.on(
  "messageCreate",
  (message) => {
    handleInteractionMessage(
      message,
      "MESSAGE_CREATE"
    );
  }
);

client.on(
  "messageUpdate",
  (
    oldMessage,
    newMessage
  ) => {
    handleInteractionMessage(
      newMessage,
      "MESSAGE_UPDATE"
    );
  }
);

client.on(
  "error",
  (error) => {
    log(
      `Gateway Client Fehler: ${error.message}`
    );
  }
);

/*
 * ============================================================
 * SEND BUMP
 * ============================================================
 */

async function sendBump(
  command
) {
  const payload =
    createInteractionPayload(
      command
    );

  log(
    `Sende /bump mit Version ${command.version}...`
  );

  /*
   * Listener zuerst aktivieren.
   */
  const responsePromise =
    waitForInteractionResponse();

  try {
    const response =
      await discordRequest(
        `${API}/interactions`,
        {
          method: "POST",
          body:
            JSON.stringify(
              payload
            ),
        }
      );

    log(
      `/interactions HTTP ${response.status}`
    );
  } catch (error) {
    if (
      pendingInteraction
    ) {
      clearTimeout(
        pendingInteraction.timeout
      );

      pendingInteraction =
        null;
    }

    throw error;
  }

  log(
    "Interaction gesendet. Warte auf Gateway Response..."
  );

  const interactionResponse =
    await responsePromise;

  if (!interactionResponse) {
    log(
      `Keine finale DISBOARD Response innerhalb von ${
        RESPONSE_TIMEOUT_MS /
        1000
      } Sekunden erhalten.`
    );

    return null;
  }

  return interactionResponse;
}

/*
 * ============================================================
 * BUMP + RESPONSE AUSWERTEN
 * ============================================================
 */

async function bump() {
  try {
    const command =
      await getBumpCommand();

    const response =
      await sendBump(
        command
      );

    if (!response) {
      return {
        type: "unknown",
      };
    }

    const text =
      extractMessageText(
        response
      );

    const ephemeral =
      messageIsEphemeral(
        response
      );

    /*
     * Erst prüfen, ob DISBOARD eine echte Restzeit nennt.
     */
    const cooldownMs =
      parseCooldownMs(
        response
      );

    if (
      cooldownMs !== null
    ) {
      log(
        `DISBOARD Cooldown erkannt: ${formatDuration(
          cooldownMs
        )} Restzeit.`
      );

      return {
        type: "cooldown",
        cooldownMs,
        response,
      };
    }

    /*
     * Ephemeral ohne erkannte Cooldown-Zeit:
     * vermutlich irgendein anderer Fehler.
     */
    if (ephemeral) {
      log(
        `Ephemere DISBOARD-Antwort ohne parsbaren Cooldown: ${text}`
      );

      return {
        type: "unknown",
        response,
      };
    }

    /*
     * Normale Antwort nach /bump:
     * erfolgreicher Bump.
     */
    log(
      "Bump wurde erfolgreich ausgeführt."
    );

    return {
      type: "success",
      response,
    };
  } catch (error) {
    log(
      `Bump fehlgeschlagen: ${error.message}`
    );

    if (error.data) {
      log(
        `Discord Fehlerdetails: ${JSON.stringify(
          error.data
        )}`
      );
    }

    return {
      type: "error",
      error,
    };
  }
}

/*
 * ============================================================
 * READY
 * ============================================================
 */

function waitForReady() {
  if (client.readyAt) {
    return Promise.resolve();
  }

  return new Promise(
    (resolve) => {
      client.once(
        "ready",
        resolve
      );
    }
  );
}

/*
 * ============================================================
 * MAIN LOOP
 * ============================================================
 */

async function main() {
  if (!TOKEN) {
    console.error(
      "TOKEN fehlt in .env"
    );

    process.exit(1);
  }

  if (!GUILD_ID) {
    console.error(
      "GUILD_ID fehlt in .env"
    );

    process.exit(1);
  }

  if (!CHANNEL_ID) {
    console.error(
      "CHANNEL_ID fehlt in .env"
    );

    process.exit(1);
  }

  log(
    "Verbinde mit Discord Gateway..."
  );

  await client.login(
    TOKEN
  );

  await waitForReady();

  log(
    "DISBOARD Auto-Bump gestartet."
  );

  while (true) {
    const result =
      await bump();

    let waitMs;

    /*
     * ========================================================
     * FALL 1:
     * Wir haben erfolgreich gebumpt.
     *
     * Regulärer Cooldown bleibt IMMER 2 Stunden.
     * ========================================================
     */

    if (
      result.type ===
      "success"
    ) {
      waitMs =
        NORMAL_COOLDOWN_MS +
        NORMAL_COOLDOWN_BUFFER_MS;

      log(
        `Regulärer 2h-Cooldown gestartet. Nächster Versuch in ${formatDuration(
          waitMs
        )}.`
      );
    }

    /*
     * ========================================================
     * FALL 2:
     * Jemand hat vorher schon gebumpt.
     *
     * DISBOARD sagt uns die tatsächliche Restzeit.
     * Diese überschreibt für DIESEN Versuch den normalen Timer.
     * ========================================================
     */

    else if (
      result.type ===
      "cooldown"
    ) {
      const jitterMs =
        crypto.randomInt(
          5_000,
          20_001
        );

      waitMs =
        result.cooldownMs +
        PARSED_COOLDOWN_BUFFER_MS +
        jitterMs;

      log(
        `Server befindet sich bereits im Cooldown. Nächster Versuch nach DISBOARD-Restzeit in ${formatDuration(
          waitMs
        )}.`
      );
    }

    /*
     * ========================================================
     * FALL 3:
     * Irgendeine unbekannte Response / Netzwerkproblem.
     * ========================================================
     */

    else {
      waitMs =
        ERROR_RETRY_MS;

      log(
        `Keine verwertbare DISBOARD-Antwort. Neuer Versuch in ${formatDuration(
          waitMs
        )}.`
      );
    }

    await sleep(
      waitMs
    );
  }
}

/*
 * ============================================================
 * CLEAN SHUTDOWN
 * ============================================================
 */

process.on(
  "SIGINT",
  () => {
    log("Beende...");

    try {
      client.destroy();
    } catch {}

    process.exit(0);
  }
);

process.on(
  "SIGTERM",
  () => {
    log("Beende...");

    try {
      client.destroy();
    } catch {}

    process.exit(0);
  }
);

/*
 * ============================================================
 * START
 * ============================================================
 */

main().catch(
  (error) => {
    console.error(
      `[${new Date().toISOString()}] Fataler Fehler:`,
      error
    );

    try {
      client.destroy();
    } catch {}

    process.exit(1);
  }
);
