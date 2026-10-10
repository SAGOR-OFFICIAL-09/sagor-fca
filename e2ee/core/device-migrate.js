"use strict";

var fs = require("fs");
var path = require("path");

var CURRENT_DIRNAME = ".sagor-e2ee";
var DEVICE_FILENAME = "device.json";

function defaultPaths(cwd) {
  var base = cwd || process.cwd();
  return {
    current: path.join(base, CURRENT_DIRNAME, DEVICE_FILENAME)
  };
}

function ensureCurrentDevice(currentPath) {
  var current = path.resolve(currentPath);

  if (fs.existsSync(current)) {
    return { path: current, migrated: false, reason: "already-exists" };
  }
  return { path: current, migrated: false, reason: "fresh" };
}

module.exports = {
  ensureCurrentDevice: ensureCurrentDevice,
  defaultPaths: defaultPaths,
  CURRENT_DIRNAME: CURRENT_DIRNAME,
  DEVICE_FILENAME: DEVICE_FILENAME
};
