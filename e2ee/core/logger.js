'use strict';
const off = String(process.env.SAGOR_E2EE_LOG || '').toLowerCase() === 'off';
function mk(level) {
  return function (tag, ...args) {
    if (off) return;
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn('[sagor-e2ee:' + tag + ']', ...args);
  };
}
module.exports = { info: mk('info'), warn: mk('warn'), error: mk('error') };
