"use strict";

var log = require("./logger");

var { mapFmeEvent } = require("../fme/events");
var { createFmeSession } = require("../fme/fme-client");
var { storeMedia } = require("./media-server");
var {
  E2EEDecryptionError,
  E2EEMediaError,
  E2EESessionError
} = require("./errors");

function isE2EEChatJid(value) {
  return typeof value === "string" && value.indexOf("@") !== -1;
}

function _isPromiseLike(v) { return v && typeof v.then === "function"; }

function _callUserCallback(cb, err, msg) {
  if (typeof cb !== "function") return;
  try {
    var r = cb(err, msg);
    if (_isPromiseLike(r)) r.catch(function (e) { log.error("e2ee", e); });
  } catch (e) { log.error("e2ee", e); }
}

function _parseMentions(arr, text) {
  var out = {};
  if (!Array.isArray(arr) || !text) return out;
  arr.forEach(function (m) {
    if (!m || m.userId == null) return;
    var o = Number(m.offset || 0), l = Number(m.length || 0);
    out[String(m.userId)] = text.substring(o, o + l);
  });
  return out;
}

function _normalizeAttType(t) {
  if (!t) return t;
  t = String(t).toLowerCase();
  if (t === "image")               return "photo";
  if (t === "document")            return "file";
  if (t === "voice" || t === "ptt") return "audio";
  return t;
}

function _normalizeAtt(a) {
  if (!a || typeof a !== "object") return a;
  return {
    type: _normalizeAttType(a.type),
    ID: a.stickerId != null ? String(a.stickerId) : undefined,
    url: a.url, filename: a.fileName, mimeType: a.mimeType,
    fileSize: a.fileSize != null ? String(a.fileSize) : undefined,
    width: a.width, height: a.height, duration: a.duration,
    previewUrl: a.previewUrl, description: a.description, source: a.sourceText,
    mediaKey: a.mediaKey, mediaSha256: a.mediaSha256, mediaEncSha256: a.mediaEncSha256,
    directPath: a.directPath, latitude: a.latitude, longitude: a.longitude, isE2EE: true
  };
}

function _numericId(jid) {
  if (!jid) return "";
  var s = String(jid);
  var m = s.match(/^(\d+)/);
  return m ? m[1] : s;
}

function _mapMsg(ev) {
  var text = ev && ev.text ? String(ev.text) : "";
  var sid  = ev && ev.senderId != null ? _numericId(String(ev.senderId)) : "";
  var tid  = ev && ev.chatJid  ? String(ev.chatJid)
           : (ev && ev.threadId != null ? String(ev.threadId) : "");
  var messageReply = null;
  if (ev && ev.replyTo) {
    var _rtId = ev.replyTo.messageId != null ? ev.replyTo.messageId
              : ev.replyTo.id != null ? ev.replyTo.id : undefined;
    var _rtSender = (ev.replyTo.senderId != null &&
                     typeof ev.replyTo.senderId !== "object")
                  ? _numericId(String(ev.replyTo.senderId)) : "";
    messageReply = {
      messageID: _rtId != null ? String(_rtId) : undefined,
      senderID:  _rtSender,
      body:      ev.replyTo.text != null ? String(ev.replyTo.text) : "",
      isE2EE:    true
    };
  }
  return {
    type: "e2ee_message", senderID: sid, body: text, threadID: tid,
    messageID: ev.id != null ? String(ev.id) : ev.id,
    messageReply: messageReply,
    attachments: Array.isArray(ev.attachments) ? ev.attachments.map(_normalizeAtt) : [],
    mentions: _parseMentions(ev.mentions, text),
    timestamp: ev.timestampMs != null ? Number(ev.timestampMs) : Date.now(),
    isGroup: /@group\.facebook\.com$/i.test(ev.chatJid || "") || !!ev.isGroup,
    isE2EE: true,
    e2ee: { chatJid: ev.chatJid, senderJid: ev.senderJid, replyTo: ev.replyTo || null, rawMentions: ev.mentions || [] },
    args: text.trim() ? text.trim().split(/\s+/) : []
  };
}

function _mapEdit(ev) {
  var text = ev && ev.text ? String(ev.text) : "";
  return {
    type: "e2ee_message_edit", senderID: ev && ev.senderId != null ? String(ev.senderId) : "",
    body: text, threadID: ev && ev.chatJid ? String(ev.chatJid) : "",
    messageID: ev ? ev.messageId : undefined,
    timestamp: ev && ev.timestampMs != null ? Number(ev.timestampMs) : Date.now(),
    isGroup: /@group\.facebook\.com$/i.test(ev && ev.chatJid ? ev.chatJid : "") || !!(ev && ev.isGroup),
    isE2EE: true,
    e2ee: { chatJid: ev ? ev.chatJid : undefined, senderJid: ev ? ev.senderJid : undefined },
    args: text.trim() ? text.trim().split(/\s+/) : []
  };
}

function _mapReaction(ev) {
  return {
    type: "e2ee_message_reaction",
    threadID: ev && ev.chatJid ? String(ev.chatJid) : "",
    messageID: ev ? ev.messageId : undefined, reaction: ev ? ev.reaction : undefined,
    senderID: ev && ev.senderId != null ? String(ev.senderId) : undefined,
    userID:   ev && ev.senderId != null ? String(ev.senderId) : undefined,
    isGroup: !!(ev && ev.isGroup),
    isE2EE: true,
    e2ee: { chatJid: ev ? ev.chatJid : undefined, senderJid: ev ? ev.senderJid : undefined }
  };
}

function _mapReceipt(ev) {
  return {
    type: "e2ee_receipt", isE2EE: true,
    e2ee: {
      receiptType: ev ? ev.type : undefined, chatJid: ev ? ev.chat : undefined,
      senderJid: ev ? ev.sender : undefined, messageIds: ev ? ev.messageIds : []
    }
  };
}

function _normalizeMediaInput(input) {
  if (Buffer.isBuffer(input)) return input;
  if (Array.isArray(input))   return Buffer.from(input);
  if (input && input.type === "Buffer" && Array.isArray(input.data)) return Buffer.from(input.data);
  if (typeof input === "string") return Buffer.from(input, "base64");
  throw new E2EEMediaError("E2EE media data must be Buffer, byte array, Buffer-JSON, or base64 string");
}

var _DEFAULT_MEDIA_CDN = "https://mmeg.facebook.com";

function resolveCdnUrl(directPath, globalOptions) {
  if (!directPath) throw new E2EEMediaError("directPath is required to download E2EE media");
  if (/^https?:\/\//i.test(directPath)) return directPath;
  var host = (globalOptions && globalOptions.e2eeMediaCdnHost) || _DEFAULT_MEDIA_CDN;
  return host.replace(/\/+$/, "") + (directPath.charAt(0) === "/" ? directPath : "/" + directPath);
}

function _mediaCryptoType(mediaType) {
  switch (String(mediaType || "").toLowerCase()) {
    case "image": case "sticker": return "image";
    case "video":                 return "video";
    case "audio": case "voice":   return "audio";
    default:                      return "document";
  }
}

global._e2eeMessageMap   = global._e2eeMessageMap   || new Map();
global._e2eeSenderJidMap = global._e2eeSenderJidMap || new Map();

function _regMsg(msgID, jid) {
  if (msgID && jid) global._e2eeMessageMap.set(String(msgID), String(jid));
}

function createBridge(ctx) {
  if (ctx._e2eeBridge) return ctx._e2eeBridge;

  var state = {
    session: null,
    connected: false,
    connectingPromise: null,
    listenerAttached: false,
    lastGlobalCallback: null,
    connectedEmitted: false,
    reconnectTimer: null,
    lastReadyPayload: null,
    fullyReady: false
  };

  function _ensureEnabled() {
    if (ctx.globalOptions.enableE2EE === false)
      throw new Error("E2EE is disabled. Set enableE2EE:true in config.");
  }

  function _emitLegacyConnected() {
    if (state.connectedEmitted) return;
    state.connectedEmitted = true;
    _callUserCallback(state.lastGlobalCallback, null, { type: "e2ee_connected", isE2EE: true });
  }

  function _handleFmeEvents(session) {
    if (state.listenerAttached) return;
    state.listenerAttached = true;

    session.fbClient.onEvent(function (evt) {
      var mapped = mapFmeEvent(evt);
      for (var i = 0; i < mapped.length; i++) {
        var m = mapped[i];
        switch (m.kind) {
          case "connected":
            _emitLegacyConnected();
            break;
          case "message": {
            var msg = _mapMsg(m.ev);
            if (msg.messageID && msg.threadID) {
              _regMsg(msg.messageID, msg.threadID);
              if (m.ev.senderJid) global._e2eeSenderJidMap.set(String(msg.messageID), String(m.ev.senderJid));
            }
            if (m.ev.replyTo && m.ev.replyTo.messageId && m.ev.chatJid) {
              _regMsg(m.ev.replyTo.messageId, String(m.ev.chatJid));
            }
            _callUserCallback(state.lastGlobalCallback, null, msg);
            break;
          }
          case "edit":
            _callUserCallback(state.lastGlobalCallback, null, _mapEdit(m.ev));
            break;
          case "reaction":
            _callUserCallback(state.lastGlobalCallback, null, _mapReaction(m.ev));
            break;
          case "revoke":
            _callUserCallback(state.lastGlobalCallback, null, {
              type: "e2ee_message_revoke", isE2EE: true,
              threadID: m.ev.chatJid ? String(m.ev.chatJid) : "",
              messageID: m.ev.messageId, fromMe: !!m.ev.fromMe,
              senderID: m.ev.senderId ? _numericId(String(m.ev.senderId)) : undefined,
              e2ee: { chatJid: m.ev.chatJid, senderJid: m.ev.senderJid }
            });
            break;
          case "receipt":
            _callUserCallback(state.lastGlobalCallback, null, _mapReceipt(m.ev));
            break;
          case "disconnected":
            state.connected = false;
            state.fullyReady = false;
            state.connectedEmitted = false;
            state.listenerAttached = false;
            log.warn("e2ee", "E2EE disconnected — reconnecting in 5s");
            if (!state.reconnectTimer) {
              state.reconnectTimer = setTimeout(function () {
                state.reconnectTimer = null;
                if (!state.connectingPromise) {
                  connect(state.lastGlobalCallback).catch(function (e) {
                    log.error("e2ee", "Reconnect failed:", e && e.message ? e.message : e);
                  });
                }
              }, 5000);
            }
            _callUserCallback(state.lastGlobalCallback, null, { type: "e2ee_disconnected", isE2EE: true, data: m.info || null });
            break;
          case "error": {
            var raw = m.err && m.err.message ? m.err.message : String(m.err || "");
            if (/close 1006|unexpected EOF|ECONNRESET|ETIMEDOUT|read loop/i.test(raw)) {
              log.warn("e2ee", "Transient network error — will reconnect:", raw);
              break;
            }
            var err = m.decryption
              ? new E2EEDecryptionError(raw)
              : (m.err instanceof Error ? m.err : new Error(raw));
            _callUserCallback(state.lastGlobalCallback, err);
            break;
          }
        }
      }
    });
  }

  async function connect(globalCallback) {
    _ensureEnabled();
    if (typeof globalCallback === "function") state.lastGlobalCallback = globalCallback;
    if (state.connected && state.session) return state.session;
    if (state.connectingPromise) return state.connectingPromise;

    state.connectingPromise = (async function () {
      var api = ctx._e2eeApiSource && ctx._e2eeApiSource();
      if (!api || typeof api.getAppState !== "function") {
        throw new Error("Cannot start E2EE: authenticated api is not available yet");
      }

      var session = await createFmeSession(ctx, api);
      state.session = session;
      _handleFmeEvents(session);
      state.connected = true;
      state.fullyReady = false;
      state.lastReadyPayload = { userId: String(ctx.userID) };

      _emitLegacyConnected();
      _callUserCallback(state.lastGlobalCallback, null,
        { type: "e2ee_ready", isE2EE: true, data: state.lastReadyPayload });
      _callUserCallback(state.lastGlobalCallback, null,
        { type: "e2ee_device_data_changed", isE2EE: true, deviceData: session.getDeviceData() });
      state.fullyReady = true;
      _callUserCallback(state.lastGlobalCallback, null, { type: "e2ee_fully_ready", isE2EE: true });

      return session;
    })();

    try   { return await state.connectingPromise; }
    finally { state.connectingPromise = null; }
  }

  async function disconnect() {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    var session = state.session;
    state.connected = false;
    state.fullyReady = false;
    state.connectedEmitted = false;
    state.connectingPromise = null;
    state.listenerAttached = false;
    state.session = null;
    if (!session) return;
    try {
      await session.controller.disconnect();
    } catch (e) {
      log.warn("e2ee", "disconnect error:", e && e.message ? e.message : e);
    }
  }

  async function _ensureSession() {
    _ensureEnabled();
    if (state.connected && state.session) return state.session;
    return connect();
  }

  var bridge = {
    connect: connect,
    disconnect: disconnect,
    isConnected : function () { return !!(state.session && state.connected); },
    isFullyReady: function () { return !!(state.session && state.connected && state.fullyReady); },
    getState     : function () { return state; },
    getDeviceData: async function () {
      var session = await _ensureSession();
      return session.getDeviceData();
    },
    sendMessage  : async function (jid, text, opts) {
      var session = await _ensureSession();
      var o = opts || {};
      return session.controller.sendMessage({
        threadId: String(jid),
        text: String(text == null ? "" : text),
        replyToMessageId: o.replyToId != null ? String(o.replyToId) : undefined,
        replyToSenderJid: o.replyToSenderJid != null ? String(o.replyToSenderJid) : undefined
      });
    },
    sendReaction : async function (jid, msgId, senderJid, emoji) {
      var session = await _ensureSession();
      return session.controller.sendReaction({
        messageId: String(msgId),
        reaction: String(emoji == null ? "" : emoji),
        threadId: String(jid),
        senderJid: senderJid != null ? String(senderJid) : undefined
      });
    },
    sendTyping   : async function (jid, isTyping) {
      var api = ctx._e2eeApiSource && ctx._e2eeApiSource();
      if (!api || typeof api.sendTypingIndicator !== "function")
        throw new E2EESessionError("sendTypingIndicator is not available");
      var target = String(jid);
      if (/@msgr$/i.test(target)) {
        var m = target.match(/^(\d+)/);
        if (m) target = m[1];
      }
      return api.sendTypingIndicator(isTyping !== false, target);
    },
    unsendMessage: async function (jid, msgId) {
      var session = await _ensureSession();
      return session.controller.unsendMessage({
        messageId: String(msgId),
        threadId: String(jid),
        fromMe: true
      });
    },
    editMessage  : async function (jid, msgId, text) {
      var session = await _ensureSession();
      return session.controller.editMessage({
        threadId: String(jid),
        messageId: String(msgId),
        newText: String(text == null ? "" : text)
      });
    },
    downloadMedia: async function (opts) {
      var session = await _ensureSession();
      var o = opts || {};
      var client = session.controller.e2eeService.getClient();
      var url = resolveCdnUrl(o.directPath, ctx.globalOptions);

      var resp;
      try {
        resp = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MessengerE2EE" }
        });
      } catch (e) {
        throw new E2EEMediaError("Failed to fetch E2EE media: " + (e && e.message ? e.message : e));
      }
      if (!resp.ok) throw new E2EEMediaError("E2EE media download failed: HTTP " + resp.status);

      var encrypted = Buffer.from(await resp.arrayBuffer());
      var mediaKey = Buffer.from(String(o.mediaKey || ""), "base64");
      if (!mediaKey.length) throw new E2EEMediaError("mediaKey is required to decrypt E2EE media");

      var decrypted;
      try {
        decrypted = client.decryptMedia({
          data: encrypted,
          mediaKey: mediaKey,
          type: _mediaCryptoType(o.mediaType),
          fileSHA256: o.mediaSha256 ? Buffer.from(String(o.mediaSha256), "base64") : undefined,
          fileEncSHA256: o.mediaEncSha256 ? Buffer.from(String(o.mediaEncSha256), "base64") : undefined
        });
      } catch (e) {
        throw new E2EEMediaError("E2EE media decryption failed: " + (e && e.message ? e.message : e));
      }
      return {
        data: decrypted,
        mimeType: o.mimeType || "application/octet-stream",
        fileSize: decrypted.length
      };
    },
    sendMedia: async function (jid, mediaType, data, opts) {
      var session = await _ensureSession();
      var buf = _normalizeMediaInput(data);
      var o = opts || {};
      var ntype = String(mediaType || "").toLowerCase();
      var base = {
        threadId: String(jid),
        data: buf,
        replyToMessageId: o.replyToId != null ? String(o.replyToId) : undefined,
        replyToSenderJid: o.replyToSenderJid != null ? String(o.replyToSenderJid) : undefined
      };

      switch (ntype) {
        case "image":
          return session.controller.sendImage(Object.assign({}, base, {
            fileName: o.filename || "image.jpg",
            mimeType: o.mimeType || "image/jpeg",
            caption: o.caption || "",
            width: o.width, height: o.height
          }));
        case "video":
          return session.controller.sendVideo(Object.assign({}, base, {
            fileName: o.filename || "video.mp4",
            mimeType: o.mimeType || "video/mp4",
            caption: o.caption || "",
            duration: o.duration != null ? Number(o.duration) : undefined,
            width: o.width, height: o.height
          }));
        case "audio": case "voice": {
          var mime = o.mimeType || "audio/ogg; codecs=opus";
          return session.controller.sendAudio(Object.assign({}, base, {
            fileName: o.filename || "audio.ogg",
            mimeType: mime,
            duration: o.duration != null ? Number(o.duration) : undefined,
            ptt: ntype === "voice" || !!o.ptt
          }));
        }
        case "file": case "document":
          return session.controller.sendFile(Object.assign({}, base, {
            fileName: o.filename || "file.bin",
            mimeType: o.mimeType || "application/octet-stream",
            caption: o.caption || ""
          }));
        case "sticker":
          return session.controller.sendImage(Object.assign({}, base, {
            fileName: o.filename || "sticker.webp",
            mimeType: o.mimeType || "image/webp"
          }));
        default:
          throw new E2EEMediaError("Unsupported E2EE mediaType: " + ntype);
      }
    }
  };

  ctx._e2eeBridge = bridge;
  return bridge;
}

function patchApiForE2EE(api, ctx) {
  ctx._e2eeApiSource = function () { return api; };

  if (typeof api.downloadE2EEMedia !== "function") {
    api.downloadE2EEMedia = function (options) {
      return createBridge(ctx).downloadMedia(options);
    };
  }

  if (typeof api.resolveE2EEAttachment !== "function") {
    api.resolveE2EEAttachment = async function (att) {
      if (!att || !att.isE2EE) return att;
      if (att.url && /^https?:\/\//.test(att.url)) return att;
      if (!att.directPath || !att.mediaKey || !att.mediaSha256 || !att.mimeType) return att;
      try {
        var rawType = att.type === "photo" ? "image" : (att.type || "image");
        var res = await api.downloadE2EEMedia({
          directPath: att.directPath, mediaKey: att.mediaKey,
          mediaSha256: att.mediaSha256, mediaEncSha256: att.mediaEncSha256 || undefined,
          mediaType: rawType, mimeType: att.mimeType, fileSize: Number(att.fileSize)
        });
        var localUrl = await storeMedia(res.data, res.mimeType || att.mimeType || "image/jpeg");
        return Object.assign({}, att, { url: localUrl });
      } catch (e) {
        log.error("E2EE", "resolveE2EEAttachment failed:", e && e.message ? e.message : String(e));
        return att;
      }
    };
  }

  if (typeof api.sendTypingE2EE !== "function") {
    api.sendTypingE2EE = function (chatJid, isTyping) {
      if (!isE2EEChatJid(chatJid)) return Promise.resolve();
      return createBridge(ctx).sendTyping(chatJid, isTyping !== false).catch(function () {});
    };
  }
}

module.exports = {
  isE2EEChatJid  : isE2EEChatJid,
  createBridge   : createBridge,
  patchApiForE2EE: patchApiForE2EE,
  _mappers       : {
    mapMsg    : _mapMsg,
    mapEdit   : _mapEdit,
    mapReaction: _mapReaction,
    mapReceipt : _mapReceipt
  }
};
