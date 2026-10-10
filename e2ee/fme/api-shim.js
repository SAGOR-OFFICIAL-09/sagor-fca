"use strict";

function createApiShim(api, ctx) {
  return {
    get fb_dtsg() { return ctx.fb_dtsg; },
    getAppState: function () { return api.getAppState(); },
    httpPost: function (url, body) { return api.httpPost(url, body); },
    getCurrentUserID: function () { return api.getCurrentUserID(); }
  };
}

module.exports = {
  createApiShim: createApiShim
};
