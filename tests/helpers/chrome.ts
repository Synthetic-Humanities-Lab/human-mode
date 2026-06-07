import { STORAGE_KEY, type RuntimeMessage, type RuntimeResponse, type AgentSession } from '../../src/shared';

type Listener<T extends (...args: any[]) => any> = T;

class FakeEvent<T extends (...args: any[]) => any> {
  private listeners: Array<Listener<T>> = [];

  addListener(listener: Listener<T>): void {
    this.listeners.push(listener);
  }

  clear(): void {
    this.listeners = [];
  }

  getListeners(): Array<Listener<T>> {
    return [...this.listeners];
  }

  async trigger(...args: Parameters<T>): Promise<Array<Awaited<ReturnType<T>>>> {
    const results: Array<Awaited<ReturnType<T>>> = [];
    for (const listener of this.listeners) {
      results.push(await listener(...args));
    }
    return results;
  }
}

export interface FakeTab {
  id: number;
  url: string;
  title: string;
  active?: boolean;
  currentWindow?: boolean;
  windowId?: number;
  index?: number;
  pendingUrl?: string;
}

interface CreateChromeMockOptions {
  session?: AgentSession;
  tabs?: FakeTab[];
  activeTabId?: number;
  messageHandler?: (message: RuntimeMessage) => Promise<RuntimeResponse | null> | RuntimeResponse | null;
}

export function createChromeMock(options: CreateChromeMockOptions = {}) {
  const store: Record<string, unknown> = {};
  if (options.session) {
    store[STORAGE_KEY] = structuredClone(options.session);
  }

  let tabs = (options.tabs || []).map(tab => ({
    active: false,
    currentWindow: true,
    windowId: 1,
    index: 0,
    ...tab
  }));

  if (tabs.length && !tabs.some(tab => tab.active)) {
    const activeId = options.activeTabId ?? tabs[0]?.id;
    tabs = tabs.map(tab => ({ ...tab, active: tab.id === activeId }));
  }

  const updates: Array<{ tabId: number; updateProperties: Record<string, unknown> }> = [];
  const highlighted: Array<{ windowId: number; tabs: number }> = [];
  const removedTabIds: number[] = [];
  const tabMessages: Array<{ tabId: number; message: unknown }> = [];
  const runtimeMessages: unknown[] = [];
  const windowUpdates: Array<{ windowId: number; updateInfo: Record<string, unknown> }> = [];
  const panelBehaviors: Array<Record<string, unknown>> = [];

  const runtimeOnInstalled = new FakeEvent<() => void | Promise<void>>();
  const runtimeOnMessage = new FakeEvent<
    (message: RuntimeMessage, sender: chrome.runtime.MessageSender, sendResponse: (response: RuntimeResponse) => void) => boolean | void
  >();
  const tabsOnActivated = new FakeEvent<(info: { tabId: number }) => void | Promise<void>>();
  const tabsOnHighlighted = new FakeEvent<(info: { tabIds: number[] }) => void | Promise<void>>();
  const tabsOnCreated = new FakeEvent<(tab: chrome.tabs.Tab) => void | Promise<void>>();
  const tabsOnUpdated = new FakeEvent<
    (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void | Promise<void>
  >();
  const webNavigationOnCommitted = new FakeEvent<
    (details: chrome.webNavigation.WebNavigationTransitionCallbackDetails) => void | Promise<void>
  >();

  const chromeMock = {
    runtime: {
      onInstalled: runtimeOnInstalled,
      onMessage: runtimeOnMessage,
      async sendMessage(message: RuntimeMessage | { type: string; [key: string]: unknown }) {
        runtimeMessages.push(message);
        if (options.messageHandler) {
          return await options.messageHandler(message as RuntimeMessage);
        }
        return null;
      },
      getURL(path: string) {
        return `chrome-extension://test/${path}`;
      }
    },
    storage: {
      local: {
        async get(key: string | string[] | Record<string, unknown> | null) {
          if (typeof key === 'string') {
            return { [key]: store[key] };
          }
          if (Array.isArray(key)) {
            return Object.fromEntries(key.map(entry => [entry, store[entry]]));
          }
          if (!key) {
            return { ...store };
          }
          return Object.fromEntries(
            Object.entries(key).map(([entry, fallback]) => [entry, store[entry] ?? fallback])
          );
        },
        async set(value: Record<string, unknown>) {
          Object.assign(store, structuredClone(value));
        },
        async remove(key: string | string[]) {
          for (const entry of Array.isArray(key) ? key : [key]) {
            delete store[entry];
          }
        }
      }
    },
    sidePanel: {
      async setPanelBehavior(behavior: Record<string, unknown>) {
        panelBehaviors.push(behavior);
      }
    },
    tabs: {
      onActivated: tabsOnActivated,
      onHighlighted: tabsOnHighlighted,
      onCreated: tabsOnCreated,
      onUpdated: tabsOnUpdated,
      async update(tabId: number, updateProperties: Record<string, unknown>) {
        updates.push({ tabId, updateProperties });
        tabs = tabs.map(tab => {
          if (tab.id !== tabId) return tab;
          return {
            ...tab,
            ...('url' in updateProperties ? { url: String(updateProperties.url || tab.url) } : {}),
            ...('active' in updateProperties ? { active: Boolean(updateProperties.active) } : {})
          };
        });
        if (updateProperties.active) {
          tabs = tabs.map(tab => ({ ...tab, active: tab.id === tabId }));
        }
        return tabs.find(tab => tab.id === tabId) || null;
      },
      async query(queryInfo: Record<string, unknown>) {
        return tabs.filter(tab => {
          if ('active' in queryInfo && queryInfo.active !== tab.active) return false;
          if ('currentWindow' in queryInfo && queryInfo.currentWindow !== tab.currentWindow) return false;
          return true;
        });
      },
      async get(tabId: number) {
        const found = tabs.find(tab => tab.id === tabId);
        if (!found) throw new Error(`Unknown tab ${tabId}`);
        return found;
      },
      async sendMessage(tabId: number, message: unknown) {
        tabMessages.push({ tabId, message });
      },
      async remove(tabId: number) {
        removedTabIds.push(tabId);
        tabs = tabs.filter(tab => tab.id !== tabId);
      },
      async highlight(info: { windowId: number; tabs: number }) {
        highlighted.push(info);
      }
    },
    windows: {
      WINDOW_ID_NONE: -1,
      async update(windowId: number, updateInfo: Record<string, unknown>) {
        windowUpdates.push({ windowId, updateInfo });
      }
    },
    webNavigation: {
      onCommitted: webNavigationOnCommitted
    }
  };

  return {
    chrome: chromeMock as unknown as typeof chrome,
    store,
    getTabs: () => tabs,
    updates,
    highlighted,
    removedTabIds,
    runtimeMessages,
    tabMessages,
    windowUpdates,
    panelBehaviors,
    events: {
      runtimeOnInstalled,
      runtimeOnMessage,
      tabsOnActivated,
      tabsOnHighlighted,
      tabsOnCreated,
      tabsOnUpdated,
      webNavigationOnCommitted
    }
  };
}

export async function dispatchRuntimeMessage(
  chromeHarness: ReturnType<typeof createChromeMock>,
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender = {}
): Promise<RuntimeResponse> {
  const listener = chromeHarness.events.runtimeOnMessage.getListeners()[0];
  if (!listener) throw new Error('No runtime.onMessage listener registered');

  return await new Promise<RuntimeResponse>((resolve) => {
    listener(message, sender, response => resolve(response));
  });
}
