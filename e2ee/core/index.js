"use strict";

var { storeMedia } = require("./media-server");
var {
  isE2EEChatJid,
  createBridge,
  patchApiForE2EE
} = require("./bridge");

module.exports = {
  isE2EEChatJid  : isE2EEChatJid,
  storeMedia     : storeMedia,
  createBridge   : createBridge,
  patchApiForE2EE: patchApiForE2EE
};
