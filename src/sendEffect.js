"use strict";

const utils = require("../utils");

// ═══════════════════════════════════════════════════
//  sendEffect.js — for sagor-fca
//  Author: SaGor
//
//  Usage:
//    api.sendEffect(effect, threadID, callback)
//    api.sendEffect("fire", threadID)
//    api.sendEffect("love", event.threadID, (err, info) => {})
//    await api.sendEffect("gift", event.threadID)
//
//  4 Confirmed effects (from Messenger "Send Effects" screen):
//    "love"  / "hearts" → ❤️  Love (pink hearts)
//    "gift"             → 🎁 Gift Wrap (blue ribbon box)
//    "wham"  / "bam"   → 💥 Wham! (dark impact effect)
//    "fire"             → 🔥 Fire (orange fire flies)
// ═══════════════════════════════════════════════════

// Confirmed Facebook Messenger internal send_effect tag names
const EFFECTS = {
  // ❤️  Love / Hearts — leftmost in Messenger UI
  love:     "love_hearts",
  hearts:   "love_hearts",
  heart:    "love_hearts",

  // 🎁 Gift Wrap — 2nd in Messenger UI
  gift:     "gift_wrap",

  // 💥 Wham! — 3rd in Messenger UI (dark brown)
  wham:     "wham",
  bam:      "wham",

  // 🔥 Fire — rightmost in Messenger UI
  fire:     "fire_fly",
};

module.exports = function (defaultFuncs, api, ctx) {

  return function sendEffect(effect, threadID, callback) {

    // Promise support
    let resolveFunc, rejectFunc;
    const returnPromise = new Promise((resolve, reject) => {
      resolveFunc = resolve;
      rejectFunc  = reject;
    });

    if (typeof callback !== "function") {
      callback = function (err, data) {
        if (err) return rejectFunc(err);
        resolveFunc(data);
      };
    }

    // Validate effect name
    const effectKey = (effect || "").toString().toLowerCase().trim();
    const effectTag = EFFECTS[effectKey];

    if (!effectTag) {
      const valid = [...new Set(Object.values(EFFECTS).map(v =>
        Object.keys(EFFECTS).find(k => EFFECTS[k] === v)
      ))].join(", ");
      return callback({
        error: `Invalid effect "${effect}". Valid: ${valid}`
      });
    }

    // Validate threadID
    if (!threadID) {
      return callback({ error: "threadID is required." });
    }

    // Build the form — same base as sendMessage.js
    const messageAndOTID = utils.generateOfflineThreadingID();

    const form = {
      client:                           "mercury",
      action_type:                      "ma-type:user-generated-message",
      author:                           "fbid:" + ctx.userID,
      timestamp:                        Date.now(),
      timestamp_absolute:               "Today",
      timestamp_relative:               utils.generateTimestampRelative(),
      timestamp_time_passed:            "0",
      is_unread:                        false,
      is_cleared:                       false,
      is_forward:                       false,
      is_filtered_content:              false,
      is_filtered_content_bh:           false,
      is_filtered_content_account:      false,
      is_filtered_content_quasar:       false,
      is_filtered_content_invalid_app:  false,
      is_spoof_warning:                 false,
      source:                           "source:chat:web",
      "source_tags[0]":                 "source:chat",
      body:                             "",
      html_body:                        false,
      ui_push_phase:                    "V3",
      status:                           "0",
      offline_threading_id:             messageAndOTID,
      message_id:                       messageAndOTID,
      threading_id:                     utils.generateThreadingID(ctx.clientID),
      "ephemeral_ttl_mode:":            "0",
      manual_retry_cnt:                 "0",
      has_attachment:                   false,
      signatureID:                      utils.getSignatureID(),

      // KEY: same pattern as hot_emoji_size in sendMessage.js
      // form["tags[0]"] = "hot_emoji_size:large"  ← for emoji
      // form["tags[0]"] = "send_effect:fire_fly"  ← for effects
      "tags[0]":                        "send_effect:" + effectTag,
    };

    // Set thread target — same logic as sendMessage.js
    const threadIDStr = threadID.toString();
    const isDM = threadIDStr.length === 15 || !threadIDStr.match(/^\d{16,}$/);

    if (isDM) {
      form["specific_to_list[0]"] = "fbid:" + threadID;
      form["specific_to_list[1]"] = "fbid:" + ctx.userID;
      form["other_user_fbid"]     = threadID;
    } else {
      form["thread_fbid"] = threadID;
    }

    // POST to messaging/send — same endpoint as sendMessage.js
    defaultFuncs
      .post("https://www.facebook.com/messaging/send/", ctx.jar, form)
      .then(utils.parseAndCheckLogin(ctx, defaultFuncs))
      .then(function (resData) {
        if (!resData) {
          throw { error: "sendEffect: empty response." };
        }
        if (resData.error) {
          throw resData;
        }
        const actions = resData.payload && resData.payload.actions;
        const messageInfo = Array.isArray(actions)
          ? actions.reduce((p, v) => ({
              threadID:  v.thread_fbid,
              messageID: v.message_id,
              timestamp: v.timestamp,
            }) || p, null)
          : null;

        return callback(null, messageInfo);
      })
      .catch(function (err) {
        console.error("sendEffect error:", err);
        return callback(err);
      });

    return returnPromise;
  };
};
