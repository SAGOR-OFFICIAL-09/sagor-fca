'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');

const calls = [];
const fakeBridge = {
  connect: async (cb) => { calls.push(['connect', typeof cb]); },
  disconnect: async () => { calls.push(['disconnect']); },
  getDeviceData: async () => ({ k: 1 }),
  sendMessage: async (jid, text, o) => { calls.push(['e2ee.send', jid, text, o]); return { id: 'm1' }; },
  sendMedia: async (jid, type, data, o) => { calls.push(['e2ee.media', jid, type, data.length, o]); return { id: 'm2' }; },
  unsendMessage: async (jid, id) => { calls.push(['e2ee.unsend', jid, id]); return 'ok'; },
  editMessage: async (jid, id, t) => { calls.push(['e2ee.edit', jid, id, t]); return 'ok'; },
  sendReaction: async (jid, id, sj, e) => { calls.push(['e2ee.react', jid, id, sj, e]); return 'ok'; },
};
const fakeMod = {
  isE2EEChatJid: (v) => typeof v === 'string' && v.includes('@'),
  createBridge: () => fakeBridge,
  patchApiForE2EE: () => {},
};
const modPath = require.resolve('../e2ee');
require.cache[modPath] = { id: modPath, filename: modPath, loaded: true, exports: fakeMod };
const { enableE2EE } = require('../e2ee-bridge');

function mockApi() {
  let cb = null;
  return {
    sendMessage(...a) { calls.push(['plain.send', ...a]); return 'plain'; },
    unsendMessage(...a) { calls.push(['plain.unsend', ...a]); return 'plain'; },
    editMessage(...a) { calls.push(['plain.edit', ...a]); return 'plain'; },
    setMessageReaction(...a) { calls.push(['plain.react', ...a]); return 'plain'; },
    listen(fn) { cb = fn; return () => {}; },
    listenMqtt(fn) { cb = fn; return () => {}; },
    stopListening() { calls.push(['stop']); },
    getAppState: () => [], httpPost: async () => '', getCurrentUserID: () => '1000',
    refreshFb_dtsg: async () => ({ data: { fb_dtsg: 'TOKEN' } }),
    sendTypingIndicator() {},
  };
}
let n = 0;
async function check(name, fn) { await fn(); n++; console.log('  ok -', name); }
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('[sagor-fca] e2ee-bridge mock test (offline)');
  const api = mockApi();
  await enableE2EE(api, { devicePath: path.join(require('os').tmpdir(), 'sagor-e2ee-test', 'd.json') });

  await check('idempotent (no double wrap)', async () => {
    const f = api.sendMessage; await enableE2EE(api); assert.equal(api.sendMessage, f);
  });
  await check('normal thread goes to original sendMessage with all args', () => {
    calls.length = 0; const cb = () => {};
    assert.equal(api.sendMessage('hi', '123', cb, 'mid.1'), 'plain');
    assert.deepEqual(calls[0], ['plain.send', 'hi', '123', cb, 'mid.1']);
  });
  await check('E2EE JID text goes through bridge (promise)', async () => {
    calls.length = 0;
    const r = await api.sendMessage('secret', '555.0@msgr');
    assert.deepEqual(r, { id: 'm1' });
    assert.deepEqual(calls[0].slice(0, 3), ['e2ee.send', '555.0@msgr', 'secret']);
    assert.ok(!calls.some((c) => c[0] === 'plain.send'), 'never plaintext');
  });
  await check('E2EE JID with callback + reply id', async () => {
    calls.length = 0;
    await new Promise((res, rej) => api.sendMessage({ body: 'r' }, '555.0@msgr', (e, r) => e ? rej(e) : res(r), 'mid.9'));
    assert.equal(calls[0][3].replyToId, 'mid.9');
  });
  await check('unsupported field refused, not sent in plaintext', async () => {
    calls.length = 0;
    await assert.rejects(api.sendMessage({ body: 'x', sticker: '1' }, '555.0@msgr'), /not supported on E2EE/);
    assert.equal(calls.length, 0);
  });
  await check('Buffer attachment -> sendMedia with caption', async () => {
    calls.length = 0;
    await api.sendMessage({ body: 'cap', attachment: Buffer.from('abc') }, '555.0@msgr');
    assert.equal(calls[0][0], 'e2ee.media'); assert.equal(calls[0][2], 'file'); assert.equal(calls[0][4].caption, 'cap');
  });
  await check('unsend/edit/react route by message->JID map', async () => {
    global._e2eeMessageMap = new Map([['mid.E', '555.0@msgr']]);
    calls.length = 0;
    await api.unsendMessage('mid.E'); await api.editMessage('new', 'mid.E'); await api.setMessageReaction('👍', 'mid.E');
    assert.deepEqual(calls.map((c) => c[0]), ['e2ee.unsend', 'e2ee.edit', 'e2ee.react']);
    calls.length = 0;
    api.unsendMessage('mid.plain'); assert.equal(calls[0][0], 'plain.unsend');
  });
  await check('listen auto-connects E2EE with the same callback; stop disconnects', async () => {
    calls.length = 0; api.listen(() => {}); await tick();
    assert.deepEqual(calls[0], ['connect', 'function']);
    api.stopListening(); await tick();
    assert.ok(calls.some((c) => c[0] === 'disconnect') && calls.some((c) => c[0] === 'stop'));
  });
  await check('getE2EEDeviceData works (promise + callback)', async () => {
    assert.deepEqual(await api.getE2EEDeviceData(), { k: 1 });
    await new Promise((res) => api.getE2EEDeviceData((e, d) => { assert.deepEqual(d, { k: 1 }); res(); }));
  });
  await check('fails clearly without fb_dtsg', async () => {
    const bad = mockApi(); bad.refreshFb_dtsg = async () => ({ data: {} });
    await assert.rejects(enableE2EE(bad), /fb_dtsg unavailable/);
  });
  console.log('all ' + n + ' passed');
})().catch((e) => { console.error(e); process.exit(1); });
