"use strict";

var { decodeReceivedAttachment } = require("./media-decode");

function _numericPrefix(value) {
  var s = String(value == null ? "" : value);
  var m = s.match(/^(\d+)/);
  return m ? m[1] : s;
}

function _senderFields(data) {
  return {
    senderId: data.senderJid != null ? String(data.senderJid) : _numericPrefix(data.senderId),
    senderJid: data.senderJid != null ? String(data.senderJid) : undefined
  };
}

function _commonE2eeMeta(data) {
  return { chatJid: data.chatJid, senderJid: data.senderJid };
}

function mapFmeEvent(evt) {
  var out = [];
  if (!evt || typeof evt !== "object") return out;
  var type = evt.type;
  var data = evt.data;

  if (type === "e2ee_connected") {
    out.push({ kind: "connected" });
    return out;
  }

  if (type === "disconnected") {
    if (!data || data.isE2EE !== false) out.push({ kind: "disconnected", info: data || null });
    return out;
  }

  if (type === "error") {
    var msg = (data && data.message) || "Unknown E2EE error";
    out.push({ kind: "error", err: new Error(msg) });
    return out;
  }

  if (type === "e2ee_receipt" || type === "e2eeReceipt") {
    var d = (data && typeof data === "object") ? data : {};
    out.push({
      kind: "receipt",
      ev: {
        type: d.type != null ? String(d.type) : "delivery",
        chat: d.chat != null ? String(d.chat) : "",
        sender: d.sender != null ? String(d.sender) : "",
        messageIds: Array.isArray(d.messageIds) ? d.messageIds.map(String) : []
      }
    });
    return out;
  }

  if (type !== "e2ee_message" || !data || typeof data !== "object") {
    return out;
  }

  if (data.type === "decryption_failed") {
    var err = new Error("E2EE decrypt failed in " + (data.chatJid || data.threadId || "?") +
      " (messageId: " + (data.messageId || "?") + "): " + (data.error || "unknown reason"));
    err.isDecryption = true;
    out.push({ kind: "error", err: err, decryption: true });
    return out;
  }

  var kind = data.kind || "unknown";
  var sender = _senderFields(data);
  var e2eeMeta = _commonE2eeMeta(data);
  var timestampMs = Number(data.timestampMs) || Date.now();
  var isGroup = /@g\.us$/i.test(String(data.chatJid || "")) ||
                String(data.chatJid || "").indexOf(".g.") !== -1;

  if (kind === "reaction") {
    out.push({
      kind: "reaction",
      ev: Object.assign({
        reaction: data.reaction != null ? String(data.reaction) : undefined,
        messageId: data.targetId != null ? String(data.targetId) : (data.id != null ? String(data.id) : undefined),
        chatJid: data.chatJid,
        timestampMs: timestampMs,
        isGroup: isGroup
      }, sender, e2eeMeta)
    });
    return out;
  }

  if (kind === "edit") {
    out.push({
      kind: "edit",
      ev: Object.assign({
        text: data.text != null ? String(data.text) : "",
        messageId: data.targetId != null ? String(data.targetId) : undefined,
        chatJid: data.chatJid,
        timestampMs: timestampMs,
        isGroup: isGroup
      }, sender, e2eeMeta)
    });
    return out;
  }

  if (kind === "revoke") {
    out.push({
      kind: "revoke",
      ev: Object.assign({
        messageId: data.targetId != null ? String(data.targetId) : undefined,
        fromMe: !!data.fromMe,
        chatJid: data.chatJid,
        timestampMs: timestampMs,
        isGroup: isGroup
      }, sender, e2eeMeta)
    });
    return out;
  }

  var ev = Object.assign({
    text: data.text != null ? String(data.text) : "",
    chatJid: data.chatJid,
    id: data.id != null ? String(data.id) : undefined,
    timestampMs: timestampMs,
    attachments: [],
    mentions: [],
    isGroup: isGroup
  }, sender, e2eeMeta);

  if (data.replyToId != null) {
    ev.replyTo = {
      messageId: String(data.replyToId),
      senderId: data.replyToSenderJid != null ? String(data.replyToSenderJid) : undefined,
      text: ""
    };
  }

  if (kind === "image" || kind === "video" || kind === "audio" ||
      kind === "document" || kind === "sticker") {
    var decoded = decodeReceivedAttachment(kind, data.media);
    if (decoded) {
      ev.attachments = [decoded.attachment];
      if (decoded.caption && !ev.text) ev.text = decoded.caption;
      if (decoded.mentions && decoded.mentions.length) ev.mentions = decoded.mentions;
    } else {
      ev.mediaUndecodable = true;
    }
  }

  out.push({ kind: "message", ev: ev });
  return out;
}

module.exports = {
  mapFmeEvent: mapFmeEvent
};
