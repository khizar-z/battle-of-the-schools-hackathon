chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ scoutInstalledAt: new Date().toISOString() });
});
