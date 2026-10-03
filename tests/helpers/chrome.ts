import { type BroadcastMessage, type RuntimeMessage, type RuntimeResponse } from '../../src/shared';

class FakeEvent<T extends (...args: any[]) => any> {
  private listeners: T[] = [];

  addListener(listener: T): void {
    this.listeners.push(listener);
  }

  getListeners(): T[] {
    return [...this.listeners];
  }

  async trigger(...args: Parameters<T>): Promise<void> {
    for (const listener of this.listeners) {
      await listener(...args);
    }
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
  tabs?: FakeTab[];
}

export function createChromeMock(options: CreateChromeMockOptions = {}) {
  const store: Record<string, unknown> = {};
  let tabs = (options.tabs || []).map(tab => ({
    active: false,
    currentWindow: true,
    windowId: 1,
    index: 0,
    ...tab
  }));

  if (tabs.length && !tabs.some(tab => tab.active)) {
    const activeId = tabs[0]?.id;
    tabs = tabs.map(tab => ({ ...tab, active: tab.id === activeId }));
  }

  const updates: Array<{ tabId: number; updateProperties: Record<string, unknown> }> = [];

  const runtimeOnInstalled = new FakeEvent<() => void | Promise<void>>();
  const runtimeOnMessage = new FakeEvent<
    (message: RuntimeMessage | BroadcastMessage, sender: chrome.runtime.MessageSender, sendResponse: (response: RuntimeResponse) => void) => boolean | void
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
      async sendMessage() {
        return null;
      }
    },
    storage: {
      local: {
        async get(key: string | string[]) {
          return Object.fromEntries((typeof key === 'string' ? [key] : key).map(entry => [entry, store[entry]]));
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
      async setPanelBehavior() {}
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
      async sendMessage() {},
      async remove(tabId: number) {
        tabs = tabs.filter(tab => tab.id !== tabId);
      },
      async highlight() {}
    },
    windows: {
      WINDOW_ID_NONE: -1,
      async update() {}
    },
    webNavigation: {
      onCommitted: webNavigationOnCommitted
    }
  };

  return {
    chrome: chromeMock as unknown as typeof chrome,
    store,
    updates,
    events: {
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
