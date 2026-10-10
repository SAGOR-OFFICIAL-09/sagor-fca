"use strict";

var http   = require("http");
var crypto = require("crypto");

var _mediaCache  = new Map();
var _mediaServer = null;
var _mediaPort   = null;

function _cleanExpired() {
  var now = Date.now();
  _mediaCache.forEach(function (entry, id) {
    if (entry.expiry < now) _mediaCache.delete(id);
  });
}

function _startMediaServer() {
  if (_mediaServer && _mediaPort) return Promise.resolve(_mediaPort);
  return new Promise(function (resolve, reject) {
    var s = http.createServer(function (req, res) {
      var id    = req.url.replace(/^\/e2ee\//, "").split("?")[0];
      var entry = _mediaCache.get(id);
      if (!entry) { res.writeHead(404); return res.end("Not found"); }
      res.writeHead(200, {
        "Content-Type"  : entry.mimeType || "application/octet-stream",
        "Content-Length": entry.buffer.length,
        "Cache-Control" : "no-cache"
      });
      res.end(entry.buffer);
    });
    s.listen(0, "127.0.0.1", function () {
      _mediaPort   = s.address().port;
      _mediaServer = s;
      resolve(_mediaPort);
    });
    s.on("error", reject);
  });
}

async function storeMedia(buffer, mimeType) {
  var port = await _startMediaServer();
  _cleanExpired();
  var id = crypto.randomBytes(10).toString("hex");
  _mediaCache.set(id, {
    buffer  : buffer,
    mimeType: mimeType || "application/octet-stream",
    expiry  : Date.now() + 10 * 60 * 1000
  });
  return "http://127.0.0.1:" + port + "/e2ee/" + id;
}

module.exports = {
  storeMedia: storeMedia
};
