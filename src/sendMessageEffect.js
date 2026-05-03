'use strict';

const { generateOfflineThreadingID } = require('../utils');

function isCallable(func) {
  return typeof func === 'function';
}

module.exports = function (defaultFuncs, api, ctx) {
  return function sendMessageEffect(effectID, messageID, threadID, callback) {
    if (!ctx.mqttClient) {
      throw new Error('MQTT client is not connected');
    }

    if (!effectID || !messageID || !threadID) {
      throw new Error('Missing required parameters');
    }

    ctx.wsReqNumber = (ctx.wsReqNumber || 0) + 1;
    ctx.wsTaskNumber = (ctx.wsTaskNumber || 0) + 1;

    const taskPayload = {
      thread_key: threadID,
      message_id: messageID,
      actor_id: ctx.userID,
      timestamp_ms: Date.now(),
      effect_id: effectID,
      sync_group: 1
    };

    const task = {
      failure_count: null,
      label: '46',
      payload: JSON.stringify(taskPayload),
      queue_name: 'effect',
      task_id: ctx.wsTaskNumber
    };

    const content = {
      app_id: '2220391788200892',
      payload: JSON.stringify({
        epoch_id: parseInt(generateOfflineThreadingID()),
        tasks: [task],
        version_id: '7158486590867448'
      }),
      request_id: ctx.wsReqNumber,
      type: 3
    };

    if (isCallable(callback)) {
      ctx.reqCallbacks = ctx.reqCallbacks || {};
      ctx.reqCallbacks[ctx.wsReqNumber] = callback;
    }

    try {
      ctx.mqttClient.publish('/ls_req', JSON.stringify(content), {
        qos: 1,
        retain: false
      });
    } catch (err) {
      if (isCallable(callback)) callback(err);
      else console.error('sendMessageEffect error:', err);
    }
  };
};