"use strict";

var path     = require("path");
var protobuf = require("protobufjs");

var _root = null;

function getRoot() {
  if (_root) return _root;
  var root = new protobuf.Root();
  root.resolvePath = function (origin, target) {
    return path.join(__dirname, "proto", target);
  };
  root.loadSync(["WACommon.proto", "WAMediaTransport.proto"]);
  _root = root;
  return _root;
}

function getType(name) {
  return getRoot().lookupType(name);
}

var TRANSPORT_BY_KIND = {
  image   : "WAMediaTransport.ImageTransport",
  video   : "WAMediaTransport.VideoTransport",
  audio   : "WAMediaTransport.AudioTransport",
  document: "WAMediaTransport.DocumentTransport",
  sticker : "WAMediaTransport.StickerTransport"
};

function toB64(value) {
  if (value == null) return undefined;
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  return undefined;
}

function num(value) {
  var n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function decodeCommonTransport(transportObj) {
  var t = transportObj && transportObj.integral && transportObj.integral.transport;
  if (!t) return null;
  var integral = t.integral || {};
  return {
    mediaKey       : toB64(integral.mediaKey),
    mediaSha256    : toB64(integral.fileSHA256),
    mediaEncSha256 : toB64(integral.fileEncSHA256),
    directPath     : integral.directPath != null ? String(integral.directPath) : undefined,
    mimeType       : (t.ancillary && t.ancillary.mimetype) || undefined,
    fileSize       : num(t.ancillary && t.ancillary.fileLength)
  };
}

function decodeReceivedAttachment(kind, media) {
  if (!media || typeof media !== "object") return null;
  var transportName = TRANSPORT_BY_KIND[kind];
  if (!transportName) return null;

  var sub = media[kind];
  if (!sub || !sub.payload) return null;
  var payload = Buffer.isBuffer(sub.payload) ? sub.payload : Buffer.from(sub.payload);
  if (payload.length === 0) return null;

  var common;
  var ancillary = {};
  var captionText = "";
  var captionMentions = [];

  try {
    var Type = getType(transportName);
    var obj = Type.toObject(Type.decode(payload), { longs: Number, enums: String, bytes: Buffer });
    common = decodeCommonTransport(obj);
    ancillary = obj.ancillary || {};
    var captionObj = kind === "image" || kind === "video" ? media.caption : null;
    if (captionObj && captionObj.text) {
      captionText = String(captionObj.text);
      var mentions = Array.isArray(captionObj.mentions) ? captionObj.mentions : [];
      for (var i = 0; i < mentions.length; i++) {
        var m = mentions[i] || {};
        if (m.mentionedJID == null) continue;
        var uid = String(m.mentionedJID).split(/[.:]/)[0];
        captionMentions.push({ userId: uid, offset: num(m.offset) || 0, length: num(m.length) || 0 });
      }
    }
  } catch (_) {
    return null;
  }

  if (!common || !common.directPath || !common.mediaKey) return null;

  var att = {
    type          : kind,
    mimeType      : common.mimeType,
    fileSize      : common.fileSize != null ? String(common.fileSize) : undefined,
    width         : num(ancillary.width),
    height        : num(ancillary.height),
    duration      : num(ancillary.duration != null ? ancillary.duration : ancillary.seconds),
    mediaKey      : common.mediaKey,
    mediaSha256   : common.mediaSha256,
    mediaEncSha256: common.mediaEncSha256,
    directPath    : common.directPath
  };

  return {
    attachment: att,
    caption: captionText,
    mentions: captionMentions
  };
}

module.exports = {
  decodeReceivedAttachment: decodeReceivedAttachment
};
