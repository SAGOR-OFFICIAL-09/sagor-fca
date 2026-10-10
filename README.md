# SAGOR FCA

**SAGOR's own Facebook Chat API for Node.js** — interact with Facebook Messenger programmatically.

This is SAGOR's maintained fork of the FCA family (v1.0.0 marks the start of the SAGOR-owned line).

## Install

```bash
npm install github:SAGOR-OFFICIAL-09/sagor-fca-v2
```

## Usage

```js
const login = require('sagor-fca');

// appState = your Facebook cookie array [{key, value, domain, ...}]
login({ appState }, (err, api) => {
  if (err) return console.error(err);

  console.log('Logged in as', api.getCurrentUserID());

  // listen for incoming messages
  api.listen((err, event) => {
    if (err) return console.error(err);
    if (event.type === 'message') {
      console.log(event.senderID, 'says:', event.body);
      api.sendMessage('Hello from SAGOR FCA!', event.threadID);
    }
  });
});
```

Or with async/await (Promise API):

```js
const api = await login({ appState });
const info = await api.getUserInfo(api.getCurrentUserID());
```

## Config

See `fca-config.example.json` for the available options (copy to `fca-config.json`).

- `checkUpdate.install` defaults to `false` (only logs when a newer version exists). Set it to `true` only if you want the library to run `npm i` in your project automatically.
- `apiServer` is empty by default. API login (email/password/2FA) is only attempted when you set it explicitly; your credentials are sent to that server, so only use one you trust.

## E2EE support (real Messenger end-to-end encryption) 🔐

From v2.1.0 the E2EE layer is the real Messenger E2EE transport (Signal + Noise, vendored from FB-Messenger-E2EE, MIT) in `./e2ee`. It replaces the old interim envelope scheme, so it talks to actual Messenger E2EE chats.

```js
const login = require('sagor-fca');
const { enableE2EE } = require('sagor-fca/e2ee-bridge');

const api = await login({ appState });
await enableE2EE(api, { devicePath: './.sagor-e2ee/device.json' });

api.listen((err, event) => {
  if (err) return console.error(err);
  if (event.type === 'e2ee_message') {
    // event.threadID is an E2EE JID like "123456.0@msgr"
    api.sendMessage('pong', event.threadID);
  }
});
```

- Any thread id containing `@` is routed through the encrypted transport; everything else uses the normal path. Nothing for an E2EE JID is ever sent unencrypted.
- Supported on E2EE threads: text, replies (`replyToMessage`), images/video/audio/files (Buffer, stream or file path), `unsendMessage`, `editMessage`, `setMessageReaction`, typing.
- Not supported on E2EE threads (rejected, not downgraded): `sticker`, `url`, `location`, `emoji`, `mentions`.
- `listen`/`listenMqtt` also deliver `e2ee_message`, `e2ee_message_edit`, `e2ee_message_reaction`, `e2ee_message_revoke`, `e2ee_receipt`, `e2ee_connected`, `e2ee_ready`, `e2ee_fully_ready`, `e2ee_disconnected`.
- Options: `devicePath`, `deviceData` (restore keys), `mediaCdnHost`, `autoConnect` (default `true`; with `false` call `api.connectE2EE(cb)` yourself).
- Extras: `api.getE2EEDeviceData()`, `api.downloadE2EEMedia(opts)`, `api.resolveE2EEAttachment(att)`, `api.sendTypingE2EE(jid, bool)`, `api.e2ee` (the bridge).
- Device keys persist in `devicePath` (keep it private, never commit it). Add `.sagor-e2ee/` to `.gitignore`.
- Needs native `@signalapp/libsignal-client` (installed by `npm install`). Set `SAGOR_E2EE_LOG=off` to silence E2EE logs.

## Notes (unofficial API)

- This is an unofficial API. Facebook may restrict accounts that show bot-like behavior — use responsibly.
- Keep your `appState`/cookies private. Never share them or commit them to git.

## License

Apache-2.0
