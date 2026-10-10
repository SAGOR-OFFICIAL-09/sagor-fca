"use strict";

function E2EEError(message, code) {
  this.name = this.constructor.name;
  this.message = String(message || "E2EE error");
  this.code = code || "E2EE_ERROR";
  if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
}
E2EEError.prototype = Object.create(Error.prototype);
E2EEError.prototype.constructor = E2EEError;

function E2EEInitializationError(message) {
  E2EEError.call(this, message, "E2EE_INITIALIZATION");
}
E2EEInitializationError.prototype = Object.create(E2EEError.prototype);
E2EEInitializationError.prototype.constructor = E2EEInitializationError;

function E2EESessionError(message) {
  E2EEError.call(this, message, "E2EE_SESSION");
}
E2EESessionError.prototype = Object.create(E2EEError.prototype);
E2EESessionError.prototype.constructor = E2EESessionError;

function E2EEEncryptionError(message) {
  E2EEError.call(this, message, "E2EE_ENCRYPTION");
}
E2EEEncryptionError.prototype = Object.create(E2EEError.prototype);
E2EEEncryptionError.prototype.constructor = E2EEEncryptionError;

function E2EEDecryptionError(message) {
  E2EEError.call(this, message, "E2EE_DECRYPTION");
}
E2EEDecryptionError.prototype = Object.create(E2EEError.prototype);
E2EEDecryptionError.prototype.constructor = E2EEDecryptionError;

function E2EEMediaError(message) {
  E2EEError.call(this, message, "E2EE_MEDIA");
}
E2EEMediaError.prototype = Object.create(E2EEError.prototype);
E2EEMediaError.prototype.constructor = E2EEMediaError;

module.exports = {
  E2EEError: E2EEError,
  E2EEInitializationError: E2EEInitializationError,
  E2EESessionError: E2EESessionError,
  E2EEEncryptionError: E2EEEncryptionError,
  E2EEDecryptionError: E2EEDecryptionError,
  E2EEMediaError: E2EEMediaError
};
