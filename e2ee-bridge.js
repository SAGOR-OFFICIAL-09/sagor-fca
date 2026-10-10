'use strict';

const fs = require('fs');
const path = require('path');

const { createBridge, patchApiForE2EE, isE2EEChatJid } = require('./e2ee');

const EXT_MEDIA = {
  jpg: ['image', 'image/jpeg'], jpeg: ['image', 'image/jpeg'], png: ['image', 'image/png'],
  gif: ['image', 'image/gif'], webp: ['image', 'image/webp'],
  mp4: ['video', 'video/mp4'], mov: ['video', 'video/quicktime'], webm: ['video', 'video/webm'],
  mp3: ['audio', 'audio/mpeg'], m4a: ['audio', 'audio/mp4'], wav: ['audio', 'audio/wav'],
  ogg: ['audio', 'audio/ogg; codecs=opus'], opus: ['audio', 'audio/ogg; codecs=opus'],
};

function mediaInfoFromName(name) {
  const ext = String(name || '').split('?')[0].split('.').pop().toLowerCase();
  const hit = EXT_MEDIA[ext];
  return hit ? { type: hit[0], mimeType: hit[1] } : { type: 'file', mimeType: 'application/octet-stream' };
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function readAttachment(att) {
  if (Buffer.isBuffer(att)) return { data: att };
  if (att && att.type === 'Buffer' && Array.isArray(att.data)) return { data: Buffer.from(att.data) };
  if (att && typeof att.read === 'function' && typeof att.on === 'function') {
    const data = await streamToBuffer(att);
    return { data, filename: att.path ? path.basename(String(att.path)) : undefined };
  }
  if (typeof att === 'string' && fs.existsSync(att)) {
    return { data: await fs.promises.readFile(att), filename: path.basename(att) };
  }
  throw new Error('[sagor-e2ee] unsupported attachment (use Buffer, readable stream, or an existing file path)');
}

function dual(fn, callback) {
  const p = Promise.resolve().then(fn);
  if (typeof callback === 'function') {
    p.then((r) => callback(null, r), (e) => callback(e));
    return undefined;
  }
  return p;
}

function jidOfMessage(messageID) {
  const m = global._e2eeMessageMap;
  const jid = m && m.get(String(messageID));
  return jid && isE2EEChatJid(jid) ? jid : null;
}

async function enableE2EE(api, opts = {}) {
  if (!api || typeof api.sendMessage !== 'function' || typeof api.getAppState !== 'function' ||
      typeof api.httpPost !== 'function' || typeof api.getCurrentUserID !== 'function') {
    throw new Error('[sagor-e2ee] enableE2EE needs a logged-in sagor-fca api (sendMessage/getAppState/httpPost/getCurrentUserID)');
  }
  if (api._e2eeBridge) return api;

  const userID = String(api.getCurrentUserID());
  if (!userID || userID === '0' || userID === 'undefined') {
    throw new Error('[sagor-e2ee] api is not logged in (no user id)');
  }

  let fb_dtsg;
  try {
    if (typeof api.refreshFb_dtsg === 'function') {
      const r = await api.refreshFb_dtsg();
      fb_dtsg = r && r.data && r.data.fb_dtsg;
    }
  } catch (e) {
    throw new Error('[sagor-e2ee] could not fetch fb_dtsg: ' + (e && e.message ? e.message : e));
  }
  if (!fb_dtsg) throw new Error('[sagor-e2ee] fb_dtsg unavailable - is the session (appState) still valid?');

  const devicePath = path.resolve(opts.devicePath || path.join(process.cwd(), '.sagor-e2ee', 'device.json'));
  try { fs.mkdirSync(path.dirname(devicePath), { recursive: true, mode: 0o700 }); } catch (_) {}

  const ctx = {
    userID,
    fb_dtsg,
    globalOptions: {
      enableE2EE: true,
      e2eeMemoryOnly: false,
      e2eeDevicePath: devicePath,
      e2eeDeviceData: opts.deviceData,
      e2eeMediaCdnHost: opts.mediaCdnHost,
    },
  };

  patchApiForE2EE(api, ctx);

  const apiForBridge = {
    getAppState: () => api.getAppState(),
    httpPost: (url, body) => api.httpPost(url, body),
    getCurrentUserID: () => api.getCurrentUserID(),
    sendTypingIndicator: (isTyping, threadID) => api.sendTypingIndicator(threadID, isTyping),
  };
  ctx._e2eeApiSource = () => apiForBridge;

  const bridge = createBridge(ctx);
  api._e2eeBridge = bridge;
  api.e2ee = bridge;

  api.connectE2EE = (callback) => bridge.connect(callback);
  api.getE2EEBridge = () => bridge;
  api.getE2EEDeviceData = (callback) => dual(() => bridge.getDeviceData(), callback);
  api.isE2EEThread = (threadID) => isE2EEChatJid(String(threadID));

  const origSend = api.sendMessage.bind(api);
  const origUnsend = typeof api.unsendMessage === 'function' ? api.unsendMessage.bind(api) : null;
  const origEdit = typeof api.editMessage === 'function' ? api.editMessage.bind(api) : null;
  const origReact = typeof api.setMessageReaction === 'function' ? api.setMessageReaction.bind(api) : null;

  api.sendMessage = function (msg, threadID, ...rest) {
    if (!isE2EEChatJid(String(threadID))) return origSend(msg, threadID, ...rest);

    let callback;
    let replyTo;
    for (const a of rest) {
      if (typeof a === 'function' && !callback) callback = a;
      else if ((typeof a === 'string' || typeof a === 'number') && replyTo == null) replyTo = a;
    }
    const form = typeof msg === 'string' ? { body: msg } : (msg || {});
    const text = String(form.body != null ? form.body : (form.text != null ? form.text : ''));
    const atts = !form.attachment ? [] : (Array.isArray(form.attachment) ? form.attachment : [form.attachment]);

    for (const k of ['sticker', 'url', 'location', 'emoji', 'mentions']) {
      if (form[k] != null) {
        return dual(() => { throw new Error('[sagor-e2ee] "' + k + '" is not supported on E2EE threads (refusing to send unencrypted)'); }, callback);
      }
    }

    const sendOpts = {};
    if (replyTo != null) {
      sendOpts.replyToId = String(replyTo);
      const sj = global._e2eeSenderJidMap && global._e2eeSenderJidMap.get(String(replyTo));
      if (sj) sendOpts.replyToSenderJid = sj;
    }

    return dual(async () => {
      let last;
      let textSent = false;
      for (let i = 0; i < atts.length; i++) {
        if (!atts[i]) continue;
        const { data, filename } = await readAttachment(atts[i]);
        const info = mediaInfoFromName(filename || (atts[i] && atts[i].path));
        const o = Object.assign({}, sendOpts, { filename, mimeType: info.mimeType });
        if (!textSent && text && info.type !== 'audio') { o.caption = text; textSent = true; }
        last = await bridge.sendMedia(String(threadID), info.type, data, o);
      }
      if (text && !textSent) last = await bridge.sendMessage(String(threadID), text, sendOpts);
      if (!atts.length && !text) throw new Error('[sagor-e2ee] nothing to send (empty body and no attachment)');
      return last;
    }, callback);
  };

  if (origUnsend) {
    api.unsendMessage = function (messageID, ...rest) {
      const jid = jidOfMessage(messageID);
      if (!jid) return origUnsend(messageID, ...rest);
      const callback = rest.find((a) => typeof a === 'function');
      return dual(() => bridge.unsendMessage(jid, messageID), callback);
    };
  }

  if (origEdit) {
    api.editMessage = function (text, messageID, ...rest) {
      const jid = jidOfMessage(messageID);
      if (!jid) return origEdit(text, messageID, ...rest);
      const callback = rest.find((a) => typeof a === 'function');
      return dual(() => bridge.editMessage(jid, messageID, text), callback);
    };
  }

  if (origReact) {
    api.setMessageReaction = function (reaction, messageID, ...rest) {
      const jid = jidOfMessage(messageID);
      if (!jid) return origReact(reaction, messageID, ...rest);
      const callback = rest.find((a) => typeof a === 'function');
      const senderJid = (global._e2eeSenderJidMap && global._e2eeSenderJidMap.get(String(messageID))) || jid;
      return dual(() => bridge.sendReaction(jid, messageID, senderJid, reaction), callback);
    };
  }

  const autoConnect = opts.autoConnect !== false;
  const wrapped = new Map();
  function wrapListen(orig) {
    return function (cb, ...rest) {
      if (typeof cb !== 'function') throw new TypeError('[sagor-e2ee] listen(callback) needs a callback function');
      const stop = orig(cb, ...rest);
      if (autoConnect) bridge.connect(cb).catch((e) => { try { cb(e); } catch (_) {} });
      return stop;
    };
  }
  for (const name of ['listen', 'listenMqtt']) {
    if (typeof api[name] !== 'function') continue;
    const orig = api[name];
    if (!wrapped.has(orig)) wrapped.set(orig, wrapListen(orig.bind(api)));
    api[name] = wrapped.get(orig);
  }

  for (const name of ['stopListening', 'stopListeningAsync']) {
    if (typeof api[name] !== 'function') continue;
    const orig = api[name].bind(api);
    api[name] = function (...args) {
      bridge.disconnect().catch(() => {});
      return orig(...args);
    };
  }

  return api;
}

module.exports = { enableE2EE, isE2EEChatJid };
