'use strict';

function serializeError(error) {
  return {
    ok: false,
    error: String(error && error.message ? error.message : error || 'Unknown error').slice(0, 2000)
  };
}

function registerIpcHandler(ipcMain, channel, handler) {
  ipcMain.handle(channel, async function safeIpcHandler(event, payload) {
    try {
      return { ok: true, data: await handler(payload || {}, event) };
    } catch (error) {
      console.error('[' + channel + ']', error);
      return serializeError(error);
    }
  });
}

module.exports = {
  registerIpcHandler,
  serializeError
};
