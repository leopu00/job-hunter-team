/**
 * Test unitari — channel.ts: tipi, costanti e helper
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  CHANNEL_IDS,
  createMessageId,
  buildInboundMessage,
  buildOutboundMessage,
} from './channel.js';

describe('CHANNEL_IDS', () => {
  it('contiene web, cli, telegram', () => {
    assert.deepStrictEqual([...CHANNEL_IDS], ['web', 'cli', 'telegram']);
  });
});

describe('createMessageId', () => {
  it('genera ID con prefisso msg_', () => {
    const id = createMessageId();
    assert.ok(id.startsWith('msg_'), `ID dovrebbe iniziare con msg_: ${id}`);
  });

  it('genera ID univoci', () => {
    const ids = new Set(Array.from({ length: 100 }, () => createMessageId()));
    assert.equal(ids.size, 100, 'Tutti gli ID devono essere univoci');
  });
});

describe('buildInboundMessage', () => {
  it('crea messaggio inbound con campi corretti', () => {
    const msg = buildInboundMessage('cli', { text: 'ciao', sender: 'user' });
    assert.equal(msg.channelId, 'cli');
    assert.equal(msg.direction, 'inbound');
    assert.equal(msg.text, 'ciao');
    assert.equal(msg.sender, 'user');
    assert.ok(msg.id.startsWith('msg_'));
    assert.ok(typeof msg.timestamp === 'number');
    assert.ok(msg.timestamp > 0);
  });

  it('preserva meta opzionali', () => {
    const msg = buildInboundMessage('web', {
      text: 'test',
      sender: 'api',
      meta: { sessionId: 'abc' },
    });
    assert.deepStrictEqual(msg.meta, { sessionId: 'abc' });
  });
});

describe('buildOutboundMessage', () => {
  it('crea messaggio outbound con direction corretta', () => {
    const msg = buildOutboundMessage('telegram', {
      text: 'risposta',
      sender: 'bot',
      recipient: 'user123',
    });
    assert.equal(msg.channelId, 'telegram');
    assert.equal(msg.direction, 'outbound');
    assert.equal(msg.text, 'risposta');
    assert.equal(msg.sender, 'bot');
    assert.equal(msg.recipient, 'user123');
  });
});
