const test = require("node:test");
const { afterEach, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

process.env.NODE_ENV = "test";

const updaterModulePath = require.resolve("../../src/updater.js");
const originalLoad = Module._load;

const STARTUP_DELAY_MS = 3000;
const PERIODIC_INTERVAL_MS = 4 * 60 * 60 * 1000;

function makeAutoUpdater({ offline = false } = {}) {
  const listeners = {};
  const autoUpdater = {
    calls: 0,
    feedCalls: 0,
    listeners,
    setFeedURL() {
      autoUpdater.feedCalls += 1;
    },
    on(event, handler) {
      listeners[event] = handler;
    },
    removeListener() {},
    checkForUpdates() {
      autoUpdater.calls += 1;
      if (offline) {
        // electron-updater emits the error before rejecting
        const error = new Error("net::ERR_INTERNET_DISCONNECTED");
        listeners.error?.(error);
        return Promise.reject(error);
      }
      return Promise.resolve({ isUpdateAvailable: false });
    },
  };
  return autoUpdater;
}

// updater.js requires electron and child_process lazily (constructor, cleanup(),
// Rosetta probe), so the mocks stay installed until afterEach.
function createUpdateManager(autoUpdater) {
  delete require.cache[updaterModulePath];
  Module._load = function loadWithMocks(request, parent, isMain) {
    if (request === "electron-updater") return { autoUpdater };
    if (request === "electron") return { autoUpdater: { on() {}, removeListener() {} } };
    if (request === "child_process") return { execSync: () => "0" };
    return originalLoad.call(this, request, parent, isMain);
  };
  const UpdateManager = require(updaterModulePath);
  return new UpdateManager();
}

function makeRendererWindow(sent) {
  return {
    isDestroyed: () => false,
    webContents: {
      send(channel) {
        sent.push(channel);
      },
    },
  };
}

beforeEach((t) => {
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "error", () => {});
});

afterEach(() => {
  Module._load = originalLoad;
});

test("with App updates off, startup and periodic checks never reach the update feed", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const autoUpdater = makeAutoUpdater();
  const manager = createUpdateManager(autoUpdater);
  manager.setWindowManager({
    notificationPrefs: { notificationsEnabled: true, notifyUpdates: false },
  });

  manager.checkForUpdatesOnStartup();
  t.mock.timers.tick(STARTUP_DELAY_MS);
  assert.equal(autoUpdater.calls, 0, "startup check must be skipped");
  t.mock.timers.tick(PERIODIC_INTERVAL_MS);
  assert.equal(autoUpdater.calls, 0, "periodic check must be skipped");

  manager.cleanup();
});

test("this fork never points electron-updater at OpenWhispr releases", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const autoUpdater = makeAutoUpdater();
  const manager = createUpdateManager(autoUpdater);
  manager.setWindowManager({
    notificationPrefs: { notificationsEnabled: true, notifyUpdates: true },
  });

  assert.equal(autoUpdater.feedCalls, 0, "setFeedURL must not run");
  manager.checkForUpdatesOnStartup();
  t.mock.timers.tick(STARTUP_DELAY_MS);
  assert.equal(autoUpdater.calls, 0, "startup check must not reach the feed");
  t.mock.timers.tick(PERIODIC_INTERVAL_MS);
  assert.equal(autoUpdater.calls, 0, "periodic check must not reach the feed");

  manager.cleanup();
});

test("toggling App updates on cannot re-enable the upstream feed", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const autoUpdater = makeAutoUpdater();
  const manager = createUpdateManager(autoUpdater);
  const windowManager = {
    notificationPrefs: { notificationsEnabled: true, notifyUpdates: false },
  };
  manager.setWindowManager(windowManager);
  manager.checkForUpdatesOnStartup();
  t.mock.timers.tick(STARTUP_DELAY_MS);
  assert.equal(autoUpdater.calls, 0);

  windowManager.notificationPrefs.notifyUpdates = true;
  t.mock.timers.tick(PERIODIC_INTERVAL_MS);
  assert.equal(autoUpdater.calls, 0, "fork kill switch outranks the in-app toggle");

  manager.cleanup();
});

test("before renderer prefs arrive, this fork still does not check for updates", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const autoUpdater = makeAutoUpdater();
  const manager = createUpdateManager(autoUpdater);

  manager.checkForUpdatesOnStartup();
  t.mock.timers.tick(STARTUP_DELAY_MS);
  assert.equal(autoUpdater.calls, 0);

  manager.cleanup();
});

test("a manual Check for Updates does not reach the OpenWhispr feed", async () => {
  const autoUpdater = makeAutoUpdater();
  const manager = createUpdateManager(autoUpdater);
  manager.setWindowManager({
    notificationPrefs: { notificationsEnabled: false, notifyUpdates: false },
  });

  const result = await manager.checkForUpdates();

  assert.equal(autoUpdater.calls, 0);
  assert.equal(result.updateAvailable, false);
});

test("offline with App updates off, no update-error reaches the renderers (#1605)", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const autoUpdater = makeAutoUpdater({ offline: true });
  const manager = createUpdateManager(autoUpdater);
  const sent = [];
  const windowManager = {
    notificationPrefs: { notificationsEnabled: true, notifyUpdates: false },
    mainWindow: makeRendererWindow(sent),
    controlPanelWindow: makeRendererWindow(sent),
  };
  manager.setWindowManager(windowManager);

  manager.checkForUpdatesOnStartup();
  t.mock.timers.tick(STARTUP_DELAY_MS);
  assert.deepEqual(sent, [], "a skipped check produces no renderer traffic at all");

  windowManager.notificationPrefs.notifyUpdates = true;
  t.mock.timers.tick(PERIODIC_INTERVAL_MS);
  assert.deepEqual(sent, [], "re-enabling the toggle still cannot hit the feed");

  manager.cleanup();
});

test("update-available listeners are not registered while fork updates are disabled", () => {
  const autoUpdater = makeAutoUpdater();
  const manager = createUpdateManager(autoUpdater);
  assert.equal(autoUpdater.listeners["update-available"], undefined);
  manager.cleanup();
});
