'use strict';

// Logs the Discord bot in, and keeps trying when that fails: 30 s after the
// first failure, then twice as long each time, at most every 10 minutes. Only
// the bot needs Discord (posts, slash commands, welcome messages, pollers), so a
// failed login never stops the process: the website, the overlays and the
// Twitch chat bot keep running meanwhile.
//
// A login Discord refuses for good (an invalid token, intents the bot may not
// use) cannot start working by itself, so it is not tried again: it is logged
// loudly and the site keeps running until the setting is fixed and the service
// redeployed.

const FIRST_RETRY_MS = 30 * 1000;
const MAX_RETRY_MS = 10 * 60 * 1000;
const UNRECOVERABLE_CODES = new Set(['TokenInvalid', 'DisallowedIntents', 'InvalidIntents']);

// The wait before retry number `failures` (1 for the first retry).
function retryDelayMs(failures, { firstMs = FIRST_RETRY_MS, maxMs = MAX_RETRY_MS } = {}) {
  return Math.min(firstMs * 2 ** (failures - 1), maxMs);
}

function isUnrecoverable(error) {
  return !!error && UNRECOVERABLE_CODES.has(error.code);
}

// Starts logging in at once. stop() cancels a retry that is waiting (the
// graceful shutdown calls it).
function startDiscordLogin({ client, token, log = console, firstMs = FIRST_RETRY_MS, maxMs = MAX_RETRY_MS }) {
  let timer = null;
  let stopped = false;
  let failures = 0;

  async function attempt() {
    timer = null;
    if (stopped) return;
    try {
      await client.login(token);
      if (failures > 0) log.log(`[Discord] Logged in after ${failures} failed attempt(s)`);
    } catch (error) {
      if (stopped) return;
      failures += 1;
      const reason = (error && error.message) || String(error);
      if (isUnrecoverable(error)) {
        log.error(`[Discord] LOGIN REFUSED: ${reason} The bot will not try again: fix DISCORD_TOKEN (or the bot's intents in the Discord developer portal) and redeploy. The website, overlays and the Twitch chat bot keep running; Discord posts, slash commands and welcome messages are off until then.`);
        return;
      }
      const delay = retryDelayMs(failures, { firstMs, maxMs });
      log.error(`[Discord] Login failed (attempt ${failures}): ${reason}. Trying again in ${Math.round(delay / 1000)} s; the site keeps running.`);
      timer = setTimeout(attempt, delay);
      timer.unref(); // the web server keeps the process alive; a waiting retry never should
    }
  }

  attempt();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    get failures() { return failures; },
    get retryPending() { return timer !== null; },
  };
}

module.exports = { FIRST_RETRY_MS, MAX_RETRY_MS, retryDelayMs, isUnrecoverable, startDiscordLogin };
