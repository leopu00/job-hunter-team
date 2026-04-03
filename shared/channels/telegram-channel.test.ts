/**
 * Test unitari — TelegramChannel: send, receive, lazy init
 */
import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { TelegramChannel } from './telegram-channel.js';
import type { ChannelMessage } from './channel.js';

describe('TelegramChannel', () => {
  let channel: TelegramChannel;
  const sent: Array<{ chatId: string; text: string }> = [];

  beforeEach(() => {
    sent.length = 0;
    channel = new TelegramChannel({
      chatId: '12345',
      sendFn: async (params) => { sent.push(params); },
    });
  });

  it('ha meta corretti', () => {
    assert.equal(channel.id, 'telegram');
    assert.equal(channel.meta.label, 'Telegram');
    assert.equal(channel.meta.capabilities.markdown, true);
    assert.equal(channel.meta.capabilities.streaming, false);
    assert.equal(channel.meta.capabilities.push, true);
  });

  it('connect/disconnect cambia stato', async () => {
    assert.equal(channel.connected, false);
    await channel.connect();
    assert.equal(channel.connected, true);
    await channel.disconnect();
    assert.equal(channel.connected, false);
  });

  it('connect senza chatId lancia errore', async () => {
    const noChat = new TelegramChannel({ chatId: '' });
    await assert.rejects(() => noChat.connect(), { message: /chat_id non configurato/ });
  });

  it('send invoca sendFn con chatId e testo', async () => {
    await channel.connect();
    const msg = await channel.send({ text: 'ciao', sender: 'bot' });
    assert.equal(msg.direction, 'outbound');
    assert.equal(msg.channelId, 'telegram');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].chatId, '12345');
    assert.equal(sent[0].text, 'ciao');
  });

  it('send senza sendFn non lancia errore', async () => {
    const noSend = new TelegramChannel({ chatId: '999' });
    await noSend.connect();
    const msg = await noSend.send({ text: 'test', sender: 'bot' });
    assert.equal(msg.text, 'test');
  });

  it('receiveFromBot invoca handler con meta', async () => {
    await channel.connect();
    const received: ChannelMessage[] = [];
    channel.onMessage(async (msg) => { received.push(msg); });

    await channel.receiveFromBot({
      text: 'hello',
      sender: 'mario',
      chatId: '12345',
      messageId: 42,
    });

    assert.equal(received.length, 1);
    assert.equal(received[0].direction, 'inbound');
    assert.equal(received[0].text, 'hello');
    assert.equal(received[0].sender, 'mario');
    assert.equal((received[0].meta as any).chatId, '12345');
    assert.equal((received[0].meta as any).messageId, 42);
  });

  it('setSendFn aggiorna la funzione di invio', async () => {
    const altSent: string[] = [];
    channel.setSendFn(async (p) => { altSent.push(p.text); });
    await channel.connect();
    await channel.send({ text: 'new', sender: 'bot' });
    assert.equal(sent.length, 0);
    assert.deepStrictEqual(altSent, ['new']);
  });

  it('setChatId aggiorna il destinatario', () => {
    assert.equal(channel.chatId, '12345');
    channel.setChatId('99999');
    assert.equal(channel.chatId, '99999');
  });
});
