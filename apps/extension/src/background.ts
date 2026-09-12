type ExtensionApi = typeof chrome;

// Firefox supports the Chrome-compatible namespace, while Chromium exposes
// chrome. Prefer browser when it is available without needing a polyfill.
const extensionApi = (globalThis as typeof globalThis & { browser?: ExtensionApi }).browser ?? chrome;

extensionApi.runtime.onInstalled.addListener(() => {
  void extensionApi.storage.local.set({ scoutInstalledAt: new Date().toISOString() });
});
