/**
 * Test unitari — WebChannel: send, receive, coda outbound
 */
import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { WebChannel } from './web-channel.js';
import type { ChannelMessage } from './channel.js';

describe('WebChannel', () => {
  let channel: WebChannel;

  beforeEach(() => {
    channel = new WebChannel({ maxQueueSize: 5 });
  });

  it('ha meta corretti', () => {
    assert.equal(channel.id, 'web');
    assert.equal(channel.meta.label, 'Web');
    assert.equal(channel.meta.capabilities.markdown, true);
    assert.equal(channel.meta.capabilities.streaming, true);
  });

  it('connect/disconnect cambia stato', async () => {
    assert.equal(channel.connected, false);
    await channel.connect();
    assert.equal(channel.connected, true);
    await channel.disconnect();
    assert.equal(channel.connected, false);
  });

  it('send accoda messaggi outbound', async () => {
    await channel.connect();
    const msg = await channel.send({ text: 'test', sender: 'bot' });
    assert.equal(msg.direction, 'outbound');
    assert.equal(msg.channelId, 'web');
    assert.equal(channel.queueSize, 1);
  });

  it('drainOutbound svuota la coda', async () => {
    await channel.connect();
    await channel.send({ text: 'msg1', sender: 'bot' });
    await channel.send({ text: 'msg2', sender: 'bot' });
    const drained = channel.drainOutbound();
    assert.equal(drained.length, 2);
    assert.equal(channel.queueSize, 0);
  });

  it('rispetta maxQueueSize', async () => {
    await channel.connect();
    for (let i = 0; i < 7; i++) {
      await channel.send({ text: `msg${i}`, sender: 'bot' });
    }
    assert.equal(channel.queueSize, 5);
    const msgs = channel.drainOutbound();
    assert.equal(msgs[0].text, 'msg2');
  });

  it('receiveFromAPI invoca handler registrati', async () => {
    await channel.connect();
    const received: ChannelMessage[] = [];
    channel.onMessage(async (msg) => { received.push(msg); });

    await channel.receiveFromAPI({ text: 'ciao', sender: 'utente' });
    assert.equal(received.length, 1);
    assert.equal(received[0].direction, 'inbound');
    assert.equal(received[0].text, 'ciao');
    assert.equal(received[0].sender, 'utente');
  });

  it('getOutboundSince filtra per timestamp', async () => {
    await channel.connect();
    const before = Date.now();
    await channel.send({ text: 'vecchio', sender: 'bot' });
    // Piccolo delay per differenziare timestamp
    await new Promise((r) => setTimeout(r, 5));
    const mid = Date.now();
    await channel.send({ text: 'nuovo', sender: 'bot' });

    const after = channel.getOutboundSince(mid - 1);
    assert.ok(after.length >= 1);
    assert.equal(after[after.length - 1].text, 'nuovo');
  });

  it('onMessage ritorna unsubscribe funzionante', async () => {
    await channel.connect();
    const received: ChannelMessage[] = [];
    const unsub = channel.onMessage(async (msg) => { received.push(msg); });

    await channel.receiveFromAPI({ text: 'prima', sender: 'u' });
    unsub();
    await channel.receiveFromAPI({ text: 'dopo', sender: 'u' });
    assert.equal(received.length, 1);
  });
});
