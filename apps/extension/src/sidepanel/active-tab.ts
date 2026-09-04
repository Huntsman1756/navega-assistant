/**
 * Active-tab URL resolution.
 *
 * The Side Panel needs the URL of the active tab to decide whether a page is
 * reachable at all and to build the per-origin permission pattern. The manifest
 * deliberately does NOT request the `tabs` permission, so `chrome.tabs.Tab.url`
 * is only populated when the extension has an `activeTab` grant (a user gesture
 * such as clicking the action icon) or a host permission. When a user opens the
 * Side Panel without first granting `activeTab` (or leaves it open and switches
 * to another site), `tab.url` can be `undefined`.
 *
 * To avoid asking for the broad `tabs` permission we resolve the main frame's
 * URL with `chrome.webNavigation.getFrame({ tabId, frameId: 0 })`, which needs
 * only the `webNavigation` permission (already declared) and returns the
 * top-level navigation URL.
 *
 * This module is chrome-free so it can be unit-tested.
 */

export interface ActiveTabQueryResult {
  id?: number;
  url?: string;
}

export type GetMainFrameUrl = (tabId: number) => Promise<string | undefined>;

/**
 * Resolve the active tab and an exact, usable URL.
 *
 * - if the tab reports a `url`, use it (e.g. when `activeTab` was granted via
 *   the action icon);
 * - otherwise fall back to the main frame URL from `webNavigation` (covers the
 *   Side-Panel-already-open / switched-tab case);
 * - if both fail, return `{ id, url: "" }` so the caller degrades to
 *   `classifyPage("") -> unsupported` rather than guessing.
 */
export async function resolveActiveTab(
  queryActiveTab: () => Promise<ActiveTabQueryResult | null>,
  getMainFrameUrl: GetMainFrameUrl,
): Promise<{ id: number; url: string } | null> {
  const tab = await queryActiveTab();
  if (!tab?.id) return null;
  if (tab.url) return { id: tab.id, url: tab.url };
  let url = "";
  try {
    url = (await getMainFrameUrl(tab.id)) ?? "";
  } catch {
    url = "";
  }
  return { id: tab.id, url };
}
