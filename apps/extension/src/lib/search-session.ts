import type { SearchState } from "./search-state";

const SEARCH_SESSION_KEY = "scoutSearchSession";

export async function loadSearchSession(): Promise<SearchState | undefined> {
  if (!hasExtensionStorage()) return undefined;
  const stored = await chrome.storage.local.get(SEARCH_SESSION_KEY);
  return stored[SEARCH_SESSION_KEY] as SearchState | undefined;
}

export async function saveSearchSession(state: SearchState): Promise<void> {
  if (!hasExtensionStorage()) return;
  await chrome.storage.local.set({ [SEARCH_SESSION_KEY]: state });
}

export function openSearchWorkspace(): void {
  const workspaceUrl = chrome.runtime.getURL("popup.html?view=workspace");
  void chrome.tabs.create({ url: workspaceUrl });
}

function hasExtensionStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}
