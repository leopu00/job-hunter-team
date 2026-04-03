/**
 * Test unitari — ChannelRegistry: registrazione, routing, broadcast
 */
import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { ChannelRegistry, getDefaultRegistry, resetDefaultRegistry } from './registry.js';
import { WebChannel } from './web-channel.js';
import { TelegramChannel } from './telegram-channel.js';

describe('ChannelRegistry', () => {
  let registry: ChannelRegistry;

  beforeEach(() => {
    registry = new ChannelRegistry();
  });

  it('register e get funzionano', () => {
    const web = new WebChannel();
    registry.register(web);
    assert.equal(registry.has('web'), true);
    assert.equal(registry.get('web'), web);
    assert.equal(registry.size, 1);
  });

  it('unregister rimuove il canale', () => {
    registry.register(new WebChannel());
    assert.equal(registry.unregister('web'), true);
    assert.equal(registry.has('web'), false);
    assert.equal(registry.unregister('web'), false);
  });

  it('list e listIds ritornano canali registrati', () => {
    registry.register(new WebChannel());
    registry.register(new TelegramChannel({ chatId: '1' }));
    assert.equal(registry.list().length, 2);
    assert.deepStrictEqual(registry.listIds().sort(), ['telegram', 'web']);
  });

  it('connectAll connette tutti e riporta errori', async () => {
    registry.register(new WebChannel());
    registry.register(new TelegramChannel({ chatId: '' }));
    const report = await registry.connectAll();
    assert.ok(report.connected.includes('web'));
    assert.equal(report.errors.length, 1);
    assert.equal(report.errors[0].id, 'telegram');
  });

  it('listConnected filtra solo connessi', async () => {
    const web = new WebChannel();
    registry.register(web);
    registry.register(new TelegramChannel({ chatId: '' }));
    await web.connect();
    const connected = registry.listConnected();
    assert.equal(connected.length, 1);
    assert.equal(connected[0].id, 'web');
  });

  it('sendTo invia a canale specifico', async () => {
    const web = new WebChannel();
    registry.register(web);
    await web.connect();
    const msg = await registry.sendTo('web', { text: 'hello', sender: 'sys' });
    assert.ok(msg);
    assert.equal(msg!.text, 'hello');
    assert.equal(web.queueSize, 1);
  });

  it('sendTo ritorna null per canale non connesso', async () => {
    registry.register(new WebChannel());
    const msg = await registry.sendTo('web', { text: 'test', sender: 'sys' });
    assert.equal(msg, null);
  });

  it('broadcast invia a tutti i canali connessi', async () => {
    const web = new WebChannel();
    const tg = new TelegramChannel({ chatId: '1', sendFn: async () => {} });
    registry.register(web);
    registry.register(tg);
    await web.connect();
    await tg.connect();

    const results = await registry.broadcast({ text: 'broadcast', sender: 'sys' });
    assert.equal(results.length, 2);
    assert.ok(results.every((m) => m.text === 'broadcast'));
  });

  it('disconnectAll disconnette tutti', async () => {
    const web = new WebChannel();
    registry.register(web);
    await web.connect();
    assert.equal(web.connected, true);
    await registry.disconnectAll();
    assert.equal(web.connected, false);
  });
});

describe('getDefaultRegistry singleton', () => {
  beforeEach(() => { resetDefaultRegistry(); });

  it('ritorna sempre la stessa istanza', () => {
    const a = getDefaultRegistry();
    const b = getDefaultRegistry();
    assert.equal(a, b);
  });

  it('resetDefaultRegistry crea nuova istanza', () => {
    const a = getDefaultRegistry();
    resetDefaultRegistry();
    const b = getDefaultRegistry();
    assert.notEqual(a, b);
  });
});
