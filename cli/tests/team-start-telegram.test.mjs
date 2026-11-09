// `jht team start` starts the Telegram bridge (TG-BRIDGE) only where Telegram exists: a bot of the config with a token,
// or the isolated service on its way. A team that never configured Telegram gets no bridge session.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContainerBootstrap, telegramConfigured } from '../src/commands/team/start.js';

const none = () => false;
const marker = (path) => (probe) => probe === path;
const bots = (token) => ({ channels: { telegram: { bots: { assistente: { bot_token: token } } } } });

test('no config, no bots, empty tokens: Telegram is not configured', () => {
  for (const cfg of [null, undefined, {}, { channels: {} }, { channels: { telegram: {} } }, bots(''), bots('   '), bots(7), { channels: { telegram: { bots: { x: null } } } }]) {
    assert.equal(telegramConfigured(cfg, none), false);
  }
});

test('a bot with a token, or an isolated service marker, is configured', () => {
  assert.equal(telegramConfigured(bots('synthetic-token'), none), true);
  assert.equal(telegramConfigured({}, marker('/run/jht-telegram/cutover')), true);
  assert.equal(telegramConfigured({}, marker('/run/jht-telegram/cutover-required')), true);
});

test('the bootstrap of a team without Telegram has no TG-BRIDGE and keeps the rest in order', () => {
  const sessions = buildContainerBootstrap(false).map((item) => item.session);
  assert.deepEqual(sessions, ['ASSISTENTE', 'SENTINELLA', 'BRIDGE', 'TOKEN-METER', 'MENTOR', 'CAPITANO']);
});

test('the bootstrap of a team with Telegram starts TG-BRIDGE right after the Assistente, as before', () => {
  const sessions = buildContainerBootstrap(true).map((item) => item.session);
  assert.deepEqual(sessions, ['ASSISTENTE', 'TG-BRIDGE', 'SENTINELLA', 'BRIDGE', 'TOKEN-METER', 'MENTOR', 'CAPITANO']);
});
