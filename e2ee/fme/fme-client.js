"use strict";

var path  = require("path");
var fs    = require("fs");

var { createApiShim } = require("./api-shim");
var { CURRENT_DIRNAME, DEVICE_FILENAME, ensureCurrentDevice } = require("../core/device-migrate");
var {
  E2EEInitializationError,
  E2EESessionError
} = require("../core/errors");

var _distPathCache = null;

function resolveDistPath() {
  if (_distPathCache) return _distPathCache;
  var candidates = [
    path.join(__dirname, "..", "vendor", "fbme", "dist", "index.cjs"),
    path.join(__dirname, "..", "..", "FB-Messenger-E2EE", "dist", "index.cjs")
  ];
  for (var i = 0; i < candidates.length; i++) {
    if (fs.existsSync(candidates[i])) {
      _distPathCache = candidates[i];
      return _distPathCache;
    }
  }
  throw new E2EEInitializationError(
    "E2EE bundle not found (e2ee/vendor/fbme/dist/index.cjs). " +
    "Restore it via: npm run build:e2ee (requires the FB-Messenger-E2EE/ source folder)"
  );
}

function resolveDevicePath(globalOptions) {
  var p = globalOptions && globalOptions.e2eeDevicePath
    ? String(globalOptions.e2eeDevicePath)
    : path.join(process.cwd(), CURRENT_DIRNAME, DEVICE_FILENAME);
  return path.resolve(p);
}

function materializeDeviceData(devicePath, deviceData) {
  if (!deviceData) return;
  var json = typeof deviceData === "string" ? deviceData : JSON.stringify(deviceData, null, 2);
  fs.mkdirSync(path.dirname(devicePath), { recursive: true });
  fs.writeFileSync(devicePath, json, { mode: 0o600 });
}

function assertControllerShape(controller) {
  if (!controller || typeof controller !== "object") {
    throw new E2EEInitializationError("FB-Messenger-E2EE bundle has no ClientController");
  }
  if (typeof controller.connectE2EE !== "function") {
    throw new E2EEInitializationError(
      "FB-Messenger-E2EE internals changed: ClientController.connectE2EE() is missing " +
      "(vendored build may be stale)"
    );
  }
  if (!controller.e2eeService || typeof controller.e2eeService.setProvider !== "function") {
    throw new E2EEInitializationError(
      "FB-Messenger-E2EE internals changed: ClientController.e2eeService is missing"
    );
  }
}

async function createFmeSession(ctx, api) {
  var globalOptions = ctx.globalOptions || {};
  var distPath = resolveDistPath();
  var FBMod = require(distPath);

  if (!FBMod || typeof FBMod.FBClient !== "function") {
    throw new E2EEInitializationError("FB-Messenger-E2EE bundle loaded but FBClient export not found");
  }

  var fbClient = new FBMod.FBClient({ platform: "facebook" });
  var controller = fbClient.controller;
  assertControllerShape(controller);

  controller.api = createApiShim(api, ctx);

  var devicePath = resolveDevicePath(globalOptions);
  if (!globalOptions.e2eeDevicePath) {
    devicePath = ensureCurrentDevice(devicePath, { log: require("../core/logger") }).path;
  }
  fs.mkdirSync(path.dirname(devicePath), { recursive: true });
  if (globalOptions.e2eeMemoryOnly !== false) {
    var log = require("../core/logger");
    log.warn("e2ee", "e2eeMemoryOnly is not supported by the FB-Messenger-E2EE backend: " +
      "device keys persist at " + devicePath + " (mode 0600). " +
      "Set e2eeDevicePath to choose the location.");
  }
  var deviceData = globalOptions.e2eeDeviceData ||
                   (typeof global !== "undefined" && global._pendingE2eeDeviceData);
  if (deviceData && typeof global !== "undefined" && global._pendingE2eeDeviceData) {
    delete global._pendingE2eeDeviceData;
  }
  materializeDeviceData(devicePath, deviceData);

  try {
    await controller.connectE2EE(devicePath, String(ctx.userID));
  } catch (err) {
    var message = err && err.message ? err.message : String(err);
    if (/Handshake timeout|Login failure/i.test(message)) {
      throw new E2EESessionError("E2EE Noise handshake failed: " + message);
    }
    throw err instanceof Error ? err : new E2EESessionError(message);
  }

  return {
    fbClient: fbClient,
    controller: controller,
    devicePath: devicePath,
    getDeviceData: function () {
      var ds = controller.activeDeviceStore;
      if (!ds) return null;
      try {
        return JSON.parse(ds.getData());
      } catch (_) {
        return null;
      }
    }
  };
}

module.exports = {
  createFmeSession: createFmeSession,
  resolveDistPath: resolveDistPath,
  resolveDevicePath: resolveDevicePath
};
