// -----------------------------------------------------------------------------
// The SDK handlers, registered before `connect()`. Kept apart from index.js so
// that the tests register them on the fake Gladys of the SDK.
// -----------------------------------------------------------------------------

export const ACTIONS = { test: 'test_connection', find: 'find_location' };
export const SCENE_TRIGGERS = { started: 'alert_started', ended: 'alert_ended' };

export function registerHandlers(gladys, app) {
  gladys.onScanRequest(async () => {
    await app.publishDevices();
  });
  gladys.onConfigUpdated(async (config) => {
    await app.onConfigUpdated(config);
  });
  gladys.onDeviceCreated(async () => {
    await app.onDeviceChanged();
  });
  gladys.onDeviceUpdated(async () => {
    await app.onDeviceChanged();
  });
  gladys.onDeviceDeleted(async () => {
    await app.onDeviceChanged();
  });
  gladys.onAction(ACTIONS.test, () => app.testConnection());
  gladys.onAction(ACTIONS.find, (fields) => app.findLocation(fields));
  gladys.on('connected', () => {
    app.onConnected().catch(() => {});
  });
  gladys.on('disconnected', () => {
    app.setLinked(false);
  });
}
